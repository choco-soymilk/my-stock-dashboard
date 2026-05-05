import React from 'react'
import '../styles/Navigation.css'

interface NavigationProps {
  activeView: 'dashboard' | 'watchlist'
  onViewChange: (view: 'dashboard' | 'watchlist') => void
}

const Navigation: React.FC<NavigationProps> = ({ activeView, onViewChange }) => {
  return (
    <nav className="navigation">
      <div className="nav-container">
        <div className="nav-brand">
          <h1>📊 Stock Information</h1>
        </div>

        <div className="nav-links">
          <button
            className={`nav-link ${activeView === 'dashboard' ? 'active' : ''}`}
            onClick={() => onViewChange('dashboard')}
          >
            🏛️ Macro Dashboard
          </button>
          <button
            className={`nav-link ${activeView === 'watchlist' ? 'active' : ''}`}
            onClick={() => onViewChange('watchlist')}
          >
            📈 Watchlist
          </button>
        </div>
      </div>
    </nav>
  )
}

export default Navigation