import { useEffect, useMemo, useRef, useState } from 'react';
import { Gauge, Pause, Play, SlidersHorizontal } from 'lucide-react';
import { Card } from '../components/Card.tsx';
import { Sparkline } from '../components/Sparkline.tsx';
import { useObd } from '../lib/obd.tsx';
import type { Settings } from '../lib/settings.ts';
import { display, fmt, type UnitSystem } from '../lib/units.ts';
import { DEFAULT_DASHBOARD, PID_BY_NUMBER, PIDS, type Unit } from '../../../core/pids.ts';
import { LiveReader, readExtra } from '../../../core/obd.ts';
import type { ExtraPid, VehicleProfile } from '../../../core/vehicles.ts';

const HISTORY = 60;

interface Reading {
  value?: number;
  error?: string;
  history: number[];
}

interface Tile {
  key: string;
  name: string;
  short: string;
  unit: Unit;
  min: number;
  max: number;
  warnHigh?: number;
  badge?: string;
}

export function Dashboard({
  settings,
  update,
  vehicle,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  vehicle: VehicleProfile;
}) {
  const obd = useObd();
  const [running, setRunning] = useState(true);
  const [editing, setEditing] = useState(false);
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [rate, setRate] = useState<number | null>(null);

  const pids = useMemo(() => {
    const wanted = settings.tiles ?? DEFAULT_DASHBOARD;
    return wanted.filter((p) => obd.supported.includes(p) && PID_BY_NUMBER.has(p));
  }, [settings.tiles, obd.supported]);
  const extras = useMemo(() => vehicle.extraPids.filter((x) => settings.extras.includes(x.id)), [vehicle, settings.extras]);

  const tiles: Tile[] = [
    ...extras.map((x) => ({ key: x.id, name: x.name, short: x.short, unit: x.unit, min: x.min, max: x.max, warnHigh: x.warnHigh, badge: x.verified ? undefined : 'unverified' })),
    ...pids.map((p) => {
      const d = PID_BY_NUMBER.get(p)!;
      return { key: String(p), name: d.name, short: d.short, unit: d.unit, min: d.min, max: d.max };
    }),
    { key: 'volts', name: 'Battery at the OBD port', short: 'Battery', unit: 'V' as Unit, min: 11, max: 15, badge: 'adapter' },
  ];

  // Poll while connected and running: standard values every cycle, carmaker values and battery
  // every few cycles (they're slower and change slowly).
  const readerRef = useRef<LiveReader | null>(null);
  const { run, status } = obd;
  useEffect(() => {
    if (status !== 'connected' || !running) return;
    let stop = false;
    let cycle = 0;
    const loop = async () => {
      while (!stop) {
        const started = performance.now();
        const batch: Record<string, { value?: number; error?: string }> = {};
        try {
          await run(async (elm) => {
            readerRef.current ??= new LiveReader(elm);
            const values = await readerRef.current.read(pids);
            for (const [pid, v] of values) batch[String(pid)] = { value: v };
            if (cycle % 4 === 0) {
              for (const x of extras) batch[x.id] = await readExtraSafe(elm, x);
              const v = await elm.voltage().catch(() => null);
              if (v !== null) batch.volts = { value: v };
            }
          });
        } catch (err) {
          if (stop) return;
          batch.__error = { error: (err as Error).message };
        }
        if (stop) return;
        cycle++;
        setRate(1000 / Math.max(1, performance.now() - started));
        setReadings((prev) => {
          const next = { ...prev };
          for (const [key, r] of Object.entries(batch)) {
            const old = prev[key] ?? { history: [] };
            next[key] = {
              value: r.value ?? old.value,
              error: r.error,
              history: r.value !== undefined ? [...old.history, r.value].slice(-HISTORY) : old.history,
            };
          }
          return next;
        });
        await new Promise((r) => setTimeout(r, 100));
      }
    };
    void loop();
    return () => {
      stop = true;
    };
  }, [status, run, running, pids, extras]);

  useEffect(() => {
    readerRef.current = null;
  }, [obd.info]);

  if (obd.status !== 'connected') return <NotConnected />;

  return (
    <div className="stack">
      <Card
        title="Live data"
        icon={<Gauge size={14} />}
        accent="coral"
        error={readings.__error?.error}
        actions={
          <>
            {rate !== null && running && <span className="updated">{rate.toFixed(1)} updates/s</span>}
            <button className="btn-ghost" onClick={() => setEditing((e) => !e)}>
              <SlidersHorizontal size={13} /> {editing ? 'Done' : 'Choose values'}
            </button>
            <button className="btn-ghost" onClick={() => setRunning((r) => !r)}>
              {running ? <Pause size={13} /> : <Play size={13} />} {running ? 'Pause' : 'Resume'}
            </button>
          </>
        }
      >
        {editing && <TilePicker settings={settings} update={update} supported={obd.supported} vehicle={vehicle} />}
        <div className="tiles">
          {tiles.map((t) => (
            <TileView key={t.key} tile={t} reading={readings[t.key]} units={settings.units} />
          ))}
        </div>
        {pids.length > 6 && <p className="muted small">Fewer values update faster, especially on clone adapters.</p>}
      </Card>
    </div>
  );
}

