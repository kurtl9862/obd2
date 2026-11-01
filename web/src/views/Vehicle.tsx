import { useEffect, useState } from 'react';
import { Car, Cpu, Download, Trash2, Upload } from 'lucide-react';
import { Card } from '../components/Card.tsx';
import { useObd } from '../lib/obd.tsx';
import { isExtraPid, VEHICLES, type VehicleProfile } from '../../../core/vehicles.ts';
import type { Settings } from '../lib/settings.ts';
import { vinMaker, vinModelYear } from '../../../core/vin.ts';
import { PID_BY_NUMBER } from '../../../core/pids.ts';

export function Vehicle({
  vehicle,
  onPick,
  settings,
  update,
}: {
  vehicle: VehicleProfile;
  onPick: (id: string) => void;
  settings: Settings;
  update: (p: Partial<Settings>) => void;
}) {
  const obd = useObd();
  const [volts, setVolts] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mine = settings.customExtras[vehicle.id] ?? [];
  const isMine = (id: string) => mine.some((x) => x.id === id);

  const removeMine = (id: string) =>
    update({
      customExtras: { ...settings.customExtras, [vehicle.id]: mine.filter((x) => x.id !== id) },
      extras: settings.extras.filter((x) => x !== id),
    });

  // Share a profile: the whole thing as JSON, so a friend with the same car can import your values.
  const exportProfile = () => {
    const blob = new Blob([JSON.stringify({ format: 'obd2-profile', version: 1, ...vehicle }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${vehicle.id}.obd2-profile.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importProfile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const extras = (Array.isArray(data.extraPids) ? data.extraPids : []).filter(isExtraPid);
      if (!extras.length) throw new Error('no values in it');
      const ids = new Set(extras.map((x: { id: string }) => x.id));
      update({ customExtras: { ...settings.customExtras, [vehicle.id]: [...extras, ...mine.filter((x) => !ids.has(x.id))] } });
      setNotice(`Imported ${extras.length} value${extras.length === 1 ? '' : 's'} into ${vehicle.name}. Turn them on under Dashboard › Choose values.`);
    } catch (err) {
      setNotice(`Couldn’t import that file: ${(err as Error).message}`);
    }
  };
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
                  <b>{x.name}</b> <span className="badge">{isMine(x.id) ? 'yours' : x.verified ? 'verified' : 'unverified'}</span>
                  {isMine(x.id) && (
                    <button className="btn-ghost tiny" onClick={() => removeMine(x.id)} aria-label={`Remove ${x.name}`}>
                      <Trash2 size={12} />
                    </button>
                  )}
                  <div className="muted small">
                    Request <code>{x.request}</code> to {x.module.name} ({x.module.request}), formula <code>{x.formula.length > 40 ? 'polynomial' : x.formula}</code>.{' '}
                    {x.source}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="row wrap">
          <button className="btn-ghost" onClick={exportProfile}>
            <Download size={13} /> Export profile
          </button>
          <label className="btn-ghost file-btn">
            <Upload size={13} /> Import values
            <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void importProfile(e.target.files[0])} />
          </label>
        </div>
        {notice && <p className="muted small">{notice}</p>}
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
