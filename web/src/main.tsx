import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ObdProvider } from './lib/obd.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ObdProvider>
      <App />
    </ObdProvider>
  </StrictMode>,
);
