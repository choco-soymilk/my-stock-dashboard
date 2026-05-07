// ─────────────────────────────────────────────────────────────────────────────
// Alpha Vantage Data Service
// Fixes: throttling, deep JSON rate-limit detection, sequential fetching,
//        per-key exhaustion tracking, and cache-first priority.
// ─────────────────────────────────────────────────────────────────────────────

const AV_BASE = 'https://www.alphavantage.co/query'
const AV_CACHE_KEY = 'avDataCache'
const AV_CACHE_TTL = 1000 * 60 * 60 * 24 // 24 hours
const AV_KEY_INDEX_STORAGE = 'av_api_key_index'

// How long to pause between ANY two consecutive AV requests (burst guard)
const AV_REQUEST_DELAY_MS = 1200

// How long a rate-limited key stays "exhausted" before re-trying (1 minute)
const AV_KEY_EXHAUSTION_MS = 60_000

// ── 1. Dynamic key loading ────────────────────────────────────────────────────

const loadAlphaVantageKeys = (): string[] => {
  const env = import.meta.env as Record<string, string>
  const keys: string[] = []

  Object.keys(env).forEach(k => {
    if (k.startsWith('VITE_ALPHA_VANTAGE_API_KEY_') && env[k]) {
      keys.push(env[k])
    }
  })

  console.log(
    `[AlphaVantage] Loaded ${keys.length} key(s):`,
    keys.map((k, i) => `#${i + 1}: ${k.slice(0, 6)}...`).join(', ')
  )
  return keys
}

const AV_KEYS = loadAlphaVantageKeys()

// ── 2. Per-key exhaustion tracking (in-memory, not persisted) ─────────────────
// Maps key-index → timestamp when it was marked exhausted.
const exhaustedAt: Map<number, number> = new Map()

const isKeyExhausted = (idx: number): boolean => {
  const ts = exhaustedAt.get(idx)
  if (ts === undefined) return false
  if (Date.now() - ts > AV_KEY_EXHAUSTION_MS) {
    exhaustedAt.delete(idx)   // cooled down — allow retry
    return false
  }
  return true
}

const markKeyExhausted = (idx: number) => {
  exhaustedAt.set(idx, Date.now())
  console.warn(`[AlphaVantage] Key #${idx + 1} marked exhausted for ${AV_KEY_EXHAUSTION_MS / 1000}s`)
}

// ── 3. Key rotation (skips exhausted keys) ────────────────────────────────────

const getKeyIndex = (): number => {
  try {
    const stored = localStorage.getItem(AV_KEY_INDEX_STORAGE)
    const idx = stored ? parseInt(stored, 10) : 0
    return idx < AV_KEYS.length ? idx : 0
  } catch { return 0 }
}

const setKeyIndex = (idx: number) => {
  try { localStorage.setItem(AV_KEY_INDEX_STORAGE, idx.toString()) } catch { /* noop */ }
}

const getCurrentAVKey = (): { key: string; idx: number } => {
  const idx = getKeyIndex()
  return { key: AV_KEYS[idx] ?? '', idx }
}

/**
 * Advance to the next non-exhausted key. Returns the new key (or empty string
 * if all keys are currently exhausted).
 */
const rotateAVKey = (fromIdx: number): { key: string; idx: number } => {
  for (let step = 1; step <= AV_KEYS.length; step++) {
    const nextIdx = (fromIdx + step) % AV_KEYS.length
    if (!isKeyExhausted(nextIdx)) {
      setKeyIndex(nextIdx)
      console.log(`🔑 Key Rotated → Alpha Vantage key #${nextIdx + 1}`)
      return { key: AV_KEYS[nextIdx], idx: nextIdx }
    }
  }
  console.warn('[AlphaVantage] All keys are currently exhausted.')
  return { key: '', idx: fromIdx }
}

// ── 4. Deep rate-limit detection ──────────────────────────────────────────────

