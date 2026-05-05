// API Key Management with automatic fallback on rate limit
const API_KEY_STORAGE_KEY = 'fmp_api_key_index'
const RATE_LIMIT_STORAGE_KEY = 'fmp_rate_limit_status'

// Load API keys from .env file
const getAPIKeys = (): string[] => {
  const keys: string[] = []
  
  // Try to load from import.meta.env
  const key1 = import.meta.env.VITE_FMP_API_KEY_1
  const key2 = import.meta.env.VITE_FMP_API_KEY_2
  const key3 = import.meta.env.VITE_FMP_API_KEY_3
  
  if (key1) keys.push(key1)
  if (key2) keys.push(key2)
  if (key3) keys.push(key3)
  
  // If no env vars loaded, use fallback
  if (keys.length === 0) {
    console.warn('[API Key Management] No env keys found, using fallback keys')
    keys.push(
      'Oz15gZ6dcPPFmqEdcLOsLlUujJc8OoEk',
      'dmANV575WJXoDMIFYz9CZm2sDFSNqfrI'
    )
  }
  
  return keys
}

const API_KEYS = getAPIKeys()

console.log('[API Key Management] Loaded API keys:', API_KEYS.length, 'keys available')
console.log('[API Key Management] Keys:', API_KEYS.map((k, i) => `#${i + 1}: ${k.slice(0, 8)}...`).join(', '))

export const getCurrentAPIKeyIndex = (): number => {
  try {
    const stored = localStorage.getItem(API_KEY_STORAGE_KEY)
    const index = stored ? parseInt(stored, 10) : 0
    return index < API_KEYS.length ? index : 0
  } catch {
    return 0
  }
}

export const getCurrentAPIKey = (): string => {
  const index = getCurrentAPIKeyIndex()
  return API_KEYS[index] || ''
}

export const rotateToNextAPIKey = (): string => {
  try {
    const currentIndex = getCurrentAPIKeyIndex()
    const nextIndex = (currentIndex + 1) % API_KEYS.length
    localStorage.setItem(API_KEY_STORAGE_KEY, nextIndex.toString())
    console.log(`Switched to API key #${nextIndex + 1}`)
    return API_KEYS[nextIndex] || ''
  } catch (error) {
    console.error('Error rotating API key:', error)
    return getCurrentAPIKey()
  }
}

export const markRateLimitHit = (index: number): void => {
  try {
    const status = localStorage.getItem(RATE_LIMIT_STORAGE_KEY)
    const rateLimitedIndices = status ? JSON.parse(status) : []
    if (!rateLimitedIndices.includes(index)) {
      rateLimitedIndices.push(index)
      localStorage.setItem(RATE_LIMIT_STORAGE_KEY, JSON.stringify(rateLimitedIndices))
    }
  } catch (error) {
    console.error('Error marking rate limit:', error)
  }
}

export const getAllAPIKeys = (): string[] => API_KEYS

export const getAvailableAPIKeyCount = (): number => API_KEYS.length

export const resetAPIKeyRotation = (): void => {
  try {
    localStorage.removeItem(API_KEY_STORAGE_KEY)
    localStorage.removeItem(RATE_LIMIT_STORAGE_KEY)
    console.log('API key rotation reset to initial state')
  } catch (error) {
    console.error('Error resetting API key rotation:', error)
  }
}
