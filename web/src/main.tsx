import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ObdProvider } from './lib/obd.tsx';
import { IS_DEMO } from './lib/mode.ts';
import { seedDemoDrives } from './lib/demo.ts';
import './styles.css';

const render = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ObdProvider>
        <App />
      </ObdProvider>
    </StrictMode>,
  );

// Demo mode: put the sample drives in place before the Logs screen can look for them.
if (IS_DEMO) seedDemoDrives().catch(() => {}).finally(render);
else render();