const RATE_LIMIT_PHRASES = [
  'thank you for using alpha vantage',
  'rate limit',
  'api call frequency',
  'premium endpoint',
]

const isRateLimited = (body: Record<string, unknown>): boolean => {
  const note = ((body['Note'] ?? body['Information'] ?? '') as string).toLowerCase()
  return RATE_LIMIT_PHRASES.some(phrase => note.includes(phrase))
}

// ── 5. Throttle helper ────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

// ── 6. Cache helpers ──────────────────────────────────────────────────────────

export interface AVMetrics {
  forwardPE?: number | null
  ytd?: number | null
  oneYear?: number | null
  threeYear?: number | null
}

interface AVCacheEntry {
  data: AVMetrics
  updatedAt: number
}

const avLoadCache = (): Record<string, AVCacheEntry> => {
  try {
    const raw = localStorage.getItem(AV_CACHE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

const avSaveCache = (cache: Record<string, AVCacheEntry>) => {
  try { localStorage.setItem(AV_CACHE_KEY, JSON.stringify(cache)) } catch { /* noop */ }
}

// Returns cached metrics if they exist and are < 24h old, otherwise null.
const avGetCached = (ticker: string): AVMetrics | null => {
  const entry = avLoadCache()[ticker]
  if (entry && Date.now() - entry.updatedAt < AV_CACHE_TTL) {
    console.log(`[AlphaVantage] 📦 Cache hit for ${ticker} (age: ${Math.round((Date.now() - entry.updatedAt) / 60000)}m)`)
    return entry.data
  }
  return null
}

const avSetCache = (ticker: string, data: AVMetrics) => {
  const cache = avLoadCache()
  cache[ticker] = { data, updatedAt: Date.now() }
  avSaveCache(cache)
}

// ── 7. Single throttled fetch with retry-on-rate-limit ───────────────────────

/**
 * Fetch one AV endpoint. Applies a 1200ms pre-request delay, checks for body-
 * level rate-limit signals, and rotates the key + retries once if detected.
 */
const avFetch = async (params: Record<string, string>): Promise<Record<string, unknown>> => {
  if (AV_KEYS.length === 0) {
    console.warn('[AlphaVantage] No API keys configured (VITE_ALPHA_VANTAGE_API_KEY_*)')
    return {}
  }

  // ── throttle: wait before firing any request ──
  await sleep(AV_REQUEST_DELAY_MS)

  let { key, idx } = getCurrentAVKey()
  if (!key) return {}

  const buildUrl = (k: string) =>
    `${AV_BASE}?${new URLSearchParams({ ...params, apikey: k }).toString()}`

  // First attempt
  let response = await fetch(buildUrl(key))
  let body: Record<string, unknown> = response.ok ? await response.json() : {}

  // Rate limited? → exhaust this key, rotate, wait, retry once
  if (response.status === 429 || (response.ok && isRateLimited(body))) {
    markKeyExhausted(idx)
    const rotated = rotateAVKey(idx)
    if (!rotated.key) return {}          // all keys exhausted

    key = rotated.key
    idx = rotated.idx

    await sleep(AV_REQUEST_DELAY_MS)    // extra pause before retry
    response = await fetch(buildUrl(key))
    body = response.ok ? await response.json() : {}

    if (response.status === 429 || isRateLimited(body)) {
      markKeyExhausted(idx)
      console.warn('[AlphaVantage] Rate limit hit on second attempt — aborting.')
      return {}
    }
  }

  if (!response.ok) {
    console.error(`[AlphaVantage] HTTP ${response.status} for function=${params['function']}`)
    return {}
  }

  return body
}

// ── 8. ForwardPE from OVERVIEW (stocks only) — sequential ────────────────────

const fetchForwardPE = async (ticker: string): Promise<number | null> => {
  const body = await avFetch({ function: 'OVERVIEW', symbol: ticker })
  const raw = body['ForwardPE']
  if (raw === undefined || raw === null || raw === 'None' || raw === '-') return null
  const val = parseFloat(raw as string)
  return isNaN(val) ? null : val
}

// ── 9. Performance from TIME_SERIES_MONTHLY (ETFs only) — sequential ─────────

interface MonthlyPoint { date: string; close: number }

const parseMonthlyData = (body: Record<string, unknown>): MonthlyPoint[] => {
  const series = body['Monthly Time Series'] as Record<string, Record<string, string>> | undefined
  if (!series) return []

  return Object.entries(series)
    .map(([date, values]) => ({ date, close: parseFloat(values['4. close'] ?? '0') }))
    .filter(p => p.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date)) // ascending
}

const closestMonthly = (points: MonthlyPoint[], target: Date): number | null => {
  if (!points.length) return null
  const targetMs = target.getTime()
  let best = points[0]
  let bestDiff = Math.abs(new Date(points[0].date).getTime() - targetMs)
  for (const p of points) {
    const diff = Math.abs(new Date(p.date).getTime() - targetMs)
    if (diff < bestDiff) { bestDiff = diff; best = p }
  }
  return best.close
}

const calcReturn = (current: number, historical: number | null): number | null => {
  if (historical === null || historical <= 0) return null
  return ((current - historical) / historical) * 100
}

const fetchETFPerformance = async (ticker: string): Promise<Omit<AVMetrics, 'forwardPE'>> => {
  // TIME_SERIES_MONTHLY is fetched here sequentially (no Promise.all)
  const body = await avFetch({ function: 'TIME_SERIES_MONTHLY', symbol: ticker })
  const points = parseMonthlyData(body)

  if (!points.length) {
    console.warn(`[AlphaVantage] No monthly data for ${ticker}`)
    return { ytd: null, oneYear: null, threeYear: null }
  }

  const currentClose = points[points.length - 1].close
  const today = new Date()

  const ytdTarget       = new Date(today.getFullYear() - 1, 11, 31) // Dec 31 prev year
  const oneYearTarget   = new Date(today); oneYearTarget.setFullYear(today.getFullYear() - 1)
  const threeYearTarget = new Date(today); threeYearTarget.setFullYear(today.getFullYear() - 3)

  const metrics = {
    ytd:       calcReturn(currentClose, closestMonthly(points, ytdTarget)),
    oneYear:   calcReturn(currentClose, closestMonthly(points, oneYearTarget)),
    threeYear: calcReturn(currentClose, closestMonthly(points, threeYearTarget)),
  }

  console.log(`📊 Calculated YTD/1Y/3Y from Monthly Series for ${ticker}:`, metrics)
  return metrics
}

// ── 10. Public entry point ────────────────────────────────────────────────────

/**
 * Fetch AV metrics for a ticker.
 * - Cache-first: returns immediately from localStorage if < 24h old.
 * - isEtf=false → OVERVIEW only (ForwardPE)
 * - isEtf=true  → TIME_SERIES_MONTHLY only (YTD / 1Y / 3Y)
 * Fetches are always sequential — never parallel — to respect the 1 req/s limit.
 */
export const fetchAVMetrics = async (ticker: string, isEtf: boolean): Promise<AVMetrics> => {
  // ── Priority 1: Cache check (no network if fresh) ──
  const cached = avGetCached(ticker)
  if (cached) return cached

  let result: AVMetrics = {}

  try {
    if (isEtf) {
      // Sequential: only TIME_SERIES_MONTHLY — no parallel calls
      const perf = await fetchETFPerformance(ticker)
      result = { ytd: perf.ytd, oneYear: perf.oneYear, threeYear: perf.threeYear }
    } else {
      // Sequential: only OVERVIEW — no parallel calls
      const forwardPE = await fetchForwardPE(ticker)
      result = { forwardPE }
    }
  } catch (err) {
    console.error(`[AlphaVantage] Error fetching metrics for ${ticker}:`, err)
  }

  avSetCache(ticker, result)
  return result
}
