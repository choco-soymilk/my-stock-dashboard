import React, { useState, useEffect, useCallback } from 'react'
import { getCurrentAPIKey, rotateToNextAPIKey } from '../utils/apiKey'
import TechnicalAnalysisModal from './TechnicalAnalysisModal'
import '../styles/SearchAndWatchlist.css'


interface Stock {
  ticker: string
  category: 'core' | 'satellite'
  addedDate: string
}

interface FundamentalData {
  price: number
  companyName: string
  industry: string
  sector: string
  marketCap: number
  pe: number
  pb: number
  debtToEquity: number
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
  const [isInitialized, setIsInitialized] = useState(false)
  const [stockData, setStockData] = useState<StockData>({})
  const [loadingStocks, setLoadingStocks] = useState<Set<string>>(new Set())
  const [selectedTickerForAnalysis, setSelectedTickerForAnalysis] = useState<string | null>(null)


    const fetchStockDataBatch = useCallback(async (tickers: string[]) => {
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

    const makeRequest = async (apiKey: string, ticker: string) => {
      const profileUrl = `https://financialmodelingprep.com/stable/profile?symbol=${ticker}&apikey=${apiKey}`
      const metricsUrl = `https://financialmodelingprep.com/stable/key-metrics?symbol=${ticker}&period=annual&apikey=${apiKey}`
      const ratiosUrl = `https://financialmodelingprep.com/stable/ratios?symbol=${ticker}&period=annual&apikey=${apiKey}`

      return Promise.allSettled([
        fetch(profileUrl),
        fetch(metricsUrl),
        fetch(ratiosUrl)
      ])
    }

    try {
      let tickerResponses = await Promise.all(normalizedTickers.map(ticker => makeRequest(API_KEY, ticker)))

      // Check if any request was rate limited (429/403) and retry with next key
      const needsRetry = tickerResponses.some(([profileRes, metricsRes, ratiosRes]: any) =>
        [profileRes, metricsRes, ratiosRes].some(res => res?.status === 'fulfilled' && [429, 403].includes(res.value.status))
      )

      if (needsRetry) {
        console.warn('[SearchAndWatchlist] Rate limit hit, rotating API key...')
        API_KEY = rotateToNextAPIKey()
        tickerResponses = await Promise.all(normalizedTickers.map(ticker => makeRequest(API_KEY, ticker)))
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
        const [profileRes, metricsRes, ratiosRes] = tickerResponses[index]

        const profileData = profileRes.status === 'fulfilled' && profileRes.value.ok
          ? normalizeApiArray(await profileRes.value.json())
          : []

        const metricsData = metricsRes.status === 'fulfilled' && metricsRes.value.ok
          ? normalizeApiArray(await metricsRes.value.json())
          : []

        const ratiosData = ratiosRes.status === 'fulfilled' && ratiosRes.value.ok
          ? normalizeApiArray(await ratiosRes.value.json())
          : []

        const profileMap = profileData.reduce<Record<string, any>>((acc, item) => {
          if (item?.symbol) acc[item.symbol.toUpperCase()] = item
          return acc
        }, {})

        const metricsMap = metricsData.reduce<Record<string, any>>((acc, item) => {
          if (item?.symbol) acc[item.symbol.toUpperCase()] = item
          return acc
        }, {})

        const ratiosMap = ratiosData.reduce<Record<string, any>>((acc, item) => {
          if (item?.symbol) acc[item.symbol.toUpperCase()] = item
          return acc
        }, {})

        const profile = profileMap[ticker]
        const metrics = metricsMap[ticker]
        const ratios = ratiosMap[ticker]

        const price = profile?.price ?? 0
        const companyName = profile?.companyName || 'Unknown'
        const industry = profile?.industry || 'N/A'
        const sector = profile?.sector || 'N/A'
        const marketCap = profile?.marketCap ?? profile?.mktCap ?? 0

        let pe = 0
        let pb = 0
        let debtToEquity = 0

        if (metrics) {
          pe = metrics.peRatio ?? metrics.priceToEarningsRatio ?? metrics.priceEarningsRatio ?? 0
          pb = metrics.pbRatio ?? metrics.priceToBookRatio ?? metrics.priceBookRatio ?? 0
        }

        if (ratios) {
          debtToEquity = ratios.debtToEquityRatio ?? ratios.debtToEquity ?? 0
          if (pe === 0) {
            pe = ratios.priceToEarningsRatio ?? ratios.priceToEarnings ?? ratios.priceEarningsRatio ?? 0
          }
          if (pb === 0) {
            pb = ratios.priceToBookRatio ?? ratios.priceBookRatio ?? ratios.priceToBook ?? 0
          }
        }

        nextStockData[ticker] = {
          price,
          companyName,
          industry,
          sector,
          marketCap,
          pe,
          pb,
          debtToEquity,
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
    } catch (error) {
      console.error('Batch fetch error:', error)
      normalizedTickers.forEach(ticker => {
        setStockData(prev => ({
          ...prev,
          [ticker]: {
            price: 0,
            companyName: 'Error',
            industry: 'N/A',
            sector: 'N/A',
            marketCap: 0,
            pe: 0,
            pb: 0,
            debtToEquity: 0,
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

  const fetchStockData = useCallback(async (ticker: string) => {

    const cached = getFreshCachedData([ticker])[ticker]
    if (cached) {
      setStockData(prev => ({
        ...prev,
        [ticker]: stripCachedData(cached)
      }))
      return
    }

    await fetchStockDataBatch([ticker])
  }, [fetchStockDataBatch])

  // Load watchlist from localStorage on component mount
  useEffect(() => {
    const savedWatchlist = localStorage.getItem('stockWatchlist')
    if (savedWatchlist) {
      try {
        const parsedWatchlist = JSON.parse(savedWatchlist)
        setWatchlist(parsedWatchlist)

        const tickers = parsedWatchlist.map((stock: Stock) => stock.ticker.toUpperCase())
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
          fetchStockDataBatch(missingTickers)
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
    const newStock: Stock = {
      ticker,
      category: selectedCategory as 'core' | 'satellite',
      addedDate: new Date().toISOString()
    }

    setWatchlist(prev => [...prev, newStock])

    // Fetch data for the new stock
    fetchStockData(ticker)
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

          <div className="category-selector">
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
              <option value="satellite">Satellite</option>
              <option value="core">Core</option>
            </select>
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
                  {coreAssets.map(stock => (
                    <StockCard
                      key={stock.ticker}
                      stock={stock}
                      fundamentalData={stockData[stock.ticker]}
                      isLoading={loadingStocks.has(stock.ticker)}
                      onRemove={removeFromWatchlist}
                      onCategoryChange={updateStockCategory}
                      onAnalyze={setSelectedTickerForAnalysis}
                    />
                  ))}
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
                  {satelliteAssets.map(stock => (
                    <StockCard
                      key={stock.ticker}
                      stock={stock}
                      fundamentalData={stockData[stock.ticker]}
                      isLoading={loadingStocks.has(stock.ticker)}
                      onRemove={removeFromWatchlist}
                      onCategoryChange={updateStockCategory}
                      onAnalyze={setSelectedTickerForAnalysis}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
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

  const isETF = (companyName: string): boolean => {
    return /ETF|Fund|Trust/.test(companyName)
  }

  const getDebtEquityClass = (value: number): string => {
    if (value <= 0) return ''
    if (value >= 2.0) return 'fundamental-danger'
    if (value < 1.0) return 'fundamental-success'
    return ''
  }

  const getPEClass = (value: number): string => {
    if (value <= 0) return ''
    if (value > 40) return 'fundamental-danger'
    return ''
  }

  const getPBClass = (value: number): string => {
    if (value <= 0) return ''
    if (value < 1.0) return 'fundamental-success'
    return ''
  }

  const isETFStock = fundamentalData?.companyName ? isETF(fundamentalData.companyName) : false

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
          <h5 className="stock-ticker">{stock.ticker}</h5>
          <div className="stock-category-label">Category: {stock.category === 'core' ? 'Core' : 'Satellite'}</div>
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
            <option value="satellite">Satellite</option>
            <option value="core">Core</option>
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
          <div className="fundamentals-grid">
            <div className="fundamental-item">
              <span className="fundamental-label">Price:</span>
              <span className="fundamental-value">{fundamentalData.price > 0 ? formatCurrency(fundamentalData.price) : 'N/A'}</span>
            </div>
            <div className="fundamental-item">
              <span className="fundamental-label">Company:</span>
              <span className="fundamental-value">{fundamentalData.companyName || 'N/A'}</span>
            </div>
            <div className="fundamental-item">
              <span className="fundamental-label">Industry:</span>
              <span className="fundamental-value">{fundamentalData.industry || 'N/A'}</span>
            </div>
            <div className="fundamental-item">
              <span className="fundamental-label">Sector:</span>
              <span className="fundamental-value">{fundamentalData.sector || 'N/A'}</span>
            </div>
            <div className="fundamental-item">
              <span className="fundamental-label">Market Cap:</span>
              <span className="fundamental-value">{fundamentalData.marketCap > 0 ? formatCurrency(fundamentalData.marketCap) : 'N/A'}</span>
            </div>
            {!isETFStock && (
              <div className="fundamental-item">
                <span className="fundamental-label">P/E:</span>
                <span className={`fundamental-value ${getPEClass(fundamentalData.pe)}`}>
                  {fundamentalData.pe > 0 ? formatNumber(fundamentalData.pe) : 'N/A'}
                </span>
              </div>
            )}
            {!isETFStock && (
              <div className="fundamental-item">
                <span className="fundamental-label">P/B:</span>
                <span className={`fundamental-value ${getPBClass(fundamentalData.pb)}`}>
                  {fundamentalData.pb > 0 ? formatNumber(fundamentalData.pb) : 'N/A'}
                </span>
              </div>
            )}
            {!isETFStock && (
              <div className="fundamental-item">
                <span className="fundamental-label">Debt/Equity:</span>
                <span className={`fundamental-value ${getDebtEquityClass(fundamentalData.debtToEquity)}`}>
                  {fundamentalData.debtToEquity > 0 ? formatNumber(fundamentalData.debtToEquity) : 'N/A'}
                </span>
              </div>
            )}
          </div>
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