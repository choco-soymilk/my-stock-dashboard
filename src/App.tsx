import { useState } from 'react'
import Navigation from './components/Navigation'
import MacroDashboard from './components/MacroDashboard'
import SearchAndWatchlist from './components/SearchAndWatchlist'
import './App.css'

function App() {
  const [activeView, setActiveView] = useState<'dashboard' | 'watchlist'>('dashboard')

  return (
    <div className="app-container">
      <Navigation activeView={activeView} onViewChange={setActiveView} />

      <main className="main-content">
        {activeView === 'dashboard' ? (
          <MacroDashboard />
        ) : (
          <SearchAndWatchlist />
        )}
      </main>
    </div>
  )
}

export default App
