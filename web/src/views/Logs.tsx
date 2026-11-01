import { useCallback, useEffect, useState } from 'react';
import { Download, History, RefreshCw, Trash2 } from 'lucide-react';
import { Card } from '../components/Card.tsx';
import { Sparkline } from '../components/Sparkline.tsx';
import { deleteDrive, listDrives, type Drive } from '../lib/drives.ts';
import { display, fmt, fmtDuration, type UnitSystem } from '../lib/units.ts';
import { mpgFromLitersPer100km, tripTotals } from '../../../core/fuel.ts';
import type { Unit } from '../../../core/pids.ts';

/** Recorded drives: a summary, the peaks, and a CSV you can open in Numbers or Excel. */
export function Logs({ units }: { units: UnitSystem }) {
  const [drives, setDrives] = useState<Drive[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listDrives().then(setDrives, (err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="stack">
      <Card
        title="Drive logs"
        icon={<History size={14} />}
        accent="blue"
        error={error}
        actions={
          <button className="btn-ghost" onClick={load}>
            <RefreshCw size={13} /> Refresh
          </button>
        }
      >
        <p className="muted small">Start a recording from the dashboard. Drives are kept in this browser on this Mac.</p>
        {drives?.length === 0 && <p className="muted">No drives recorded yet.</p>}
        {drives?.map((d) => (
          <DriveRow
            key={d.id}
            drive={d}
            units={units}
            onDelete={async () => {
              if (d.id !== undefined && window.confirm('Delete this drive?')) {
                await deleteDrive(d.id);
                load();
              }
            }}
          />
        ))}
      </Card>
    </div>
  );
}

function column(d: Drive, key: string): number[] {
  const i = d.columns.findIndex((c) => c.key === key);
  if (i === -1) return [];
  return d.rows.map((r) => r[i + 1]).filter((v): v is number => v !== null);
}

export function summarize(d: Drive) {
  const speedIdx = d.columns.findIndex((c) => c.key === '13');
  const flowIdx = d.columns.findIndex((c) => c.key === 'lph');
  const trip = tripTotals(
    d.rows.map((r) => ({
      t: r[0] as number,
      speedKmh: speedIdx >= 0 ? (r[speedIdx + 1] ?? undefined) : undefined,
      litersPerHour: flowIdx >= 0 ? (r[flowIdx + 1] ?? undefined) : undefined,
    })),
  );
  const l100 = trip.km > 0.5 && trip.liters > 0 ? (trip.liters / trip.km) * 100 : null;
  return { ...trip, l100 };
}

function DriveRow({ drive, units, onDelete }: { drive: Drive; units: UnitSystem; onDelete: () => void }) {
  const s = summarize(drive);
  const dist = display(s.km, 'km', units);
  // Peaks of every temperature column (coolant, ATF/CVT and anything else in °C).
  const temps = drive.columns.filter((c) => c.unit === '°C');
  return (
    <div className="drive">
      <div className="drive-head">
        <strong>{new Date(drive.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</strong>
        <span className="muted">{drive.vehicleName}</span>
        <span className="pill">{fmtDuration(s.seconds)}</span>
        {s.km > 0 && (
          <span className="pill">
            {dist.value.toFixed(1)} {dist.unit}
          </span>
        )}
        {s.l100 !== null && (
          <span className="pill">{units === 'us' ? `${mpgFromLitersPer100km(s.l100).toFixed(1)} mpg` : `${s.l100.toFixed(1)} L/100km`} average</span>
        )}
        <div className="drive-actions">
          <button className="btn-ghost" onClick={() => downloadCsv(drive, units)}>
            <Download size={13} /> CSV
          </button>
          <button className="btn-ghost" onClick={onDelete} aria-label="Delete drive">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {temps.length > 0 && (
        <div className="peaks">
          {temps.map((c) => {
            const vals = column(drive, c.key);
            if (!vals.length) return null;
            const peak = display(Math.max(...vals), '°C', units);
            const series = vals.map((v) => display(v, '°C', units).value);
            return (
              <div key={c.key} className="peak">
                <span className="muted small">{c.name}</span>
                <span>
                  peak <b>{fmt(peak.value, peak.unit)}</b> {peak.unit}
                </span>
                <Sparkline values={series.slice(-300)} min={Math.min(...series)} max={Math.max(...series)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One row per update; values converted to the units you're using, with units in the headers. */
export function driveCsv(d: Drive, units: UnitSystem): string {
  const header = ['time (s)', 'clock', ...d.columns.map((c) => `${c.name} (${display(1, c.unit as Unit, units).unit || 'count'})`)];
  const lines = [header.map(quote).join(',')];
  for (const r of d.rows) {
    const t = r[0] as number;
    const cells = d.columns.map((c, i) => {
      const v = r[i + 1];
      if (v === null) return '';
      const shown = display(v, c.unit as Unit, units);
      return Number.isFinite(shown.value) ? shown.value.toFixed(3).replace(/\.?0+$/, '') : '';
    });
    lines.push([(t / 1000).toFixed(1), new Date(d.startedAt + t).toLocaleTimeString(), ...cells].map(quote).join(','));
  }
  return lines.join('\n');
}

function quote(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(d: Drive, units: UnitSystem) {
  const blob = new Blob([driveCsv(d, units)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${d.vehicleName.replace(/\W+/g, '-').toLowerCase()}-${new Date(d.startedAt).toISOString().slice(0, 16).replace(':', '')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
