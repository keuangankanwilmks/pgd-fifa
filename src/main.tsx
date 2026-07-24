import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { PWAProvider } from './contexts/PWAContext.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <PWAProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </PWAProvider>
    </ErrorBoundary>
  </StrictMode>,
);
