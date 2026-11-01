import { useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Circle, Gauge, Pause, Play, SlidersHorizontal, Square } from 'lucide-react';
import { Card } from '../components/Card.tsx';
import { Sparkline } from '../components/Sparkline.tsx';
import { useObd } from '../lib/obd.tsx';
import type { Settings } from '../lib/settings.ts';
import { display, fmt, fmtDuration, type UnitSystem } from '../lib/units.ts';
import { saveDrive, type Drive } from '../lib/drives.ts';
import { beep } from '../lib/alarm.ts';
import { DEFAULT_DASHBOARD, PID_BY_NUMBER, PIDS, type Unit } from '../../../core/pids.ts';
import { LiveReader, readExtra } from '../../../core/obd.ts';
import { litersPer100km, litersPerHourFromMaf } from '../../../core/fuel.ts';
import type { ExtraPid, VehicleProfile } from '../../../core/vehicles.ts';

const HISTORY = 60;
const SPEED = 0x0d;
const MAF = 0x10;
const FUEL_RATE = 0x5e;

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
  visible,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  vehicle: VehicleProfile;
  /** The dashboard stays mounted so a recording survives switching screens; it only polls when shown or recording. */
  visible: boolean;
}) {
  const obd = useObd();
  const [running, setRunning] = useState(true);
  const [editing, setEditing] = useState(false);
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [rate, setRate] = useState<number | null>(null);
  const [alarm, setAlarm] = useState<string | null>(null);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [, tick] = useState(0);
  // GPS for recorded drives: the Mac's location (Wi-Fi based, or the iPhone's when tethered).
  const gps = useRef<{ lat: number; lon: number; at: number } | null>(null);
  const gpsWatch = useRef<number | null>(null);
  const [gpsState, setGpsState] = useState<'off' | 'waiting' | 'on' | 'denied'>('off');
  useEffect(() => () => stopGps(), []);

  const pids = useMemo(() => {
    const wanted = settings.tiles ?? DEFAULT_DASHBOARD;
    return wanted.filter((p) => obd.supported.includes(p) && PID_BY_NUMBER.has(p));
  }, [settings.tiles, obd.supported]);
  const extras = useMemo(() => vehicle.extraPids.filter((x) => settings.extras.includes(x.id)), [vehicle, settings.extras]);

  // Fuel economy needs speed plus fuel rate (preferred) or mass airflow, read even if not shown.
  const fuelSource = obd.supported.includes(FUEL_RATE) ? FUEL_RATE : obd.supported.includes(MAF) ? MAF : null;
  const economy = settings.showEconomy && fuelSource !== null && obd.supported.includes(SPEED);
  const polled = useMemo(
    () => (economy ? [...new Set([...pids, SPEED, fuelSource!])] : pids),
    [economy, pids, fuelSource],
  );

  const tiles: Tile[] = [
    ...extras.map((x) => ({
      key: x.id,
      name: x.name,
      short: x.short,
      unit: x.unit,
      min: x.min,
      max: x.max,
      warnHigh: x.warnHigh,
      badge: x.verified ? undefined : 'unverified',
    })),
    ...(economy ? [{ key: 'economy', name: 'Fuel economy (instant)', short: 'Economy', unit: 'L/100km' as Unit, min: 0, max: 30 }] : []),
    ...pids.map((p) => {
      const d = PID_BY_NUMBER.get(p)!;
      return { key: String(p), name: d.name, short: d.short, unit: d.unit, min: d.min, max: d.max, warnHigh: p === 0x05 ? 110 : undefined };
    }),
    { key: 'volts', name: 'Battery at the OBD port', short: 'Battery', unit: 'V' as Unit, min: 11, max: 15, badge: 'adapter' },
  ];
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;
  const alarmSoundRef = useRef(settings.alarmSound);
  alarmSoundRef.current = settings.alarmSound;
  const unitsRef = useRef(settings.units);
  unitsRef.current = settings.units;

  // A drive being recorded: rows are added every cycle and saved every 15 seconds.
  const drive = useRef<Drive | null>(null);
  const lastSave = useRef(0);
  const over = useRef(new Set<string>());

  const readerRef = useRef<LiveReader | null>(null);
  const { run, status } = obd;
  useEffect(() => {
    if (status !== 'connected' || !running || (!visible && recordingSince === null)) return;
    let stop = false;
    let cycle = 0;
    const loop = async () => {
      while (!stop) {
        const started = performance.now();
        const batch: Record<string, { value?: number; error?: string }> = {};
        try {
          await run(async (elm) => {
            readerRef.current ??= new LiveReader(elm);
            const values = await readerRef.current.read(polled);
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

        // Derived values: fuel flow and economy.
        const speed = batch[String(SPEED)]?.value;
        const flow = fuelSource === FUEL_RATE ? batch[String(FUEL_RATE)]?.value : batch[String(MAF)]?.value !== undefined ? litersPerHourFromMaf(batch[String(MAF)]!.value!) : undefined;
        if (flow !== undefined) batch.lph = { value: flow };
        if (flow !== undefined && speed !== undefined) {
          const l100 = litersPer100km(flow, speed);
          batch.economy = l100 === null ? { error: 'stopped' } : { value: l100 };
        }

        checkAlarms(batch);
        record(batch);
        setRate(1000 / Math.max(1, performance.now() - started));
        setReadings((prev) => {
          const next = { ...prev };
          for (const [key, r] of Object.entries(batch)) {
            const old = prev[key] ?? { history: [] };
            next[key] = {
              value: r.error === 'stopped' ? undefined : (r.value ?? old.value),
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
    // checkAlarms and record only read refs, so they don't need to restart the loop.
  }, [status, run, running, polled, extras, fuelSource, visible, recordingSince === null]);

  useEffect(() => {
    readerRef.current = null;
  }, [obd.info]);

  // Save whatever was recorded if the app closes or the adapter disconnects mid-drive.
  useEffect(() => () => void stopRecording(), []);
  useEffect(() => {
    if (status !== 'connected' && drive.current) void stopRecording();
  }, [status]);

  // Refresh the recording clock once a second.
  useEffect(() => {
    if (recordingSince === null) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [recordingSince]);

  function checkAlarms(batch: Record<string, { value?: number }>) {
    for (const t of tilesRef.current) {
      const v = batch[t.key]?.value;
      if (t.warnHigh === undefined || v === undefined) continue;
      if (v >= t.warnHigh && !over.current.has(t.key)) {
        over.current.add(t.key);
        const shown = display(v, t.unit, unitsRef.current);
        setAlarm(`${t.name} is ${fmt(shown.value, shown.unit)} ${shown.unit}`);
        if (alarmSoundRef.current) beep();
      } else if (v < t.warnHigh - 3 && over.current.has(t.key)) {
        over.current.delete(t.key); // a little hysteresis so it doesn't chatter at the limit
        if (over.current.size === 0) setAlarm(null);
      }
    }
  }

  function startGps() {
    if (!('geolocation' in navigator)) return;
    setGpsState('waiting');
    gpsWatch.current = navigator.geolocation.watchPosition(
      (p) => {
        gps.current = { lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now() };
        setGpsState('on');
      },
      (err) => setGpsState(err.code === err.PERMISSION_DENIED ? 'denied' : 'waiting'),
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
  }

  function stopGps() {
    if (gpsWatch.current !== null) navigator.geolocation.clearWatch(gpsWatch.current);
    gpsWatch.current = null;
    gps.current = null;
    setGpsState('off');
  }

  function record(batch: Record<string, { value?: number }>) {
    const d = drive.current;
    if (!d) return;
    const fix = gps.current && Date.now() - gps.current.at < 15_000 ? gps.current : null;
    if (fix) batch = { ...batch, lat: { value: fix.lat }, lon: { value: fix.lon } };
    d.rows.push([Date.now() - d.startedAt, ...d.columns.map((c) => batch[c.key]?.value ?? null)]);
    d.endedAt = Date.now();
    if (Date.now() - lastSave.current > 15_000) {
      lastSave.current = Date.now();
      void saveDrive(d).then((id) => (d.id = id));
    }
  }

  function startRecording() {
    const columns = [
      ...tilesRef.current.map((t) => ({ key: t.key, name: t.name, unit: t.unit as string })),
      ...(economy ? [{ key: 'lph', name: 'Fuel flow', unit: 'L/h' }] : []),
      ...(economy && !pids.includes(SPEED) ? [{ key: String(SPEED), name: 'Vehicle speed', unit: 'km/h' }] : []),
      ...(settings.recordGps ? [{ key: 'lat', name: 'Latitude', unit: '°' }, { key: 'lon', name: 'Longitude', unit: '°' }] : []),
    ];
    if (settings.recordGps) startGps();
    drive.current = { vehicleId: vehicle.id, vehicleName: vehicle.name, startedAt: Date.now(), endedAt: Date.now(), columns, rows: [] };
    lastSave.current = Date.now();
    setRecordingSince(Date.now());
  }

  async function stopRecording() {
    const d = drive.current;
    drive.current = null;
    setRecordingSince(null);
    stopGps();
    if (d && d.rows.length) d.id = await saveDrive(d);
  }

  const alarmBanner = alarm && (
    <div className="alarm" role="alert">
      <BellRing size={16} /> <span>{alarm}</span>
      <button className="btn-ghost" onClick={() => setAlarm(null)}>
        Dismiss
      </button>
    </div>
  );
  if (obd.status !== 'connected') return visible ? <NotConnected /> : null;
  // Hidden while recording: still show an alarm over whatever screen is open.
  if (!visible) return alarmBanner || null;

  return (
    <div className="stack">
      {alarmBanner}
      <Card
        title="Live data"
        icon={<Gauge size={14} />}
        accent="coral"
        error={readings.__error?.error}
        actions={
          <>
            {rate !== null && running && <span className="updated">{rate.toFixed(1)} updates/s</span>}
            {recordingSince === null ? (
              <button className="btn-ghost" onClick={startRecording} disabled={!running}>
                <Circle size={12} className="rec-dot" /> Record drive
              </button>
            ) : (
              <button className="btn-danger" onClick={() => void stopRecording()}>
                <Square size={12} /> Stop · {fmtDuration((Date.now() - recordingSince) / 1000)}
              </button>
            )}
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
        {recordingSince !== null && (
          <p className="muted small">
            Recording. You can switch screens; it keeps going until you press Stop or disconnect.
            {gpsState === 'on' && ' Location: on.'}
            {gpsState === 'waiting' && ' Location: waiting for a fix.'}
            {gpsState === 'denied' && ' Location: blocked (allow it for this site in Chrome’s address bar to map drives).'}
          </p>
        )}
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
  const unitLabel = shown?.unit ?? display(1, tile.unit, units).unit;
  return (
    <div className={`tile ${warn ? 'is-warn' : ''}`} title={tile.name}>
      <div className="tile-head">
        <span className="tile-name">{tile.short}</span>
        {tile.badge && <span className="badge">{tile.badge}</span>}
      </div>
      <div className="tile-value">
        {shown ? fmt(shown.value, shown.unit) : '–'}
        <span className="tile-unit">{unitLabel}</span>
      </div>
      {reading?.error === 'stopped' ? (
        <div className="tile-note">stopped</div>
      ) : reading?.error ? (
        <div className="tile-error">{reading.error}</div>
      ) : (
        <Sparkline values={history.filter(Number.isFinite)} min={Math.min(lo, hi)} max={Math.max(lo, hi)} />
      )}
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
  const toggle = (pid: number) => update({ tiles: chosen.includes(pid) ? chosen.filter((p) => p !== pid) : [...chosen, pid] });
  const toggleExtra = (id: string) =>
    update({ extras: settings.extras.includes(id) ? settings.extras.filter((x) => x !== id) : [...settings.extras, id] });
  return (
    <div className="picker">
      <fieldset>
        <legend>{vehicle.name}</legend>
        {vehicle.extraPids.map((x) => (
          <label key={x.id} className="check" title={x.source}>
            <input type="checkbox" checked={settings.extras.includes(x.id)} onChange={() => toggleExtra(x.id)} />
            {x.name}
          </label>
        ))}
        {vehicle.extraPids.length === 0 && <p className="muted small">No carmaker-specific values yet. The Explorer can find some.</p>}
        {vehicle.extraPids.some((x) => !x.verified) && (
          <p className="muted small">Unverified values are educated guesses. Compare against a known reading before trusting them.</p>
        )}
        <label className="check">
          <input type="checkbox" checked={settings.showEconomy} onChange={() => update({ showEconomy: !settings.showEconomy })} />
          Fuel economy (from airflow or fuel rate)
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.alarmSound} onChange={() => update({ alarmSound: !settings.alarmSound })} />
          Beep when a temperature goes over its limit
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.recordGps} onChange={() => update({ recordGps: !settings.recordGps })} />
          Save location with recorded drives (for the map and GPX)
        </label>
      </fieldset>
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
