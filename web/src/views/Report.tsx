import { useState } from 'react';
import { FileText, Printer, RefreshCw } from 'lucide-react';
import { Card } from '../components/Card.tsx';
import { CarPhoto } from '../components/CarPhoto.tsx';
import { NotConnected } from './Dashboard.tsx';
import { useObd } from '../lib/obd.tsx';
import { display, fmt, type UnitSystem } from '../lib/units.ts';
import { recallsOnline } from '../lib/online.ts';
import { collectHealth, healthFlags, type HealthCheck } from '../../../core/health.ts';
import { describeDtc, DTC_SYSTEMS } from '../../../core/dtc.ts';
import { PID_BY_NUMBER } from '../../../core/pids.ts';
import { smogVerdict } from '../../../core/readiness.ts';
import { vinModelYear } from '../../../core/vin.ts';
import { moduleName, type VehicleProfile } from '../../../core/vehicles.ts';
import type { Recall } from '../../../core/nhtsa.ts';
import type { Settings } from '../lib/settings.ts';

const KIND = { stored: 'Stored', pending: 'Pending', permanent: 'Permanent' } as const;

/** A one-page summary to save as PDF and send to a mechanic, or keep with the car's papers. */
export function Report({ vehicle, settings }: { vehicle: VehicleProfile; settings: Settings }) {
  const obd = useObd();
  const units: UnitSystem = settings.units;
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [recalls, setRecalls] = useState<Recall[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (obd.status !== 'connected') return <NotConnected />;

  const extras = vehicle.extraPids.filter((x) => settings.extras.includes(x.id));
  const build = async () => {
    setBusy(true);
    setError(null);
    try {
      const h = await obd.run((elm) => collectHealth(elm, extras, obd.supported));
      setHealth(h);
      const year = (h.vin && vinModelYear(h.vin)) || vehicle.year;
      if (vehicle.make && year) setRecalls(await recallsOnline(vehicle.make, vehicle.model, year, settings.bridgeUrl).catch(() => null));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const year = (health?.vin && vinModelYear(health.vin)) || vehicle.year;
  const verdict = health?.readiness ? smogVerdict(health.readiness, year) : null;
  const show = (v: number, unit: Parameters<typeof display>[1]) => {
    const d = display(v, unit, units);
    return `${fmt(d.value, d.unit)} ${d.unit}`.trim();
  };

  return (
    <div className="stack report">
      <Card
        title="Health report"
        icon={<FileText size={14} />}
        accent="teal"
        error={error}
        actions={
          <>
            <button className="btn-primary" disabled={busy} onClick={() => void build()}>
              <RefreshCw size={13} /> {busy ? 'Checking…' : health ? 'Check again' : 'Check the car'}
            </button>
            <button className="btn-ghost" disabled={!health} onClick={() => window.print()}>
              <Printer size={13} /> Print or save PDF
            </button>
          </>
        }
      >
        {!health && (
          <p className="muted">
            Reads codes, smog readiness, battery and the values a mechanic looks at first, then checks NHTSA for open recalls. Engine running
            and warm gives the most useful numbers.
          </p>
        )}
        {health && (
          <div className="report-body">
            <header className="report-head">
              <div>
                <h2>{vehicle.make ? vehicle.name : 'Vehicle health report'}</h2>
                <div className="muted small">
                  VIN <code>{health.vin ?? 'not reported'}</code> · {new Date(health.at).toLocaleString([], { dateStyle: 'long', timeStyle: 'short' })}
                </div>
              </div>
              {vehicle.make && <CarPhoto vehicleId={vehicle.id} name={vehicle.name} size="tile" />}
            </header>

            <ul className="flags">
              {healthFlags(health).map((f) => (
                <li key={f.text} className={`flag is-${f.level}`}>
                  {f.text}
                </li>
              ))}
            </ul>

            <h3>Trouble codes</h3>
            {health.codes === null ? (
              <p className="muted small">Couldn’t read codes.</p>
            ) : health.codes.length === 0 ? (
              <p className="small">None stored, pending or permanent.</p>
            ) : (
              <table className="report-table">
                <tbody>
                  {health.codes.map((c) => (
                    <tr key={`${c.ecu}-${c.kind}-${c.code}`}>
                      <td>
                        <b>{c.code}</b>
                      </td>
                      <td>{KIND[c.kind]}</td>
                      <td>{describeDtc(c.code) ?? `${DTC_SYSTEMS[c.code[0]]} code specific to the carmaker`}</td>
                      <td className="muted">{moduleName(vehicle, c.ecu)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3>Smog readiness</h3>
            {verdict && health.readiness ? (
              <p className="small">
                <b>{verdict.pass ? 'Likely to pass.' : 'Not ready.'}</b> {verdict.reason}{' '}
                {health.readiness.monitors.filter((m) => m.state === 'incomplete').length > 0 &&
                  `Incomplete: ${health.readiness.monitors
                    .filter((m) => m.state === 'incomplete')
                    .map((m) => m.name.toLowerCase())
                    .join(', ')}.`}
              </p>
            ) : (
              <p className="muted small">Not reported.</p>
            )}

            <h3>Readings</h3>
            <table className="report-table">
              <tbody>
                {health.battery !== null && (
                  <tr>
                    <td>Battery (at the OBD port)</td>
                    <td>{health.battery.toFixed(1)} V</td>
                  </tr>
                )}
                {[...health.values].map(([pid, v]) => {
                  const d = PID_BY_NUMBER.get(pid)!;
                  return (
                    <tr key={pid}>
                      <td>{d.name}</td>
                      <td>{show(v, d.unit)}</td>
                    </tr>
                  );
                })}
                {health.extras.map(({ extra, value }) => (
                  <tr key={extra.id}>
                    <td>
                      {extra.name}
                      {!extra.verified && <span className="muted"> (unverified formula)</span>}
                    </td>
                    <td>{show(value, extra.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {vehicle.make && (
              <>
                <h3>Open recalls (NHTSA)</h3>
                {recalls === null ? (
                  <p className="muted small">Couldn’t reach NHTSA. Check nhtsa.gov/recalls with the VIN.</p>
                ) : recalls.length === 0 ? (
                  <p className="small">
                    None listed for the {year} {vehicle.make} {vehicle.model}.
                  </p>
                ) : (
                  <>
                    <p className="small">
                      {recalls.length} recall{recalls.length === 1 ? '' : 's'} for the {year} {vehicle.make} {vehicle.model}. Whether this VIN was
                      already fixed: nhtsa.gov/recalls or any {vehicle.make} dealer.
                    </p>
                    <ul className="small recall-list">
                      {recalls.map((r) => (
                        <li key={r.campaign}>
                          <b>{r.component}</b> ({r.campaign}, {r.date}){r.parkIt && <b className="bad-text"> Do not drive until fixed.</b>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}

            {health.problems.length > 0 && (
              <p className="muted small">The car didn’t answer: {health.problems.join('; ')}.</p>
            )}
            <p className="muted small print-only">Made with the OBD2 app, read through the car’s diagnostic port.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
