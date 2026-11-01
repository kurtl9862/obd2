import { useState } from 'react';
import { Car } from 'lucide-react';
import { Segmented } from './components/Segmented.tsx';
import { useObd } from './lib/obd.tsx';
import { useSettings } from './lib/settings.ts';
import { Connect } from './views/Connect.tsx';
import { Dashboard } from './views/Dashboard.tsx';
import { Codes } from './views/Codes.tsx';
import { Readiness } from './views/Readiness.tsx';
import { Vehicle } from './views/Vehicle.tsx';
import { Console } from './views/Console.tsx';
import { suggestVehicles, vehicleById, VEHICLES } from '../../core/vehicles.ts';
import { vinMaker, vinModelYear } from '../../core/vin.ts';

type View = 'connect' | 'dashboard' | 'codes' | 'readiness' | 'vehicle' | 'console';

export default function App() {
  const obd = useObd();
  const [settings, update] = useSettings();
  const [view, setView] = useState<View>('connect');
  const vehicle = vehicleById(settings.vehicleId);
  const connected = obd.status === 'connected';

  // After connecting, offer the profile that matches the VIN if a different one is picked.
  const suggestion = obd.vin ? suggestVehicles(vinMaker(obd.vin), vinModelYear(obd.vin))[0] : undefined;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const showSuggestion = suggestion && suggestion.id !== vehicle.id && dismissed !== obd.vin;

  const views: { value: View; label: string; disabled?: boolean }[] = [
    { value: 'connect', label: 'Connect' },
    { value: 'dashboard', label: 'Dashboard', disabled: !connected },
    { value: 'codes', label: 'Codes', disabled: !connected },
    { value: 'readiness', label: 'Smog check', disabled: !connected },
    { value: 'vehicle', label: 'Vehicle' },
    { value: 'console', label: 'Console' },
  ];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-mark">
            <Car size={16} />
          </span>
          <span>OBD2</span>
        </div>
        <select className="vehicle-select" aria-label="Vehicle" value={vehicle.id} onChange={(e) => update({ vehicleId: e.target.value })}>
          {VEHICLES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <div className="top-right">
          <Segmented
            label="Units"
            value={settings.units}
            options={[
              { value: 'us', label: '°F mph' },
              { value: 'metric', label: '°C km/h' },
            ]}
            onChange={(u) => update({ units: u })}
          />
          <span className={`pill status is-${obd.status}`}>
            {obd.status === 'connected' ? obd.info?.protocolName.replace(/^ISO 15765-4 /, '') : obd.status === 'connecting' ? 'Connecting…' : obd.status === 'error' ? 'Disconnected' : 'Not connected'}
          </span>
        </div>
      </header>

      <nav className="nav">
        <Segmented label="View" value={view} options={views} onChange={setView} />
      </nav>

      {showSuggestion && (
        <div className="banner">
          <span>
            This looks like your <b>{suggestion.name}</b>.
          </span>
          <button className="btn-primary" onClick={() => update({ vehicleId: suggestion.id })}>
            Switch
          </button>
          <button className="btn-ghost" onClick={() => setDismissed(obd.vin)}>
            Not now
          </button>
        </div>
      )}

      <main>
        {view === 'connect' && <Connect settings={settings} update={update} />}
        {view === 'dashboard' && <Dashboard settings={settings} update={update} vehicle={vehicle} />}
        {view === 'codes' && <Codes vehicle={vehicle} units={settings.units} />}
        {view === 'readiness' && <Readiness vehicle={vehicle} />}
        {view === 'vehicle' && <Vehicle vehicle={vehicle} onPick={(id) => update({ vehicleId: id })} />}
        {view === 'console' && <Console />}
      </main>
    </div>
  );
}
