import React, { useEffect, useState } from 'react'
import MetricCard from './MetricCard'
import { getCurrentAPIKey, rotateToNextAPIKey } from '../utils/apiKey'
import '../styles/MacroDashboard.css'


interface MetricState {
  title: string
  value: string | number
  change: string
  period: string
  icon: string
  color: 'primary' | 'secondary' | 'success' | 'danger'
}

const defaultMetrics: { cpi: MetricState; federalRate: MetricState; sp500: MetricState; bondYield: MetricState } = {
  cpi: {
    title: 'CPI (Consumer Price Index)',
    value: 'Loading...',
    change: 'Loading...',
    period: 'Latest CPI data',
    icon: '📊',
    color: 'primary'
  },
  federalRate: {
    title: 'Federal Funds Rate',
    value: 'Loading...',
    change: 'Loading...',
    period: 'Current Target Rate',
    icon: '🏦',
    color: 'secondary'
  },
  sp500: {
    title: 'S&P 500 Index',
    value: 'Loading...',
    change: 'Loading...',
    period: 'Latest Index Value',
    icon: '📈',
    color: 'success'
  },
  bondYield: {
    title: '10-Year Treasury Yield',
    value: 'Loading...',
    change: 'Loading...',
    period: 'Latest Treasury Rate',
    icon: '💵',
    color: 'success'
  }
}

const MACRO_CACHE_KEY = 'macroDashboardCache'
const MACRO_CACHE_TTL = 1000 * 60 * 15 // 15 minutes

interface MacroCache {
  cpi: MetricState
  federalRate: MetricState
  sp500: MetricState
  bondYield: MetricState
  lastUpdated: string
  fetchedAt: number
}

const loadMacroCache = (): MacroCache | null => {
  try {
    const cached = localStorage.getItem(MACRO_CACHE_KEY)
    if (!cached) return null
    return JSON.parse(cached)
  } catch {
    return null
  }
}

const saveMacroCache = (cache: MacroCache) => {
  try {
    const jsonString = JSON.stringify(cache)
    localStorage.setItem(MACRO_CACHE_KEY, jsonString)
    console.log('[MacroDashboard] Cache saved to localStorage, key:', MACRO_CACHE_KEY, 'size:', jsonString.length, 'bytes')
    // Verify cache was saved
    const verify = localStorage.getItem(MACRO_CACHE_KEY)
    if (verify) {
      console.log('[MacroDashboard] ✓ Cache verified in localStorage')
    } else {
      console.error('[MacroDashboard] ✗ Cache verification failed - data not found after save')
    }
  } catch (error) {
    console.error('[MacroDashboard] Error saving macro cache:', error)
  }
}

const isMacroCacheFresh = (timestamp: number) => Date.now() - timestamp < MACRO_CACHE_TTL

const formatNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'N/A'
  }
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  }).format(value)
}

const formatPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'N/A'
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

const createUnavailableMetric = (base: MetricState, reason: string): MetricState => ({
  ...base,
  value: 'N/A',
  change: 'N/A',
  period: reason
})

