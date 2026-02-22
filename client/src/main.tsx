import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { DemoModeProvider } from './contexts/DemoModeContext';
import { LensProvider } from './contexts/LensContext';
import ErrorBoundary from './components/ErrorBoundary';
import App from './App';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <DemoModeProvider>
          <WorkspaceProvider>
            <LensProvider>
              <App />
            </LensProvider>
          </WorkspaceProvider>
        </DemoModeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
