import React, { useState, useEffect } from 'react'
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts'
import { getCurrentAPIKey, rotateToNextAPIKey } from '../utils/apiKey'
import '../styles/TechnicalAnalysisModal.css'

interface ChartData {
  date: string
  close: number
  sma20?: number
  sma50?: number
  sma200?: number
  rsi?: number
}

interface TechnicalAnalysisModalProps {
  ticker: string
  onClose: () => void
}

const TechnicalAnalysisModal: React.FC<TechnicalAnalysisModalProps> = ({ ticker, onClose }) => {
  const [chartData, setChartData] = useState<ChartData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly'>('daily')

  // Calculate Simple Moving Average
  const calculateSMA = (data: ChartData[], period: number): ChartData[] => {
    return data.map((item, index) => {
      if (index < period - 1) return item

      const sum = data
        .slice(index - period + 1, index + 1)
        .reduce((acc, curr) => acc + curr.close, 0)
      const sma = sum / period

      return {
        ...item,
        ...(period === 20 && { sma20: parseFloat(sma.toFixed(2)) }),
        ...(period === 50 && { sma50: parseFloat(sma.toFixed(2)) }),
        ...(period === 200 && { sma200: parseFloat(sma.toFixed(2)) })
      }
    })
  }

  // Calculate RSI (Relative Strength Index)
  const calculateRSI = (data: ChartData[], period: number = 14): ChartData[] => {
    return data.map((item, index) => {
      if (index < period) return item

      const changes = data
        .slice(index - period + 1, index + 1)
        .map((d, i) => (i === 0 ? 0 : d.close - data[index - period + i].close))

      const gains = changes.filter(c => c > 0).reduce((a, b) => a + b, 0)
      const losses = Math.abs(changes.filter(c => c < 0).reduce((a, b) => a + b, 0))

      const avgGain = gains / period
      const avgLoss = losses / period
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
      const rsi = 100 - 100 / (1 + rs)

      return {
        ...item,
        rsi: parseFloat(rsi.toFixed(2))
      }
    })
  }

  useEffect(() => {
    const fetchChartData = async () => {
      setLoading(true)
      setError(null)

      try {
        let apiKey = getCurrentAPIKey()
        console.log('[TechnicalAnalysisModal] Fetching data for:', ticker, 'with API key:', apiKey.slice(0, 8) + '...')

        const fetchWithKey = async (key: string) => {
          const url = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(ticker)}&apikey=${key}`
          console.log('[TechnicalAnalysisModal] Fetching URL:', url.replace(key, 'KEY***'))
          return fetch(url)
        }

        let response = await fetchWithKey(apiKey)
        console.log('[TechnicalAnalysisModal] Initial response status:', response.status)

        // If rate limited (429) or forbidden (403), try next API key
        if (response.status === 429 || response.status === 403) {
          console.warn(`[TechnicalAnalysisModal] Status ${response.status}, rotating API key...`)
          apiKey = rotateToNextAPIKey()
          response = await fetchWithKey(apiKey)
          console.log('[TechnicalAnalysisModal] Retry response status:', response.status)
        }

        if (!response.ok) {
          throw new Error(`API Error: ${response.status} ${response.statusText}`)
        }

        const data = await response.json()
        console.log('[TechnicalAnalysisModal] API response received, keys:', Object.keys(data))
        processChartData(data)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Error fetching chart data'
        console.error('[TechnicalAnalysisModal] Fetch error:', errorMessage, err)
        setError(errorMessage)
        setLoading(false)
      }
    }

    const getWeekKey = (dateString: string) => {
      const date = new Date(dateString)
      const day = date.getUTCDay()
      const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1)
      const weekStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), diff))
      return `${weekStart.getUTCFullYear()}-${weekStart.getUTCMonth() + 1}-${weekStart.getUTCDate()}`
    }

    const aggregateWeeklyData = (prices: ChartData[]) => {
      const weeklyMap: Record<string, ChartData> = {}
      prices.forEach(item => {
        const weekKey = getWeekKey(item.date)
        weeklyMap[weekKey] = item
      })
      return Object.values(weeklyMap)
    }

    const processChartData = (data: any) => {
      console.log('[TechnicalAnalysisModal] API response data:', data)
      console.log('[TechnicalAnalysisModal] Data type:', typeof data, 'Is array:', Array.isArray(data))

      // Handle different API response structures
      let historicalData: any[] = []

      // Structure 1: { historical: [...] }
      if (data && data.historical && Array.isArray(data.historical)) {
        historicalData = data.historical
        console.log('[TechnicalAnalysisModal] Found data.historical array with', historicalData.length, 'items')
      }
      // Structure 2: Direct array response
      else if (Array.isArray(data)) {
        historicalData = data
        console.log('[TechnicalAnalysisModal] Data is direct array with', historicalData.length, 'items')
      }
      // Structure 3: { results: [...] }
      else if (data && data.results && Array.isArray(data.results)) {
        historicalData = data.results
        console.log('[TechnicalAnalysisModal] Found data.results array with', historicalData.length, 'items')
      }

      if (!historicalData || historicalData.length === 0) {
        console.error('[TechnicalAnalysisModal] No historical data found. Full response:', JSON.stringify(data).slice(0, 500))
        setError('No historical data available for this stock')
        setLoading(false)
        return
      }

      console.log('[TechnicalAnalysisModal] First item:', historicalData[0])

      let prices = historicalData
        .map((item: any) => ({
          date: item.date,
          close: item.close
        }))
        .filter((item: ChartData) => item.date && item.close)
        .reverse()

      console.log('[TechnicalAnalysisModal] Processed', prices.length, 'price points')

      if (prices.length === 0) {
        console.error('[TechnicalAnalysisModal] No valid price data after filtering')
        setError('No valid price data found')
        setLoading(false)
        return
      }

      prices = prices.slice(-260)

      if (timeframe === 'weekly') {
        prices = aggregateWeeklyData(prices)
      }

      prices = prices.slice(-200)

      console.log('[TechnicalAnalysisModal] Final chart data:', prices.length, 'points')

      let processed = calculateSMA(prices, 20)
      processed = calculateSMA(processed, 50)
      processed = calculateSMA(processed, 200)
      processed = calculateRSI(processed, 14)

      setChartData(processed)
      setLoading(false)
    }

    fetchChartData()
  }, [ticker, timeframe])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Technical Analysis - {ticker}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-controls">
          <div className="timeframe-selector">
            <button
              className={`timeframe-btn ${timeframe === 'daily' ? 'active' : ''}`}
              onClick={() => setTimeframe('daily')}
            >
              Daily
            </button>
            <button
              className={`timeframe-btn ${timeframe === 'weekly' ? 'active' : ''}`}
              onClick={() => setTimeframe('weekly')}
            >
              Weekly
            </button>
          </div>
        </div>

        {loading ? (
          <div className="modal-loading">
            <p>Loading technical analysis data...</p>
          </div>
        ) : error ? (
          <div className="modal-error">
            <p>Error: {error}</p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="modal-error">
            <p>No data available for this stock</p>
          </div>
        ) : (
          <div className="modal-body">
            {/* Price Chart with Moving Averages */}
            <div className="chart-section">
              <h3>Price & Moving Averages</h3>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    interval={Math.floor(chartData.length / 10)}
                  />
                  <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#f9f9f9', border: '1px solid #ddd', borderRadius: '4px' }}
                    formatter={(value: any) => value ? value.toFixed(2) : 'N/A'}
                  />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="close"
                    stroke="#1976d2"
                    strokeWidth={2}
                    dot={false}
                    name="Close Price"
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="sma20"
                    stroke="#ff7300"
                    strokeWidth={1.5}
                    dot={false}
                    name="SMA 20"
                    strokeDasharray="5 5"
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="sma50"
                    stroke="#00b050"
                    strokeWidth={1.5}
                    dot={false}
                    name="SMA 50"
                    strokeDasharray="5 5"
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="sma200"
                    stroke="#d32f2f"
                    strokeWidth={1.5}
                    dot={false}
                    name="SMA 200"
                    strokeDasharray="5 5"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* RSI Chart */}
            <div className="chart-section">
              <h3>Relative Strength Index (RSI)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    interval={Math.floor(chartData.length / 10)}
                  />
                  <YAxis tick={{ fontSize: 12 }} domain={[0, 100]} ticks={[0, 30, 50, 70, 100]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#f9f9f9', border: '1px solid #ddd', borderRadius: '4px' }}
                    formatter={(value: any) => value ? value.toFixed(2) : 'N/A'}
                  />
                  {/* Overbought/Oversold Area Shading */}
                  <ReferenceArea y1={70} y2={100} fill="#ff7300" fillOpacity={0.08} />
                  <ReferenceArea y1={0} y2={30} fill="#00b050" fillOpacity={0.08} />
                  
                  <Area
                    type="monotone"
                    dataKey="rsi"
                    stroke="#8884d8"
                    fill="#8884d8"
                    fillOpacity={0.3}
                    name="RSI 14"
                  />
                  {/* Strictly fixed reference lines */}
                  <ReferenceLine 
                    y={70} 
                    stroke="#ff7300" 
                    strokeDasharray="5 5" 
                    label={{ value: '70', position: 'insideRight', fill: '#ff7300', fontSize: 10, fontWeight: 600 }} 
                  />
                  <ReferenceLine 
                    y={30} 
                    stroke="#00b050" 
                    strokeDasharray="5 5" 
                    label={{ value: '30', position: 'insideRight', fill: '#00b050', fontSize: 10, fontWeight: 600 }} 
                  />
                </AreaChart>
              </ResponsiveContainer>
              <div className="rsi-legend">
                <span className="rsi-overbought">Overbought (RSI &gt; 70)</span>
                <span className="rsi-neutral">Normal</span>
                <span className="rsi-oversold">Oversold (RSI &lt; 30)</span>
              </div>
            </div>

            {/* Technical Summary */}
            <div className="technical-summary">
              <h3>Technical Summary</h3>
              {chartData.length > 0 && (
                <div className="summary-grid">
                  <div className="summary-item">
                    <span className="summary-label">Current Price:</span>
                    <span className="summary-value">${chartData[chartData.length - 1].close.toFixed(2)}</span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">SMA 20:</span>
                    <span className="summary-value">${(chartData[chartData.length - 1].sma20 || 0).toFixed(2)}</span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">SMA 50:</span>
                    <span className="summary-value">${(chartData[chartData.length - 1].sma50 || 0).toFixed(2)}</span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">SMA 200:</span>
                    <span className="summary-value">${(chartData[chartData.length - 1].sma200 || 0).toFixed(2)}</span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">RSI 14:</span>
                    <span className={`summary-value ${
                      (chartData[chartData.length - 1].rsi || 0) > 70 ? 'rsi-high' :
                      (chartData[chartData.length - 1].rsi || 0) < 30 ? 'rsi-low' : 'rsi-normal'
                    }`}>
                      {(chartData[chartData.length - 1].rsi || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default TechnicalAnalysisModal
