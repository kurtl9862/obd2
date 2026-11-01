import { useEffect, useRef, useState } from 'react';
import { Download, Radar, Save, Square, Upload, Video } from 'lucide-react';
import { Card } from '../components/Card.tsx';
import { Sparkline } from '../components/Sparkline.tsx';
import { NotConnected } from './Dashboard.tsx';
import { useObd } from '../lib/obd.tsx';
import type { Settings } from '../lib/settings.ts';
import { display, fmt, fmtDuration } from '../lib/units.ts';
import {
  candidateToExtra,
  rangeRequests,
  rankCandidates,
  scanModule,
  takeSample,
  type Candidate,
  type ExploreService,
  type FoundBlock,
  type Sample,
} from '../../../core/explorer.ts';
import type { Module, VehicleProfile } from '../../../core/vehicles.ts';

interface Session {
  vehicleId: string;
  module: Module;
  blocks: FoundBlock[];
  startedAt: number;
  samples: Sample[];
}

const hexOk = (s: string, len: number) => new RegExp(`^[0-9A-F]{${len}}$`).test(s);

/**
 * Finds carmaker-only values on your own car (see core/explorer.ts). Stays mounted while you look at
 * other screens, so a recording keeps going.
 */
export function Explorer({ vehicle, settings, update }: { vehicle: VehicleProfile; settings: Settings; update: (p: Partial<Settings>) => void }) {
  const obd = useObd();
  const [moduleIdx, setModuleIdx] = useState(vehicle.modules.length > 1 ? 1 : 0);
  const [custom, setCustom] = useState({ request: '7E1', response: '7E9' });
  const [service, setService] = useState<ExploreService>(vehicle.make === 'Honda' ? '22' : '21');
  const [from, setFrom] = useState('01');
  const [to, setTo] = useState('FF');
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
  const [blocks, setBlocks] = useState<FoundBlock[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [intervalS, setIntervalS] = useState(5);
  const [session, setSession] = useState<Session | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const stopRef = useRef(false);

  const module: Module =
    moduleIdx < vehicle.modules.length ? vehicle.modules[moduleIdx] : { name: `Module ${custom.request}`, request: custom.request, response: custom.response };
  const idLen = service === '21' ? 2 : 4;
  const rangeOk = hexOk(from, idLen) && hexOk(to, idLen) && parseInt(from, 16) <= parseInt(to, 16);
  const moduleOk = hexOk(module.request, 3) && hexOk(module.response, 3);

  useEffect(() => {
    setFrom(service === '21' ? '01' : '1000');
    setTo(service === '21' ? 'FF' : '10FF');
  }, [service]);

  const runScan = async () => {
    setError(null);
    setBlocks([]);
    stopRef.current = false;
    const requests = rangeRequests(service, parseInt(from, 16), parseInt(to, 16));
    setScan({ done: 0, total: requests.length });
    try {
      const found = await obd.run((elm) =>
        scanModule(elm, module, requests, (done, total, f) => {
          setScan({ done, total });
          setBlocks([...f]);
        }, () => stopRef.current),
      );
      setBlocks(found);
      setChosen(new Set(found.map((b) => b.request)));
      if (!found.length) setError(`${module.name} didn’t answer any request in that range. Try the other service, another range, or check the ignition is on.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScan(null);
    }
  };

  const startRecording = () => {
    const use = blocks.filter((b) => chosen.has(b.request));
    setSession({ vehicleId: vehicle.id, module, blocks: use, startedAt: Date.now(), samples: [] });
    setRecording(true);
  };

  // Sample on a timer while recording.
  useEffect(() => {
    if (!recording || !session) return;
    let stop = false;
    const { module: m, blocks: b, startedAt } = session;
    const loop = async () => {
      while (!stop) {
        const began = Date.now();
        try {
          const s = await obd.run((elm) => takeSample(elm, m, b, Date.now() - startedAt));
          if (stop) return;
          setSession((prev) => (prev ? { ...prev, samples: [...prev.samples, s] } : prev));
        } catch (err) {
          setError((err as Error).message);
          if (obd.status !== 'connected') return;
        }
        await new Promise((r) => setTimeout(r, Math.max(200, intervalS * 1000 - (Date.now() - began))));
      }
    };
    void loop();
    return () => {
      stop = true;
    };
    // The session object changes every sample; restart only when recording starts or stops.
  }, [recording, obd.run, intervalS]);

  const candidates: Candidate[] = session ? rankCandidates(session.samples) : [];
  const last = session?.samples.at(-1);

  const exportSession = () => {
    if (!session) return;
    const blob = new Blob([JSON.stringify(session, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `explorer-${vehicle.id}-${new Date(session.startedAt).toISOString().slice(0, 16).replace(':', '')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importSession = async (file: File) => {
    try {
      const s = JSON.parse(await file.text()) as Session;
      if (!Array.isArray(s.samples) || !s.module) throw new Error('Not an explorer recording');
      setRecording(false);
      setSession(s);
      setBlocks(s.blocks);
    } catch (err) {
      setError(`Couldn’t open that file: ${(err as Error).message}`);
    }
  };

  const saveCandidate = (c: Candidate, name: string, short: string) => {
    const m = session?.module ?? module;
    const extra = candidateToExtra(c, m, name, short, new Date().toLocaleDateString());
    const mine = (settings.customExtras[vehicle.id] ?? []).filter((x) => x.id !== extra.id);
    update({
      customExtras: { ...settings.customExtras, [vehicle.id]: [extra, ...mine] },
      extras: [...new Set([...settings.extras, extra.id])],
    });
    setSaved(`Saved “${name}” to ${vehicle.name}. It’s on the dashboard now.`);
  };

  if (obd.status !== 'connected' && !session) return <NotConnected />;

  return (
    <div className="stack">
      <Card title="Explorer" icon={<Radar size={14} />} accent="violet" error={error}>
        <p className="muted">
          Finds values the carmaker doesn’t publish, like transmission fluid temperature. Scan a module, then record a drive that starts with a
          cold engine. Fluid temperature starts near the outside temperature and climbs with the coolant, so the bytes that do that rise to the
          top.
        </p>
        <div className="form-grid">
          <label className="field">
            <span>Module</span>
            <select value={moduleIdx} onChange={(e) => setModuleIdx(Number(e.target.value))} disabled={recording}>
              {vehicle.modules.map((m, i) => (
                <option key={m.request} value={i}>
                  {m.name} ({m.request} → {m.response})
                </option>
              ))}
              <option value={vehicle.modules.length}>Other address…</option>
            </select>
          </label>
          {moduleIdx >= vehicle.modules.length && (
            <>
              <label className="field">
                <span>Request id</span>
                <input value={custom.request} onChange={(e) => setCustom({ ...custom, request: e.target.value.toUpperCase() })} maxLength={3} />
              </label>
              <label className="field">
                <span>Reply id</span>
                <input value={custom.response} onChange={(e) => setCustom({ ...custom, response: e.target.value.toUpperCase() })} maxLength={3} />
              </label>
            </>
          )}
          <label className="field">
            <span>Service</span>
            <select value={service} onChange={(e) => setService(e.target.value as ExploreService)} disabled={recording}>
              <option value="21">21: read data block (Nissan, Toyota)</option>
              <option value="22">22: read data by id (Honda, Ford, GM, most newer cars)</option>
            </select>
          </label>
          <label className="field">
            <span>From</span>
            <input value={from} onChange={(e) => setFrom(e.target.value.toUpperCase())} maxLength={idLen} />
          </label>
          <label className="field">
            <span>To</span>
            <input value={to} onChange={(e) => setTo(e.target.value.toUpperCase())} maxLength={idLen} />
          </label>
        </div>
        <div className="row wrap">
          {scan ? (
            <>
              <progress max={scan.total} value={scan.done} />
              <span className="muted small">
                {scan.done} of {scan.total} · found {blocks.length}
              </span>
              <button className="btn-ghost" onClick={() => (stopRef.current = true)}>
                <Square size={12} /> Stop
              </button>
            </>
          ) : (
            <button className="btn-primary" onClick={() => void runScan()} disabled={!rangeOk || !moduleOk || recording || obd.status !== 'connected'}>
              <Radar size={13} /> Scan {module.name.toLowerCase()}
            </button>
          )}
          <label className="btn-ghost file-btn">
            <Upload size={13} /> Open a recording
            <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void importSession(e.target.files[0])} />
          </label>
        </div>
        {service === '22' && !scan && (
          <p className="muted small">Service 22 ids run to FFFF. Scan a few hundred at a time; each id that doesn’t answer takes about a second.</p>
        )}
      </Card>

      {blocks.length > 0 && (
        <Card
          title={`Found ${blocks.length} data block${blocks.length === 1 ? '' : 's'}`}
          icon={<Video size={14} />}
          accent="teal"
          actions={
            recording ? (
              <button className="btn-danger" onClick={() => setRecording(false)}>
                <Square size={12} /> Stop recording
              </button>
            ) : (
              <>
                <label className="field inline">
                  <span>Every</span>
                  <select value={intervalS} onChange={(e) => setIntervalS(Number(e.target.value))}>
                    {[2, 5, 10, 30].map((s) => (
                      <option key={s} value={s}>
                        {s} s
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn-primary" onClick={startRecording} disabled={!chosen.size || obd.status !== 'connected'}>
                  <Video size={13} /> {session ? 'Record again' : 'Start recording'}
                </button>
              </>
            )
          }
        >
          <div className="chips">
            {blocks.map((b) => (
              <label key={b.request} className="check chip">
                <input
                  type="checkbox"
                  disabled={recording}
                  checked={chosen.has(b.request)}
                  onChange={() => {
                    const next = new Set(chosen);
                    if (next.has(b.request)) next.delete(b.request);
                    else next.add(b.request);
                    setChosen(next);
                  }}
                />
                <code>{b.request}</code> <span className="muted small">{b.length} bytes</span>
              </label>
            ))}
          </div>
          {session && (
            <div className="row wrap">
              <span className="pill">{session.samples.length} samples</span>
              {last && <span className="pill">{fmtDuration(last.t / 1000)}</span>}
              {last?.coolant !== undefined && <span className="pill">Coolant {temp(last.coolant, settings)}</span>}
              {last?.intake !== undefined && <span className="pill">Intake air {temp(last.intake, settings)}</span>}
              <button className="btn-ghost" onClick={exportSession} disabled={!session.samples.length}>
                <Download size={13} /> Save recording
              </button>
            </div>
          )}
          {recording && (
            <p className="muted small">
              Drive normally until the coolant is fully warm (15 to 20 minutes from cold). You can use other screens meanwhile; they share the
              adapter, so everything updates a little slower.
            </p>
          )}
        </Card>
      )}

      {session && (
        <Card title="Likely temperatures" icon={<Radar size={14} />} accent="gold">
          {session.samples.length < 5 ? (
            <p className="muted">Collecting… candidates show up after 5 samples.</p>
          ) : candidates.length === 0 ? (
            <p className="muted">
              Nothing climbs like a temperature yet. Keep recording until the coolant has risen at least 15 °C (27 °F), or try other blocks.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Where</th>
                  <th>Formula</th>
                  <th>Start → now</th>
                  <th>Tracks coolant</th>
                  <th>Trend</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <CandidateRow key={`${c.request}-${c.letter}`} c={c} settings={settings} onSave={saveCandidate} />
                ))}
              </tbody>
            </table>
          )}
          {saved && <p className="good">{saved}</p>}
          <p className="muted small">
            The offset is a guess from the starting temperature, so check the saved value against something you trust (a dealer scan, an
            infrared thermometer on the pan) before relying on it.
          </p>
        </Card>
      )}
    </div>
  );
}

function temp(c: number, settings: Settings): string {
  const d = display(c, '°C', settings.units);
  return `${fmt(d.value, d.unit)} ${d.unit}`;
}

function CandidateRow({ c, settings, onSave }: { c: Candidate; settings: Settings; onSave: (c: Candidate, name: string, short: string) => void }) {
  const [name, setName] = useState('Transmission fluid temperature');
  const [open, setOpen] = useState(false);
  return (
    <tr>
      <td>
        <code>{c.request}</code> byte {c.letter}
      </td>
      <td>
        <code>{c.formula}</code>
      </td>
      <td>
        {temp(c.startC, settings)} → {temp(c.endC, settings)}
      </td>
      <td>{Math.round(c.correlation * 100)}%</td>
      <td className="trend">
        <Sparkline values={c.series} min={Math.min(...c.series)} max={Math.max(...c.series)} />
      </td>
      <td>
        {open ? (
          <span className="row">
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
            <button
              className="btn-primary"
              onClick={() => {
                onSave(c, name, /trans|atf|cvt/i.test(name) ? (/cvt/i.test(name) ? 'CVT' : 'ATF') : name.slice(0, 10));
                setOpen(false);
              }}
            >
              <Save size={13} /> Save
            </button>
          </span>
        ) : (
          <button className="btn-ghost" onClick={() => setOpen(true)}>
            <Save size={13} /> Use this
          </button>
        )}
      </td>
    </tr>
  );
}
