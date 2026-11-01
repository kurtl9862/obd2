import { useState } from 'react';
import { AlertTriangle, Camera, ExternalLink, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { Card } from '../components/Card.tsx';
import { NotConnected } from './Dashboard.tsx';
import { useObd } from '../lib/obd.tsx';
import { display, fmt, type UnitSystem } from '../lib/units.ts';
import { clearCodes, NegativeResponse, readCodes, readFreezeFrame, type FoundCode, type FreezeFrame } from '../../../core/obd.ts';
import { describeDtc, DTC_SYSTEMS, isManufacturerCode } from '../../../core/dtc.ts';
import { PID_BY_NUMBER } from '../../../core/pids.ts';
import { moduleName, type VehicleProfile } from '../../../core/vehicles.ts';
import { askClaudeUrl } from '../../../core/nhtsa.ts';

const KIND_LABEL = { stored: 'Stored', pending: 'Pending', permanent: 'Permanent' } as const;

export function Codes({ vehicle, units }: { vehicle: VehicleProfile; units: UnitSystem }) {
  const obd = useObd();
  const [codes, setCodes] = useState<FoundCode[] | null>(null);
  const [frame, setFrame] = useState<FreezeFrame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (obd.status !== 'connected') return <NotConnected />;

  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      setCodes(await obd.run(readCodes));
      setFrame(await obd.run(readFreezeFrame).catch(() => null));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      const modules = await obd.run(clearCodes);
      setNotice(`Cleared by ${modules.map((m) => moduleName(vehicle, m)).join(' and ')}.`);
    } catch (err) {
      if (err instanceof NegativeResponse && (err.nrc === 0x22 || err.nrc === 0x33)) {
        setError(
          err.nrc === 0x22
            ? 'The car refused: turn the engine off, leave the ignition on, and try again.'
            : 'The car refused for security. Some newer cars (like 2020+ Nissans) need a gateway bypass cable to clear codes.',
        );
      } else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
    await read();
  };

  const byModule = new Map<string, FoundCode[]>();
  for (const c of codes ?? []) byModule.set(c.ecu, [...(byModule.get(c.ecu) ?? []), c]);

  return (
    <div className="stack">
      <Card
        title="Trouble codes"
        icon={<AlertTriangle size={14} />}
        accent="gold"
        error={error}
        actions={
          <>
            <button className="btn-primary" disabled={busy} onClick={() => void read()}>
              <RefreshCw size={13} /> {codes ? 'Read again' : 'Read codes'}
            </button>
            <button className="btn-danger" disabled={busy || codes === null} onClick={() => setConfirming(true)}>
              <Trash2 size={13} /> Clear codes
            </button>
          </>
        }
      >
        {notice && <p className="good">{notice}</p>}
        {codes === null && <p className="muted">Reads stored, pending and permanent codes from every module that answers.</p>}
        {codes?.length === 0 && <p className="good">No codes. Nothing is stored or pending.</p>}
        {[...byModule].map(([ecu, list]) => (
          <div key={ecu} className="module">
            <h3>{moduleName(vehicle, ecu)}</h3>
            <ul className="codes">
              {list.map((c) => (
                <CodeRow key={`${c.kind}-${c.code}`} code={c} vehicle={vehicle} />
              ))}
            </ul>
          </div>
        ))}
        <p className="muted small">
          Pending codes were seen once but not confirmed. Permanent codes can’t be cleared by any tool; they go away after the car re-tests
          the fault and passes.
        </p>
      </Card>

      {frame && (
        <Card title={`Freeze frame for ${frame.code}`} icon={<Camera size={14} />} accent="blue">
          <p className="muted small">What the engine was doing when this code was saved.</p>
          <dl className="facts">
            {[...frame.values].map(([pid, v]) => {
              const d = PID_BY_NUMBER.get(pid)!;
              const shown = display(v, d.unit, units);
              return (
                <div key={pid} className="fact">
                  <dt>{d.name}</dt>
                  <dd>
                    {fmt(shown.value, shown.unit)} {shown.unit}
                  </dd>
                </div>
              );
            })}
          </dl>
        </Card>
      )}

      {confirming && (
        <div className="dialog-backdrop" role="dialog" aria-modal aria-labelledby="clear-title">
          <div className="dialog">
            <h2 id="clear-title">Clear all codes?</h2>
            <ul>
              <li>The check-engine light goes off, but the problem isn’t fixed. A real fault comes back.</li>
              <li>
                <b>Smog readiness resets.</b> The car won’t pass an inspection until it has been driven through its self-tests, often a few
                days of mixed driving.
              </li>
              <li>Freeze frame data is erased. Write down anything you need first.</li>
              {vehicle.notes
                .filter((n) => /gateway/i.test(n))
                .map((n) => (
                  <li key={n}>{n}</li>
                ))}
            </ul>
            <p className="muted small">Engine off, ignition on works best.</p>
            <div className="row">
              <button className="btn-ghost" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="btn-danger" onClick={() => void clear()}>
                <Trash2 size={13} /> Clear codes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CodeRow({ code, vehicle }: { code: FoundCode; vehicle: VehicleProfile }) {
  const name = describeDtc(code.code);
  const car = vehicle.make ? `${vehicle.name}${vehicle.engine ? ` with the ${vehicle.engine} and ${vehicle.transmission}` : ''}` : '';
  const query = encodeURIComponent(`${code.code} ${vehicle.make ? `${vehicle.year ?? ''} ${vehicle.make} ${vehicle.model}` : ''}`.trim());
  return (
    <li className={`code is-${code.kind}`}>
      <span className="code-id">{code.code}</span>
      <span className="badge">{KIND_LABEL[code.kind]}</span>
      <span className="code-name">
        {name ?? (isManufacturerCode(code.code) ? `${DTC_SYSTEMS[code.code[0]]} code specific to the carmaker` : `${DTC_SYSTEMS[code.code[0]]} code`)}
      </span>
      <span className="code-actions">
        <a
          className="btn-ghost"
          href={askClaudeUrl(code.code, name, car, `It's a ${KIND_LABEL[code.kind].toLowerCase()} code from the ${moduleName(vehicle, code.ecu)}.`)}
          target="_blank"
          rel="noreferrer"
        >
          <Sparkles size={12} /> Ask Claude
        </a>
        <a className="btn-ghost" href={`https://www.google.com/search?q=${query}`} target="_blank" rel="noreferrer">
          Search <ExternalLink size={12} />
        </a>
      </span>
    </li>
  );
}
