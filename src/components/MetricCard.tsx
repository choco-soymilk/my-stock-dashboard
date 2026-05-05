import React from 'react'
import '../styles/MetricCard.css'

interface MetricCardProps {
  title: string
  value: string | number
  change: string
  period: string
  icon: string
  color: 'primary' | 'secondary' | 'success' | 'danger'
}

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  change,
  period,
  icon,
  color
}) => {
  return (
    <div className={`metric-card metric-card--${color}`}>
      <div className="metric-card__header">
        <span className="metric-card__icon">{icon}</span>
        <h3 className="metric-card__title">{title}</h3>
      </div>

      <div className="metric-card__content">
        <div className="metric-card__value">{value}</div>
        <div className="metric-card__change">{change}</div>
      </div>

      <div className="metric-card__footer">
        <p className="metric-card__period">{period}</p>
      </div>
    </div>
  )
}

export default MetricCard
