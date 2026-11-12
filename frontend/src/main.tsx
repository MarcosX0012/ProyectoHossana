import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary';

const container = document.getElementById('root');
if (!container) throw new Error('No se encontro el elemento #root');

createRoot(container).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
