import { useEffect, useMemo, useRef, useState } from 'react';
import { Car } from 'lucide-react';
import { CarPhoto } from './components/CarPhoto.tsx';
import { Segmented } from './components/Segmented.tsx';
import { DemoBanner } from './components/DemoBanner.tsx';
import { IS_DEMO } from './lib/mode.ts';
import { seedDemoDrives } from './lib/demo.ts';
import { useObd } from './lib/obd.tsx';
import { useSettings } from './lib/settings.ts';
import { Connect } from './views/Connect.tsx';
import { Dashboard } from './views/Dashboard.tsx';
import { Codes } from './views/Codes.tsx';
import { Readiness } from './views/Readiness.tsx';
import { Vehicle } from './views/Vehicle.tsx';
import { Console } from './views/Console.tsx';
import { Explorer } from './views/Explorer.tsx';
import { Logs } from './views/Logs.tsx';
import { Report } from './views/Report.tsx';
import { suggestVehicles, vehicleById, VEHICLES, withCustomExtras } from '../../core/vehicles.ts';
import { vinMaker, vinModelYear } from '../../core/vin.ts';

type View = 'connect' | 'dashboard' | 'codes' | 'readiness' | 'report' | 'explorer' | 'logs' | 'vehicle' | 'console';

export default function App() {
  const obd = useObd();
  const [settings, update] = useSettings();
  const [view, setView] = useState<View>(IS_DEMO ? 'dashboard' : 'connect');
  const custom = settings.customExtras[settings.vehicleId];
  // Memoized: the dashboard's polling loop restarts whenever the vehicle object changes.
  const vehicle = useMemo(() => withCustomExtras(vehicleById(settings.vehicleId), custom), [settings.vehicleId, custom]);
  const connected = obd.status === 'connected';

  // Demo mode: connect to the pretend car straight away, and again for each vehicle picked.
  const demoConnected = useRef<string | null>(null);
  const [demoRun, setDemoRun] = useState(0);
  const { connect } = obd;
  useEffect(() => {
    const key = `${settings.vehicleId}:${demoRun}`;
    if (!IS_DEMO || demoConnected.current === key) return;
    demoConnected.current = key;
    void connect('sim', { ...settings, connection: 'sim' });
  }, [settings, demoRun, connect]);
  const resetDemo = async () => {
    await seedDemoDrives(true);
    setDemoRun((n) => n + 1);
  };

  // After connecting, offer the profile that matches the VIN if a different one is picked.
  const suggestion = obd.vin ? suggestVehicles(vinMaker(obd.vin), vinModelYear(obd.vin))[0] : undefined;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const showSuggestion = suggestion && suggestion.id !== vehicle.id && dismissed !== obd.vin;

  const views: { value: View; label: string; disabled?: boolean }[] = [
    { value: 'connect', label: 'Connect' },
    { value: 'dashboard', label: 'Dashboard', disabled: !connected },
    { value: 'codes', label: 'Codes', disabled: !connected },
    { value: 'readiness', label: 'Smog check', disabled: !connected },
    { value: 'report', label: 'Report', disabled: !connected },
    { value: 'explorer', label: 'Explorer' },
    { value: 'logs', label: 'Logs' },
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
          <span>OBD2{IS_DEMO && <span className="muted"> demo</span>}</span>
        </div>
        <div className="vehicle-pick">
          <CarPhoto vehicleId={vehicle.id} name={vehicle.name} size="thumb" />
          <select className="vehicle-select" aria-label="Vehicle" value={vehicle.id} onChange={(e) => update({ vehicleId: e.target.value })}>
          {VEHICLES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
          </select>
        </div>
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

      {IS_DEMO && <DemoBanner onReset={() => void resetDemo()} />}

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
        {/* Dashboard and Explorer stay mounted so a recording keeps going on other screens. */}
        <Dashboard settings={settings} update={update} vehicle={vehicle} visible={view === 'dashboard'} />
        <div hidden={view !== 'explorer'}>
          <Explorer key={vehicle.id} vehicle={vehicle} settings={settings} update={update} />
        </div>
        {view === 'logs' && <Logs key={demoRun} units={settings.units} />}
        {view === 'codes' && <Codes vehicle={vehicle} units={settings.units} />}
        {view === 'readiness' && <Readiness vehicle={vehicle} />}
        {view === 'report' && <Report vehicle={vehicle} settings={settings} />}
        {view === 'vehicle' && <Vehicle vehicle={vehicle} onPick={(id) => update({ vehicleId: id })} settings={settings} update={update} />}
        {view === 'console' && <Console />}
      </main>
    </div>
  );
}
