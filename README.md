# Stock Information Dashboard

A Vite + TypeScript + React web application for systematic US stock market analysis and risk management.

## Features

- **Macro Dashboard (Global)**: Displays macroeconomic indicators (CPI, interest rates) and major market index trends to gauge overall market health
- **Personalized Watchlist**: Search, add, and save specific stocks with deep analysis capabilities
- **Micro/Fundamental Analysis**: SEC filing summaries, profitability metrics, and cash flow analysis
- **Technical Analysis**: Price charts, moving averages, and other technical indicators
- **Long-term Investment Focus**: Supports fundamental-based investing strategies

## Tech Stack

- **Frontend**: React 18 with TypeScript
- **Build Tool**: Vite for fast development and optimized builds
- **Styling**: CSS Modules
- **Linting**: ESLint with TypeScript support

## Project Structure

```
stock-information/
├── src/
│   ├── components/       # Reusable React components
│   ├── pages/           # Page-level components
│   ├── hooks/           # Custom React hooks
│   ├── utils/           # Utility functions
│   ├── types/           # TypeScript type definitions
│   ├── App.tsx          # Main App component
│   ├── main.tsx         # Application entry point
│   └── index.css        # Global styles
├── public/              # Static assets
├── index.html           # HTML template
├── vite.config.ts       # Vite configuration
├── tsconfig.json        # TypeScript configuration
└── package.json         # Project dependencies
```

## Getting Started

### Prerequisites

- Node.js 18.x or higher
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Start development server:
```bash
npm run dev
```

3. Open [http://localhost:5173](http://localhost:5173) in your browser

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint to check code quality

## Development Guidelines

- Use TypeScript for type safety across the application
- Follow component-based architecture with functional components
- Keep components focused and reusable
- Use hooks for state management and side effects
- Maintain responsive UI design for all screen sizes
- Comment complex logic and business rules

## API Integration

The dashboard will integrate with financial data APIs (TBD) to fetch:
- Macroeconomic indicators
- Stock price data
- Fundamental company metrics
- Technical analysis data

## Performance Considerations

- Implement code splitting for faster initial load
- Use lazy loading for page components
- Optimize re-renders with React.memo and useCallback
- Consider pagination for large datasets

## Future Enhancements

- Real-time stock price updates with WebSocket
- Advanced charting library integration
- Portfolio tracking and performance analytics
- User authentication and data persistence
- Mobile app with React Native
- Dark/light theme toggle

## Contributing

When contributing to this project:
1. Create a new branch for each feature
2. Follow the existing code style and conventions
3. Write meaningful commit messages
4. Ensure code passes linting checks
5. Test changes thoroughly before submitting

## License

MIT License - feel free to use this project for personal or commercial purposes.

## Support

For issues or questions, please create an issue in the project repository.
