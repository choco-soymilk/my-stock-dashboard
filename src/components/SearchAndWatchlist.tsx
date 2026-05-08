import React, { useState, useEffect, useCallback } from 'react'
import { getCurrentAPIKey, rotateToNextAPIKey } from '../utils/apiKey'
import { fetchAVMetrics } from '../utils/alphaVantage'
import TechnicalAnalysisModal from './TechnicalAnalysisModal'
import '../styles/SearchAndWatchlist.css'


interface Stock {
  ticker: string
  category: 'core' | 'satellite'
  isEtf: boolean
  addedDate: string
}

interface ProfileResponse {
  symbol?: string
  price?: number
  companyName?: string
  marketCap?: number
  mktCap?: number
}

interface KeyMetricsResponse {
  symbol?: string
  peRatio?: number
  priceToEarningsRatio?: number
  priceEarningsRatio?: number
  forwardPERatio?: number
  forwardPE?: number
  freeCashFlowYield?: number
  returnOnInvestedCapital?: number
  roic?: number
  operatingProfitMargin?: number
  operatingMargin?: number
}

interface RatiosResponse {
  symbol?: string
  returnOnInvestedCapital?: number
  roic?: number
  operatingMarginRatio?: number
  operatingMargin?: number
  operatingProfitMargin?: number
  interestCoverageRatio?: number
  interestCoverage?: number
  priceToEarningsRatio?: number
  priceToEarnings?: number
  priceEarningsRatio?: number
  forwardPERatio?: number
  forwardPE?: number
}

interface AnalystEstimatesResponse {
  symbol?: string
  epsAvg?: number
}

interface HistoricalPriceEntry {
  date: string   // 'YYYY-MM-DD'
  price: number  // field name in stable/historical-price-eod/light response
}

interface PerformanceMetrics {
  ytd: number | null
  oneYear: number | null
  threeYear: number | null
}

interface FundamentalData {
  price: number
  companyName: string
  marketCap: number
  pe: number
  forwardPE: number
  roic: number
  operatingMargin: number
  fcfYield: number
  interestCoverage: number
  performance?: PerformanceMetrics
  loading: boolean
  error: string | null
}

interface CachedStockData extends FundamentalData {
  updatedAt: number
}

interface StockData {
  [ticker: string]: FundamentalData
}

const STOCK_CACHE_KEY = 'stockDataCache'
const STOCK_CACHE_TTL = 1000 * 60 * 30 // 30 minutes

const stripCachedData = (cached: CachedStockData): FundamentalData => {
  const { updatedAt, ...stockData } = cached
  return stockData
}

const loadStockDataCache = (): Record<string, CachedStockData> => {
  try {
    const cached = localStorage.getItem(STOCK_CACHE_KEY)
    if (!cached) return {}
    return JSON.parse(cached)
  } catch {
    return {}
  }
}

const saveStockDataCache = (cache: Record<string, CachedStockData>) => {
  try {
    localStorage.setItem(STOCK_CACHE_KEY, JSON.stringify(cache))
  } catch (error) {
    console.error('Error saving stock cache:', error)
  }
}

const isCacheFresh = (timestamp: number) => Date.now() - timestamp < STOCK_CACHE_TTL

const getFreshCachedData = (tickers: string[]) => {
  const cache = loadStockDataCache()
  const freshData: Record<string, CachedStockData> = {}

  tickers.forEach(ticker => {
    const cached = cache[ticker]
    if (cached && isCacheFresh(cached.updatedAt)) {
      freshData[ticker] = cached
    }
  })

  return freshData
}

