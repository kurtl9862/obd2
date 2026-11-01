import { useEffect, useState } from 'react';
import { Car, Cpu } from 'lucide-react';
import { Card } from '../components/Card.tsx';
import { useObd } from '../lib/obd.tsx';
import { VEHICLES, type VehicleProfile } from '../../../core/vehicles.ts';
import { vinMaker, vinModelYear } from '../../../core/vin.ts';
import { PID_BY_NUMBER } from '../../../core/pids.ts';

export function Vehicle({ vehicle, onPick }: { vehicle: VehicleProfile; onPick: (id: string) => void }) {
  const obd = useObd();
  const [volts, setVolts] = useState<number | null>(null);
  const { run, status } = obd;

  useEffect(() => {
    if (status === 'connected') run((elm) => elm.voltage()).then(setVolts, () => setVolts(null));
  }, [status, run]);

  return (
    <div className="stack two-col">
      <Card title="Vehicle" icon={<Car size={14} />} accent="violet">
        <label className="field">
          <span>Profile</span>
          <select value={vehicle.id} onChange={(e) => onPick(e.target.value)}>
            {VEHICLES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        {vehicle.make && (
          <dl className="facts">
            <dt>Engine</dt>
            <dd>{vehicle.engine}</dd>
            <dt>Transmission</dt>
            <dd>{vehicle.transmission}</dd>
            <dt>Modules</dt>
            <dd>{vehicle.modules.map((m) => `${m.name} (${m.request} → ${m.response})`).join(', ')}</dd>
          </dl>
        )}
        {vehicle.extraPids.length > 0 && (
          <>
            <h3>Carmaker-specific values</h3>
            <ul className="plain">
              {vehicle.extraPids.map((x) => (
                <li key={x.id}>
                  <b>{x.name}</b> <span className="badge">{x.verified ? 'verified' : 'unverified'}</span>
                  <div className="muted small">
                    Request <code>{x.request}</code> to {x.module.name} ({x.module.request}), formula <code>{x.formula.length > 40 ? 'polynomial' : x.formula}</code>.{' '}
                    {x.source}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <h3>Notes</h3>
        <ul className="plain">
          {vehicle.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Card>

      <Card title="This car and adapter" icon={<Cpu size={14} />} accent="blue">
        {status !== 'connected' ? (
          <p className="muted">Connect to see the VIN, protocol and supported values.</p>
        ) : (
          <>
            <dl className="facts">
              <dt>VIN</dt>
              <dd>
                <code>{obd.vin ?? 'not reported'}</code>
              </dd>
              {obd.vin && (
                <>
                  <dt>From the VIN</dt>
                  <dd>
                    {vinModelYear(obd.vin) ?? '?'} {vinMaker(obd.vin) ?? 'unknown maker'}
                  </dd>
                </>
              )}
              <dt>Adapter</dt>
              <dd>{obd.info?.version}</dd>
              <dt>Protocol</dt>
              <dd>{obd.info?.protocolName}</dd>
              <dt>Battery</dt>
              <dd>{volts !== null ? `${volts.toFixed(1)} V` : '–'}</dd>
            </dl>
            <h3>Standard values supported ({obd.supported.length})</h3>
            <p className="muted small">
              {obd.supported
                .map((p) => PID_BY_NUMBER.get(p)?.name ?? `PID ${p.toString(16).toUpperCase().padStart(2, '0')}`)
                .join(' · ')}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