const MacroDashboard: React.FC = () => {
  const [cpi, setCpi] = useState<MetricState>(defaultMetrics.cpi)
  const [federalRate, setFederalRate] = useState<MetricState>(defaultMetrics.federalRate)
  const [sp500, setSp500] = useState<MetricState>(defaultMetrics.sp500)
  const [bondYield, setBondYield] = useState<MetricState>(defaultMetrics.bondYield)
  const [lastUpdated, setLastUpdated] = useState('Fetching latest data...')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    console.log('[MacroDashboard] Component mounted, checking cache...')
    const cache = loadMacroCache()
    
    if (cache) {
      console.log('[MacroDashboard] Cache found:', cache)
      if (isMacroCacheFresh(cache.fetchedAt)) {
        console.log('[MacroDashboard] Cache is fresh, using cached data')
        setCpi(cache.cpi)
        setFederalRate(cache.federalRate)
        setSp500(cache.sp500)
        setBondYield(cache.bondYield)
        setLastUpdated(cache.lastUpdated)
        setIsLoading(false)
        return
      } else {
        console.log('[MacroDashboard] Cache is stale, fetching new data')
      }
    } else {
      console.log('[MacroDashboard] No cache found, fetching data')
    }

    const fetchMacroData = async () => {
      const API_KEY = getCurrentAPIKey()
      if (!API_KEY) {
        setError('No API key available')
        setIsLoading(false)
        return
      }

      console.log('[MacroDashboard] Fetching macro data with API key:', API_KEY.slice(0, 8) + '...')

      const sp500Url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent('^GSPC')}&apikey=${API_KEY}`
      const cpiUrl = `https://financialmodelingprep.com/stable/economic-indicators?name=CPI&apikey=${API_KEY}`
      const fedUrl = `https://financialmodelingprep.com/stable/economic-indicators?name=federalFunds&apikey=${API_KEY}`
      const treasuryUrl = `https://financialmodelingprep.com/stable/treasury-rates?apikey=${API_KEY}`

      try {
        const results = await Promise.allSettled([
          fetch(sp500Url),
          fetch(cpiUrl),
          fetch(fedUrl),
          fetch(treasuryUrl)
        ])

        const [sp500Result, cpiResult, fedResult, treasuryResult] = results
        let rateLimitTriggered = false

        // Check for rate limit and rotate API key if needed
        if ((sp500Result.status === 'fulfilled' && sp500Result.value.status === 429) ||
            (cpiResult.status === 'fulfilled' && cpiResult.value.status === 429) ||
            (fedResult.status === 'fulfilled' && fedResult.value.status === 429)) {
          console.warn('[MacroDashboard] API rate limit hit, switching to next API key...')
          rotateToNextAPIKey()
          // Retry with new API key after short delay
          setTimeout(() => {
            fetchMacroData()
          }, 1000)
          return
        }

        let nextSp500 = defaultMetrics.sp500
        let nextCpi = defaultMetrics.cpi
        let nextFederalRate = defaultMetrics.federalRate
        let nextBondYield = defaultMetrics.bondYield

        if (sp500Result.status === 'fulfilled' && sp500Result.value.ok) {
          const sp500Data = await sp500Result.value.json()
          const sp500Quote = Array.isArray(sp500Data) && sp500Data.length > 0 ? sp500Data[0] : null
          if (sp500Quote) {
            nextSp500 = {
              title: 'S&P 500 Index',
              value: formatNumber(sp500Quote.price),
              change: formatPercent(sp500Quote.changePercentage || sp500Quote.changesPercentage || sp500Quote.change),
              period: `Prev close ${formatNumber(sp500Quote.previousClose)}`,
              icon: '📈',
              color: 'success'
            }
          } else {
            nextSp500 = createUnavailableMetric(defaultMetrics.sp500, 'Quote unavailable')
          }
        } else {
          const reason = sp500Result.status === 'fulfilled' && sp500Result.value.status === 429
            ? 'API rate limit reached for S&P 500 quote'
            : 'Quote fetch failed'
          nextSp500 = createUnavailableMetric(defaultMetrics.sp500, reason)
        }

        if (cpiResult.status === 'fulfilled' && cpiResult.value.ok) {
          const cpiData = await cpiResult.value.json()
          const latestCpi = Array.isArray(cpiData) && cpiData.length > 0 ? cpiData[0] : null
          const previousCpi = Array.isArray(cpiData) && cpiData.length > 1 ? cpiData[1] : null

          if (latestCpi) {
            const cpiValue = formatNumber(latestCpi.value)
            const cpiChange = previousCpi
              ? formatPercent(((latestCpi.value - previousCpi.value) / previousCpi.value) * 100)
              : 'N/A'
            nextCpi = {
              title: 'CPI (Consumer Price Index)',
              value: cpiValue,
              change: cpiChange,
              period: `Data as of ${latestCpi.date}`,
              icon: '📊',
              color: 'primary'
            }
          } else {
            nextCpi = createUnavailableMetric(defaultMetrics.cpi, 'CPI data unavailable')
          }
        } else {
          const reason = cpiResult.status === 'fulfilled' && cpiResult.value.status === 429
            ? 'API rate limit reached for CPI'
            : 'CPI fetch failed'
          if (cpiResult.status === 'fulfilled' && cpiResult.value.status === 429) rateLimitTriggered = true
          nextCpi = createUnavailableMetric(defaultMetrics.cpi, reason)
        }

        if (fedResult.status === 'fulfilled' && fedResult.value.ok) {
          const fedData = await fedResult.value.json()
          const latestFed = Array.isArray(fedData) && fedData.length > 0 ? fedData[0] : null
          if (latestFed && latestFed.value != null) {
            nextFederalRate = {
              title: 'Federal Funds Rate',
              value: `${formatNumber(latestFed.value)}%`,
              change: 'N/A',
              period: `Data as of ${latestFed.date}`,
              icon: '🏦',
              color: 'secondary'
            }
          } else {
            nextFederalRate = createUnavailableMetric(defaultMetrics.federalRate, 'Federal rate data unavailable')
          }
        } else {
          const reason = fedResult.status === 'fulfilled' && fedResult.value.status === 429
            ? 'API rate limit reached for federal rate'
            : 'Federal rate fetch failed'
          if (fedResult.status === 'fulfilled' && fedResult.value.status === 429) rateLimitTriggered = true
          nextFederalRate = createUnavailableMetric(defaultMetrics.federalRate, reason)
        }

        if (treasuryResult.status === 'fulfilled' && treasuryResult.value.ok) {
          const treasuryData = await treasuryResult.value.json()
          const latestTreasury = Array.isArray(treasuryData) && treasuryData.length > 0 ? treasuryData[0] : null
          if (latestTreasury && latestTreasury.year10 != null) {
            nextBondYield = {
              title: '10-Year Treasury Yield',
              value: `${formatNumber(latestTreasury.year10)}%`,
              change: 'N/A',
              period: `Data as of ${latestTreasury.date}`,
              icon: '💵',
              color: 'success'
            }
          } else {
            nextBondYield = createUnavailableMetric(defaultMetrics.bondYield, 'Treasury yield data unavailable')
          }
        } else {
          const reason = treasuryResult.status === 'fulfilled' && treasuryResult.value.status === 429
            ? 'API rate limit reached for treasury rates'
            : 'Treasury rates fetch failed'
          if (treasuryResult.status === 'fulfilled' && treasuryResult.value.status === 429) rateLimitTriggered = true
          nextBondYield = createUnavailableMetric(defaultMetrics.bondYield, reason)
        }

        // Update state
        setSp500(nextSp500)
        setCpi(nextCpi)
        setFederalRate(nextFederalRate)
        setBondYield(nextBondYield)

        if (rateLimitTriggered || sp500Result.status === 'rejected' || cpiResult.status === 'rejected' || fedResult.status === 'rejected' || treasuryResult.status === 'rejected') {
          setError('FMP API limit reached or some macro data could not be retrieved.')
        } else {
          setError(null)
        }

        // Save to cache with current timestamp
        const cacheTimestamp = new Date().toLocaleString()
        const cacheData: MacroCache = {
          cpi: nextCpi,
          federalRate: nextFederalRate,
          sp500: nextSp500,
          bondYield: nextBondYield,
          lastUpdated: cacheTimestamp,
          fetchedAt: Date.now()
        }

        console.log('[MacroDashboard] Saving cache:', cacheData)
        saveMacroCache(cacheData)
        setLastUpdated(cacheTimestamp)

        console.log('[MacroDashboard] Data fetched and cached successfully')
      } catch (fetchError) {
        console.error('[MacroDashboard] Fetch error:', fetchError)
        setError('Unable to load macro data at this time.')
        setCpi(createUnavailableMetric(defaultMetrics.cpi, 'Macro data fetch error'))
        setFederalRate(createUnavailableMetric(defaultMetrics.federalRate, 'Macro data fetch error'))
        setSp500(createUnavailableMetric(defaultMetrics.sp500, 'Macro data fetch error'))
        setLastUpdated(new Date().toLocaleString())
      } finally {
        setIsLoading(false)
      }
    }

    fetchMacroData()
  }, [])

  return (
    <div className="macro-dashboard">
      <div className="dashboard-header">
        <h1>Macro Dashboard</h1>
        <p className="header-subtitle">Global Economic Indicators & Market Trends</p>
      </div>

      <div className="metrics-grid">
        <MetricCard {...cpi} />
        <MetricCard {...federalRate} />
        <MetricCard {...sp500} />
        <MetricCard {...bondYield} />
      </div>

      <div className="dashboard-footer">
        {error ? <p className="update-time">{error}</p> : null}
        <p className="update-time">
          {isLoading ? 'Fetching latest macro data...' : `Last updated: ${lastUpdated}`}
        </p>
      </div>
    </div>
  )
}

export default MacroDashboard