const SearchAndWatchlist: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('')
  const [watchlist, setWatchlist] = useState<Stock[]>([])
  const [selectedCategory, setSelectedCategory] = useState<'core' | 'satellite' | ''>('')
  const [selectedIsEtf, setSelectedIsEtf] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [stockData, setStockData] = useState<StockData>({})
  const [loadingStocks, setLoadingStocks] = useState<Set<string>>(new Set())
  const [selectedTickerForAnalysis, setSelectedTickerForAnalysis] = useState<string | null>(null)


    const fetchStockDataBatch = useCallback(async (tickers: string[], tickerIsEtfMap?: Record<string, boolean>) => {
    let API_KEY = getCurrentAPIKey()
    if (!API_KEY || tickers.length === 0) {
      return
    }

    const normalizedTickers = tickers.map(ticker => ticker.toUpperCase())
    setLoadingStocks(prev => {
      const next = new Set(prev)
      normalizedTickers.forEach(ticker => next.add(ticker))
      return next
    })

    // Helper: given a sorted-ascending array of {date, close} find the entry
    // whose date is closest to targetDate (handles weekends / holidays).
    const closestPrice = (history: HistoricalPriceEntry[], targetDate: Date): number | null => {
      if (!history.length) return null
      const targetMs = targetDate.getTime()
      let best = history[0]
      let bestDiff = Math.abs(new Date(history[0].date).getTime() - targetMs)
      for (const entry of history) {
        const diff = Math.abs(new Date(entry.date).getTime() - targetMs)
        if (diff < bestDiff) { bestDiff = diff; best = entry }
      }
      return best.price
    }

    // Helper: format a Date as 'YYYY-MM-DD'
    const fmtDate = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    const makeRequest = async (apiKey: string, ticker: string, isETF: boolean = false) => {
      const profileUrl = `https://financialmodelingprep.com/stable/profile?symbol=${ticker}&apikey=${apiKey}`
      const metricsUrl = `https://financialmodelingprep.com/stable/key-metrics?symbol=${ticker}&period=annual&apikey=${apiKey}`
      const ratiosUrl = `https://financialmodelingprep.com/stable/ratios?symbol=${ticker}&period=annual&apikey=${apiKey}`
      const analystEstimatesUrl = `https://financialmodelingprep.com/stable/analyst-estimates?symbol=${ticker}&apikey=${apiKey}`

      const requests: Promise<Response>[] = [
        fetch(profileUrl),
        fetch(metricsUrl),
        fetch(ratiosUrl),
        fetch(analystEstimatesUrl)
      ]

      // For ETFs: one request to the light EOD endpoint covers YTD, 1Y, and 3Y.
      // Only ETFs use this to preserve API quota for stocks.
      if (isETF) {
        const today = new Date()
        const threeYearsAgo = new Date(today)
        threeYearsAgo.setFullYear(today.getFullYear() - 3)
        const histUrl =
          `https://financialmodelingprep.com/stable/historical-price-eod/light` +
          `?symbol=${ticker}&from=${fmtDate(threeYearsAgo)}&to=${fmtDate(today)}&apikey=${apiKey}`
        requests.push(fetch(histUrl))
      }

      return Promise.allSettled(requests)
    }

    try {
      let tickerResponses = await Promise.all(normalizedTickers.map(ticker => {
        const isETF = tickerIsEtfMap?.[ticker] === true
        return makeRequest(API_KEY, ticker, isETF)
      }))

      // Check if any request was rate limited (429/403) and retry with next key
      const needsRetry = tickerResponses.some((responses: any) =>
        responses.some((res: any) => res?.status === 'fulfilled' && [429, 403].includes(res.value.status))
      )

      if (needsRetry) {
        console.warn('[SearchAndWatchlist] Rate limit hit, rotating API key...')
        API_KEY = rotateToNextAPIKey()
        tickerResponses = await Promise.all(normalizedTickers.map(ticker => {
          const isETF = tickerIsEtfMap?.[ticker] === true
          return makeRequest(API_KEY, ticker, isETF)
        }))
      }

      const normalizeApiArray = <T = any>(data: any): T[] => {
        if (!data) return []
        if (Array.isArray(data)) return data
        if (typeof data === 'object') return [data]
        return []
      }

      const stockCache = loadStockDataCache()
      const nextStockData: Record<string, FundamentalData> = {}

      for (let index = 0; index < normalizedTickers.length; index++) {
        const ticker = normalizedTickers[index]
        const isETF = tickerIsEtfMap?.[ticker] === true
        const responses = tickerResponses[index]
        
        const profileRes = responses[0]
        const metricsRes = responses[1]
        const ratiosRes = responses[2]
        const analystEstimatesRes = responses[3]
        const histPriceRes = isETF ? responses[4] : undefined

        const profileData = profileRes.status === 'fulfilled' && profileRes.value.ok
          ? normalizeApiArray<ProfileResponse>(await profileRes.value.json())
          : []

        const metricsData = metricsRes.status === 'fulfilled' && metricsRes.value.ok
          ? normalizeApiArray<KeyMetricsResponse>(await metricsRes.value.json())
          : []

        const ratiosData = ratiosRes.status === 'fulfilled' && ratiosRes.value.ok
          ? normalizeApiArray<RatiosResponse>(await ratiosRes.value.json())
          : []

        const analystEstimatesData = analystEstimatesRes.status === 'fulfilled' && analystEstimatesRes.value.ok
          ? normalizeApiArray<AnalystEstimatesResponse>(await analystEstimatesRes.value.json())
          : []

        // Parse historical price list for ETF performance calculation.
        // stable/historical-price-eod/light returns a flat array: [{ symbol, date, price, ... }]
        // Stocks skip this block entirely — no quota wasted.
        let historicalPrices: HistoricalPriceEntry[] = []
        if (isETF && histPriceRes?.status === 'fulfilled' && histPriceRes.value.ok) {
          const raw = await histPriceRes.value.json()
          // Flat array response — no nested 'historical' wrapper
          const list: any[] = Array.isArray(raw) ? raw : []
          // Map to { date, price } and sort ascending so closestPrice scan works correctly
          historicalPrices = list
            .filter((e: any) => e.date && typeof e.price === 'number')
            .map((e: any): HistoricalPriceEntry => ({ date: e.date, price: e.price }))
            .sort((a, b) => a.date.localeCompare(b.date))
          console.log(`[${ticker}] ETF light history loaded: ${historicalPrices.length} entries`)
        }

        const profileMap = profileData.reduce<Record<string, ProfileResponse>>((acc, item) => {
          if (item?.symbol) acc[item.symbol.toUpperCase()] = item
          return acc
        }, {})

        const metricsMap = metricsData.reduce<Record<string, KeyMetricsResponse>>((acc, item) => {
          if (item?.symbol) acc[item.symbol.toUpperCase()] = item
          return acc
        }, {})

        const ratiosMap = ratiosData.reduce<Record<string, RatiosResponse>>((acc, item) => {
          if (item?.symbol) acc[item.symbol.toUpperCase()] = item
          return acc
        }, {})

        const analystEstimatesMap = analystEstimatesData.reduce<Record<string, AnalystEstimatesResponse>>((acc, item) => {
          if (item?.symbol) acc[item.symbol.toUpperCase()] = item
          return acc
        }, {})

        const profile = profileMap[ticker]
        const metrics = metricsMap[ticker]
        const ratios = ratiosMap[ticker]
        const analystEstimates = analystEstimatesMap[ticker]

        console.log(`[${ticker}] Raw API Data:`, { profile, metrics, ratios, analystEstimates })

        const price = profile?.price ?? 0
        const companyName = profile?.companyName || 'Unknown'
        const marketCap = profile?.marketCap ?? profile?.mktCap ?? 0

        let pe = 0
        let forwardPE = 0
        let fcfYield = 0

        if (metrics) {
          pe = metrics.peRatio ?? metrics.priceToEarningsRatio ?? metrics.priceEarningsRatio ?? 0
          forwardPE = metrics.forwardPERatio ?? metrics.forwardPE ?? 0
          fcfYield = metrics.freeCashFlowYield ?? 0
        }

        if (analystEstimates && typeof analystEstimates === 'object') {
          const epsAvg = analystEstimates.epsAvg
          console.log(`[${ticker}] Analyst Estimates epsAvg:`, epsAvg, 'Price:', price)
          if (price && price > 0 && epsAvg && typeof epsAvg === 'number' && epsAvg > 0) {
            forwardPE = price / epsAvg
            console.log(`[${ticker}] Calculated forwardPE from analyst estimates:`, forwardPE)
          } else {
            console.log(`[${ticker}] Cannot calculate forwardPE - missing valid price or epsAvg`)
          }
        } else {
          console.log(`[${ticker}] No analyst estimates data available`)
        }

        let roic = 0
        let operatingMargin = 0
        let interestCoverage = 0

        if (metrics) {
          roic = metrics.returnOnInvestedCapital ?? metrics.roic ?? 0
          operatingMargin = metrics.operatingProfitMargin ?? metrics.operatingMargin ?? 0
          console.log(`[${ticker}] Metrics operatingMargin from key-metrics:`, operatingMargin)
        }

        if (ratios) {
          interestCoverage = ratios.interestCoverageRatio ?? ratios.interestCoverage ?? 0
          // Fallback to ratios for operatingMargin if not found in metrics
          if (operatingMargin === 0) {
            operatingMargin = ratios.operatingMarginRatio ?? ratios.operatingProfitMargin ?? ratios.operatingMargin ?? 0
            console.log(`[${ticker}] Fallback operatingMargin from ratios:`, operatingMargin)
          }
          if (pe === 0) {
            pe = ratios.priceToEarningsRatio ?? ratios.priceToEarnings ?? ratios.priceEarningsRatio ?? 0
          }
          if (forwardPE === 0) {
            forwardPE = ratios.forwardPERatio ?? ratios.forwardPE ?? 0
          }
        }

        console.log(`[${ticker}] Final data - roic: ${roic}, operatingMargin: ${operatingMargin}, forwardPE: ${forwardPE}`)

        // Manually calculate ETF performance from historical prices
        let performance: PerformanceMetrics | undefined
        if (isETF && historicalPrices.length > 0 && price > 0) {
          const today = new Date()

          const ytdStart = new Date(today.getFullYear(), 0, 1)   // Jan 1 this year
          const oneYearAgo = new Date(today); oneYearAgo.setFullYear(today.getFullYear() - 1)
          const threeYearsAgo = new Date(today); threeYearsAgo.setFullYear(today.getFullYear() - 3)

          const calcReturn = (historicalClose: number | null): number | null => {
            if (historicalClose === null || historicalClose <= 0) return null
            return ((price - historicalClose) / historicalClose) * 100
          }

          performance = {
            ytd:       calcReturn(closestPrice(historicalPrices, ytdStart)),
            oneYear:   calcReturn(closestPrice(historicalPrices, oneYearAgo)),
            threeYear: calcReturn(closestPrice(historicalPrices, threeYearsAgo))
          }
          console.log(`[${ticker}] ETF Performance (calculated):`, performance)
        }

        nextStockData[ticker] = {
          price,
          companyName,
          marketCap,
          pe,
          forwardPE,
          roic,
          operatingMargin,
          fcfYield,
          interestCoverage,
          ...(performance && { performance }),
          loading: false,
          error: null
        }

        stockCache[ticker] = {
          ...nextStockData[ticker],
          updatedAt: Date.now()
        }
      }

      saveStockDataCache(stockCache)
      setStockData(prev => ({ ...prev, ...nextStockData }))

      // ── Alpha Vantage enrichment (non-blocking background pass) ──────────
      // Run after FMP data is painted so the card is never blank.
      // ETFs  → YTD / 1Y / 3Y from TIME_SERIES_MONTHLY (overwrites FMP performance)
      // Stocks → ForwardPE from OVERVIEW (fills in when FMP returns 0)
      ;(async () => {
        for (const ticker of normalizedTickers) {
          const isETF = tickerIsEtfMap?.[ticker] === true
          try {
            const av = await fetchAVMetrics(ticker, isETF)
            setStockData(prev => {
              const existing = prev[ticker]
              if (!existing) return prev
              const patch: Partial<typeof existing> = {}

              if (isETF && (av.ytd !== undefined || av.oneYear !== undefined || av.threeYear !== undefined)) {
                patch.performance = {
                  ytd:       av.ytd       ?? existing.performance?.ytd       ?? null,
                  oneYear:   av.oneYear   ?? existing.performance?.oneYear   ?? null,
                  threeYear: av.threeYear ?? existing.performance?.threeYear ?? null
                }
              }

              if (!isETF && av.forwardPE != null && existing.forwardPE === 0) {
                patch.forwardPE = av.forwardPE
              }

              if (Object.keys(patch).length === 0) return prev
              return { ...prev, [ticker]: { ...existing, ...patch } }
            })

            // Also persist enriched data to cache
            const stockCache = loadStockDataCache()
            if (stockCache[ticker]) {
              const current = stockCache[ticker]
              if (isETF && (av.ytd !== undefined || av.oneYear !== undefined || av.threeYear !== undefined)) {
                current.performance = {
                  ytd:       av.ytd       ?? current.performance?.ytd       ?? null,
                  oneYear:   av.oneYear   ?? current.performance?.oneYear   ?? null,
                  threeYear: av.threeYear ?? current.performance?.threeYear ?? null
                }
              }
              if (!isETF && av.forwardPE != null && current.forwardPE === 0) {
                current.forwardPE = av.forwardPE
              }
              stockCache[ticker] = current
              saveStockDataCache(stockCache)
            }
          } catch (avErr) {
            console.warn(`[AlphaVantage] Enrichment failed for ${ticker}:`, avErr)
          }
        }
      })()
    } catch (error) {
      console.error('Batch fetch error:', error)
      normalizedTickers.forEach(ticker => {
        setStockData(prev => ({
          ...prev,
          [ticker]: {
            price: 0,
            companyName: 'Error',
            marketCap: 0,
            pe: 0,
            forwardPE: 0,
            roic: 0,
            operatingMargin: 0,
            fcfYield: 0,
            interestCoverage: 0,
            loading: false,
            error: error instanceof Error ? error.message : 'Batch fetch failed'
          }
        }))
      })
    } finally {
      setLoadingStocks(prev => {
        const next = new Set(prev)
        normalizedTickers.forEach(ticker => next.delete(ticker))
        return next
            })
    }
  }, [])

  // Load watchlist from localStorage on component mount
  useEffect(() => {
    const savedWatchlist = localStorage.getItem('stockWatchlist')
    if (savedWatchlist) {
      try {
        const parsedWatchlist: Stock[] = JSON.parse(savedWatchlist)
        // Normalize all tickers to uppercase to match stockData / loadingStocks keys
        const normalizedWatchlist = parsedWatchlist.map(stock => ({
          ...stock,
          ticker: stock.ticker.toUpperCase()
        }))
        setWatchlist(normalizedWatchlist)

        const tickers = normalizedWatchlist.map((stock: Stock) => stock.ticker)
        const tickerIsEtfMap = Object.fromEntries(
          normalizedWatchlist.map((stock: Stock) => [stock.ticker, stock.isEtf])
        )
        const freshCache = getFreshCachedData(tickers)

        if (Object.keys(freshCache).length > 0) {
          setStockData(prev => ({
            ...prev,
            ...Object.fromEntries(
              Object.entries(freshCache).map(([ticker, cached]) => [ticker, stripCachedData(cached)])
            )
          }))
        }

        const missingTickers = tickers.filter((ticker: string) => !freshCache[ticker])
        if (missingTickers.length > 0) {
          fetchStockDataBatch(missingTickers, tickerIsEtfMap)
        }
      } catch (error) {
        console.error('Error loading watchlist from localStorage:', error)
        localStorage.removeItem('stockWatchlist')
      }
    }
    setIsInitialized(true)
  }, [fetchStockDataBatch])

  // Save watchlist to localStorage whenever it changes (after initialization)
  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem('stockWatchlist', JSON.stringify(watchlist))
    }
  }, [watchlist, isInitialized])

  const validateTicker = (ticker: string): { isValid: boolean; error?: string } => {
    const trimmedTicker = ticker.trim()

    // Check for empty string
    if (!trimmedTicker) {
      return { isValid: false, error: 'Please enter a stock ticker' }
    }

    // Check for valid ticker format (basic validation)
    if (!/^[A-Z]{1,5}$/.test(trimmedTicker.toUpperCase())) {
      return { isValid: false, error: 'Please enter a valid stock ticker (1-5 letters)' }
    }

    // Check for duplicates
    const upperTicker = trimmedTicker.toUpperCase()
    if (watchlist.some(stock => stock.ticker.toUpperCase() === upperTicker)) {
      return { isValid: false, error: `${upperTicker} is already in your watchlist` }
    }

    return { isValid: true }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()

    const validation = validateTicker(searchTerm)
    if (!validation.isValid) {
      alert(validation.error)
      return
    }

    if (!selectedCategory) {
      alert('Please select a category before adding the stock.')
      return
    }

    const ticker = searchTerm.trim().toUpperCase()
    addToWatchlist(ticker)
    setSearchTerm('')
  }

  const addToWatchlist = (ticker: string) => {
    const normalizedTicker = ticker.toUpperCase()
    const newStock: Stock = {
      ticker: normalizedTicker,
      category: selectedCategory as 'core' | 'satellite',
      isEtf: selectedIsEtf,
      addedDate: new Date().toISOString()
    }

    setWatchlist(prev => [...prev, newStock])

    // Pass isEtf directly to avoid race condition where watchlist state
    // hasn't flushed yet when fetchStockDataBatch is called
    const tickerIsEtfMap = { [normalizedTicker]: selectedIsEtf }
    fetchStockDataBatch([normalizedTicker], tickerIsEtfMap)
  }

  const removeFromWatchlist = (ticker: string) => {
    setWatchlist(prev => prev.filter(stock => stock.ticker !== ticker))
  }

  const updateStockCategory = (ticker: string, category: 'core' | 'satellite') => {
    setWatchlist(prev =>
      prev.map(stock =>
        stock.ticker === ticker ? { ...stock, category } : stock
      )
    )
  }

  const coreAssets = watchlist.filter(stock => stock.category === 'core')
  const satelliteAssets = watchlist.filter(stock => stock.category === 'satellite')

  return (
    <div className="search-watchlist">
      {selectedTickerForAnalysis && (
        <TechnicalAnalysisModal 
          ticker={selectedTickerForAnalysis}
          onClose={() => setSelectedTickerForAnalysis(null)}
        />
      )}
      <div className="search-section">
        <h2>Stock Search & Watchlist</h2>

        <form onSubmit={handleSearch} className="search-form">
          <div className="search-input-group">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Enter stock ticker (e.g., AAPL, TSLA, SPY)"
              className="search-input"
              maxLength={10}
            />
            <button type="submit" className="search-button">
              🔍 Search
            </button>
          </div>

          <div className="search-selectors-container">
            <div className="selector-group">
              <label htmlFor="category-select">Add to category:</label>
              <select
                id="category-select"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value as 'core' | 'satellite' | '')}
                className="category-select"
              >
                <option value="" disabled>
                  Select category...
                </option>
                <option value="core">Core</option>
                <option value="satellite">Satellite</option>
              </select>
            </div>
            <div className="selector-group">
              <label htmlFor="asset-type-select">Asset type:</label>
              <select
                id="asset-type-select"
                value={selectedIsEtf ? 'etf' : 'stock'}
                onChange={(e) => setSelectedIsEtf(e.target.value === 'etf')}
                className="category-select"
              >
                <option value="stock">Stock</option>
                <option value="etf">ETF</option>
              </select>
            </div>
          </div>
        </form>
      </div>

      <div className="watchlist-section">
        <h3>Your Watchlist ({watchlist.length} stocks)</h3>

        {watchlist.length === 0 ? (
          <div className="empty-watchlist">
            <p>No stocks in your watchlist yet.</p>
            <p>Search for a ticker above to get started!</p>
          </div>
        ) : (
          <div className="watchlist-categories">
            {/* Core Assets Section */}
            <div className="category-section">
              <h4>🏛️ Core Assets</h4>
              <p className="category-description">
                Long-term holdings like index ETFs and stable investments
              </p>
              {coreAssets.length === 0 ? (
                <p className="empty-category">No core assets yet</p>
              ) : (
                <div className="stocks-grid">
                  {coreAssets.map(stock => {
                    const key = stock.ticker.toUpperCase()
                    return (
                      <StockCard
                        key={key}
                        stock={stock}
                        fundamentalData={stockData[key]}
                        isLoading={loadingStocks.has(key)}
                        onRemove={removeFromWatchlist}
                        onCategoryChange={updateStockCategory}
                        onAnalyze={setSelectedTickerForAnalysis}
                      />
                    )
                  })}
                </div>
              )}
            </div>

            {/* Satellite Assets Section */}
            <div className="category-section">
              <h4>🚀 Satellite Assets</h4>
              <p className="category-description">
                Higher-risk, higher-reward individual stocks and sector plays
              </p>
              {satelliteAssets.length === 0 ? (
                <p className="empty-category">No satellite assets yet</p>
              ) : (
                <div className="stocks-grid">
                  {satelliteAssets.map(stock => {
                    const key = stock.ticker.toUpperCase()
                    return (
                      <StockCard
                        key={key}
                        stock={stock}
                        fundamentalData={stockData[key]}
                        isLoading={loadingStocks.has(key)}
                        onRemove={removeFromWatchlist}
                        onCategoryChange={updateStockCategory}
                        onAnalyze={setSelectedTickerForAnalysis}
                      />
                    )
                  })}
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  )
}

// ETF Performance Mini-Chart Component
interface EtfPerformanceChartProps {
  performance: PerformanceMetrics
}

const EtfPerformanceChart: React.FC<EtfPerformanceChartProps> = ({ performance }) => {
  const bars = [
    { label: 'YTD', value: performance.ytd },
    { label: '1Y',  value: performance.oneYear },
    { label: '3Y',  value: performance.threeYear },
  ]

  // Determine symmetric scale so 0 is always centred
  const absMax = Math.max(
    ...bars.map(b => Math.abs(b.value ?? 0)),
    1 // prevent divide-by-zero
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
      <span style={{ fontSize: '11px', color: '#9ca3af', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        Performance
      </span>
      {bars.map(({ label, value }) => {
        if (value === null || value === undefined) return null
        const isPositive = value >= 0
        const pct = Math.abs(value) / absMax // 0–1
        const color = isPositive ? '#10b981' : '#ef4444'
        const barWidth = `${Math.round(pct * 50)}%` // max 50% of container per side

        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '18px' }}>
            {/* Label */}
            <span style={{ width: '28px', fontSize: '11px', color: '#9ca3af', textAlign: 'right', flexShrink: 0 }}>
              {label}
            </span>

            {/* Left half (negative) */}
            <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', height: '100%', alignItems: 'center' }}>
              {!isPositive && (
                <div style={{
                  width: barWidth,
                  height: '10px',
                  backgroundColor: color,
                  borderRadius: '2px 0 0 2px',
                  opacity: 0.85,
                  transition: 'width 0.4s ease'
                }} />
              )}
            </div>

            {/* Centre line */}
            <div style={{ width: '1px', height: '16px', backgroundColor: '#374151', flexShrink: 0 }} />

            {/* Right half (positive) */}
            <div style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'center' }}>
              {isPositive && (
                <div style={{
                  width: barWidth,
                  height: '10px',
                  backgroundColor: color,
                  borderRadius: '0 2px 2px 0',
                  opacity: 0.85,
                  transition: 'width 0.4s ease'
                }} />
              )}
            </div>

            {/* Value label */}
            <span style={{ width: '52px', fontSize: '11px', color: color, fontWeight: 600, flexShrink: 0 }}>
              {value > 0 ? '+' : ''}{value.toFixed(2)}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

// Stock Card Component
interface StockCardProps {
  stock: Stock
  fundamentalData?: FundamentalData
  isLoading: boolean
  onRemove: (ticker: string) => void
  onCategoryChange: (ticker: string, category: 'core' | 'satellite') => void
  onAnalyze: (ticker: string) => void
}

const StockCard: React.FC<StockCardProps> = ({
  stock,
  fundamentalData,
  isLoading,
  onRemove,
  onCategoryChange,
  onAnalyze
}) => {
  const formatCurrency = (value: number) => {
    if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
    return `$${value.toFixed(2)}`
  }

  const formatNumber = (value: number, decimals: number = 2) => {
    return value.toFixed(decimals)
  }

  const getPEClass = (value: number): string => {
    if (value <= 0) return ''
    if (value > 40) return 'fundamental-danger'
    return ''
  }

  // Helper to determine if a percentage value should display as N/A
  // Display N/A only for undefined, null, or NaN - allow 0 as it's a valid value
  const shouldDisplayPercentage = (value: number | null | undefined): boolean => {
    return value !== null && value !== undefined && !isNaN(value)
  }

  // Helper to determine if a ratio value should display as N/A
  // Display N/A only if value is undefined, null, NaN, or not a number
  const shouldDisplayRatio = (value: number | null | undefined): boolean => {
    return value !== null && value !== undefined && !isNaN(value) && value !== 0
  }



  const getCategoryDisplayLabel = (): string => {
    switch (stock.category) {
      case 'core':
        return 'Core'
      case 'satellite':
        return 'Satellite'
      default:
        return stock.category
    }
  }

  return (
    <div 
      className="stock-card"
      onClick={() => onAnalyze(stock.ticker)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onAnalyze(stock.ticker)}
    >
      <div className="stock-card-header">
        <div>
          <h5 className="stock-ticker">
            {stock.ticker} {stock.isEtf && <span className="etf-badge">ETF</span>}
          </h5>
          <div className="stock-company">{fundamentalData?.companyName || 'Loading...'}</div>
          <div className="stock-category-label">Category: {getCategoryDisplayLabel()}</div>
        </div>
        <div className="stock-actions">
          <select
            value={stock.category}
            onChange={(e) => {
              e.stopPropagation()
              onCategoryChange(stock.ticker, e.target.value as 'core' | 'satellite')
            }}
            className="category-select-mini"
            aria-label={`Change category for ${stock.ticker}`}
          >
            <option value="core">Core</option>
            <option value="satellite">Satellite</option>
          </select>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove(stock.ticker)
            }}
            className="remove-button"
            title="Remove from watchlist"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="stock-fundamentals">
        {isLoading ? (
          <div className="loading-state">
            <p>Fetching fundamental data...</p>
          </div>
        ) : fundamentalData?.error ? (
          <div className="error-state">
            <p>Error: {fundamentalData.error}</p>
          </div>
        ) : fundamentalData ? (
          // ETF-specific layout
          stock.isEtf ? (
            <div className="fundamentals-grid etf-layout">
              {/* Row 1: Price & Market Cap */}
              <div className="fundamental-item">
                <span className="fundamental-label">Price:</span>
                <span className="fundamental-value">{fundamentalData.price > 0 ? formatCurrency(fundamentalData.price) : 'N/A'}</span>
              </div>
              <div className="fundamental-item">
                <span className="fundamental-label">Market Cap:</span>
                <span className="fundamental-value">{fundamentalData.marketCap > 0 ? formatCurrency(fundamentalData.marketCap) : 'N/A'}</span>
              </div>

              {/* Row 3: Mini performance bar chart */}
              {fundamentalData.performance && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <EtfPerformanceChart performance={fundamentalData.performance} />
                </div>
              )}
            </div>
          ) : (
            // Stock-specific layout (original)
            <div className="fundamentals-grid">
              <div className="fundamental-item">
                <span className="fundamental-label">Price:</span>
                <span className="fundamental-value">{fundamentalData.price > 0 ? formatCurrency(fundamentalData.price) : 'N/A'}</span>
              </div>
              <div className="fundamental-item">
                <span className="fundamental-label">Market Cap:</span>
                <span className="fundamental-value">{fundamentalData.marketCap > 0 ? formatCurrency(fundamentalData.marketCap) : 'N/A'}</span>
              </div>
              <div className="fundamental-item">
                <span className="fundamental-label">PE:</span>
                <span className={`fundamental-value ${getPEClass(fundamentalData.pe)}`}>
                  {fundamentalData.pe > 0 ? formatNumber(fundamentalData.pe) : 'N/A'}
                </span>
              </div>
              <div className="fundamental-item">
                <span className="fundamental-label">Forward PE:</span>
                <span className="fundamental-value">
                  {shouldDisplayRatio(fundamentalData.forwardPE) ? formatNumber(fundamentalData.forwardPE) : 'N/A'}
                </span>
              </div>
              <div className="fundamental-item">
                <span className="fundamental-label">ROIC:</span>
                <span className="fundamental-value">
                  {shouldDisplayPercentage(fundamentalData.roic) ? `${formatNumber(fundamentalData.roic * 100, 2)}%` : 'N/A'}
                </span>
              </div>
              <div className="fundamental-item">
                <span className="fundamental-label">Operating Margin:</span>
                <span className="fundamental-value">
                  {shouldDisplayPercentage(fundamentalData.operatingMargin) ? `${formatNumber(fundamentalData.operatingMargin * 100, 2)}%` : 'N/A'}
                </span>
              </div>
              <div className="fundamental-item">
                <span className="fundamental-label">FCF Yield:</span>
                <span className="fundamental-value">
                  {shouldDisplayPercentage(fundamentalData.fcfYield) ? `${formatNumber(fundamentalData.fcfYield * 100, 2)}%` : 'N/A'}
                </span>
              </div>
              <div className="fundamental-item">
                <span className="fundamental-label">Interest Coverage:</span>
                <span className="fundamental-value">
                  {fundamentalData.interestCoverage > 0 ? formatNumber(fundamentalData.interestCoverage) : 'N/A'}
                </span>
              </div>
            </div>
          )
        ) : (
          <div className="no-data-state">
            <p>No fundamental data available</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default SearchAndWatchlist