async function readExtraSafe(elm: Parameters<typeof readExtra>[0], x: ExtraPid): Promise<{ value?: number; error?: string }> {
  try {
    return { value: await readExtra(elm, x) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

function TileView({ tile, reading, units }: { tile: Tile; reading?: Reading; units: UnitSystem }) {
  const shown = reading?.value !== undefined ? display(reading.value, tile.unit, units) : null;
  const warn = tile.warnHigh !== undefined && reading?.value !== undefined && reading.value >= tile.warnHigh;
  const history = reading?.history.map((v) => display(v, tile.unit, units).value) ?? [];
  const lo = display(tile.min, tile.unit, units).value;
  const hi = display(tile.max, tile.unit, units).value;
  return (
    <div className={`tile ${warn ? 'is-warn' : ''}`} title={tile.name}>
      <div className="tile-head">
        <span className="tile-name">{tile.short}</span>
        {tile.badge && <span className="badge">{tile.badge}</span>}
      </div>
      <div className="tile-value">
        {shown ? fmt(shown.value, shown.unit) : '–'}
        <span className="tile-unit">{shown?.unit ?? display(0, tile.unit, units).unit}</span>
      </div>
      {reading?.error ? <div className="tile-error">{reading.error}</div> : <Sparkline values={history} min={lo} max={hi} />}
    </div>
  );
}

function TilePicker({
  settings,
  update,
  supported,
  vehicle,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  supported: number[];
  vehicle: VehicleProfile;
}) {
  const chosen = settings.tiles ?? DEFAULT_DASHBOARD;
  const toggle = (pid: number) =>
    update({ tiles: chosen.includes(pid) ? chosen.filter((p) => p !== pid) : [...chosen, pid] });
  const toggleExtra = (id: string) =>
    update({ extras: settings.extras.includes(id) ? settings.extras.filter((x) => x !== id) : [...settings.extras, id] });
  return (
    <div className="picker">
      {vehicle.extraPids.length > 0 && (
        <fieldset>
          <legend>{vehicle.name}</legend>
          {vehicle.extraPids.map((x) => (
            <label key={x.id} className="check" title={x.source}>
              <input type="checkbox" checked={settings.extras.includes(x.id)} onChange={() => toggleExtra(x.id)} />
              {x.name}
            </label>
          ))}
          {vehicle.extraPids.some((x) => !x.verified) && (
            <p className="muted small">Unverified values are educated guesses. Compare against a known reading before trusting them.</p>
          )}
        </fieldset>
      )}
      <fieldset>
        <legend>Standard values this car supports</legend>
        {PIDS.filter((p) => supported.includes(p.pid)).map((p) => (
          <label key={p.pid} className="check">
            <input type="checkbox" checked={chosen.includes(p.pid)} onChange={() => toggle(p.pid)} />
            {p.name}
          </label>
        ))}
        <button className="btn-ghost" onClick={() => update({ tiles: null })}>
          Reset to defaults
        </button>
      </fieldset>
    </div>
  );
}

export function NotConnected() {
  return (
    <div className="empty">
      <p>Connect to an adapter first (or try the simulator).</p>
    </div>
  );
}
