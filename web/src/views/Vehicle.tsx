import { useEffect, useState } from 'react';
import { Car, Cpu, Download, Globe, Search, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { Card } from '../components/Card.tsx';
import { useObd } from '../lib/obd.tsx';
import { isExtraPid, VEHICLES, type VehicleProfile } from '../../../core/vehicles.ts';
import type { Settings } from '../lib/settings.ts';
import { vinMaker, vinModelYear } from '../../../core/vin.ts';
import { PID_BY_NUMBER } from '../../../core/pids.ts';
import { decodeVinOnline, recallsOnline } from '../lib/online.ts';
import type { DecodedVin, Recall } from '../../../core/nhtsa.ts';

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

      <Online vehicle={vehicle} carVin={obd.vin} bridgeUrl={settings.bridgeUrl} />
    </div>
  );
}

/** VIN decode and recalls from NHTSA. Works without the car: type any VIN (handy when helping someone). */
function Online({ vehicle, carVin, bridgeUrl }: { vehicle: VehicleProfile; carVin: string | null; bridgeUrl: string }) {
  const [vin, setVin] = useState(carVin ?? '');
  const [decoded, setDecoded] = useState<DecodedVin | null>(null);
  const [recalls, setRecalls] = useState<Recall[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (carVin) setVin(carVin);
  }, [carVin]);

  const cleanVin = vin.trim().toUpperCase();
  const vinOk = /^[A-HJ-NPR-Z0-9]{17}$/.test(cleanVin);
  // What to look recalls up for: the decoded VIN if there is one, else the picked profile.
  const target = decoded?.year ? decoded : vehicle.make && vehicle.year ? { make: vehicle.make, model: vehicle.model, year: vehicle.year } : null;

  const go = async (what: 'decode' | 'recalls') => {
    setBusy(true);
    setError(null);
    try {
      if (what === 'decode') {
        const d = await decodeVinOnline(cleanVin, bridgeUrl);
        if (!d) throw new Error('NHTSA doesn’t recognize that VIN');
        setDecoded(d);
        if (d.year) setRecalls(await recallsOnline(d.make, d.model, d.year, bridgeUrl));
      } else if (target?.year) {
        setRecalls(await recallsOnline(target.make, target.model, target.year, bridgeUrl));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Online lookups" icon={<Globe size={14} />} accent="teal" error={error}>
      <p className="muted small">Free NHTSA data. Needs internet (the iPhone tether when you’re on the adapter’s Wi-Fi).</p>
      <div className="row wrap">
        <input
          className="vin-input"
          aria-label="VIN"
          placeholder="17-character VIN"
          value={vin}
          maxLength={17}
          spellCheck={false}
          onChange={(e) => setVin(e.target.value)}
        />
        <button className="btn-primary" disabled={!vinOk || busy} onClick={() => void go('decode')}>
          <Search size={13} /> Decode VIN
        </button>
        <button className="btn-ghost" disabled={!target || busy} onClick={() => void go('recalls')}>
          <ShieldAlert size={13} /> Recalls{target ? ` for ${target.year} ${target.make} ${target.model}` : ''}
        </button>
      </div>
      {decoded && (
        <dl className="facts">
          <dt>Vehicle</dt>
          <dd>
            {decoded.year} {decoded.make} {decoded.model} {decoded.trim}
          </dd>
          {decoded.engine && (
            <>
              <dt>Engine</dt>
              <dd>{decoded.engine}</dd>
            </>
          )}
          {decoded.transmission && (
            <>
              <dt>Transmission</dt>
              <dd>{decoded.transmission}</dd>
            </>
          )}
          {decoded.drive && (
            <>
              <dt>Drive</dt>
              <dd>{decoded.drive}</dd>
            </>
          )}
          {decoded.body && (
            <>
              <dt>Body</dt>
              <dd>{decoded.body}</dd>
            </>
          )}
          {decoded.warning && (
            <>
              <dt>Note</dt>
              <dd className="warn-text">{decoded.warning}</dd>
            </>
          )}
        </dl>
      )}
      {recalls && (
        <>
          <h3>
            {recalls.length === 0 ? 'No recalls listed' : `${recalls.length} recall${recalls.length === 1 ? '' : 's'}`} for this model
          </h3>
          {recalls.length > 0 && (
            <p className="muted small">
              These are for the model, not your exact VIN. Whether yours was already fixed:{' '}
              <a href="https://www.nhtsa.gov/recalls" target="_blank" rel="noreferrer">
                nhtsa.gov/recalls
              </a>{' '}
              with the VIN, or any dealer.
            </p>
          )}
          <ul className="plain recalls">
            {recalls.map((r) => (
              <li key={r.campaign}>
                <button className="recall-head" onClick={() => setOpen(open === r.campaign ? null : r.campaign)} aria-expanded={open === r.campaign}>
                  <b>{r.component}</b>
                  <span className="muted small">
                    {r.campaign} · {r.date}
                  </span>
                  {r.parkIt && <span className="badge bad">Don’t drive</span>}
                </button>
                {open === r.campaign && (
                  <div className="small recall-body">
                    <p>{r.summary}</p>
                    {r.consequence && (
                      <p>
                        <b>Risk:</b> {r.consequence}
                      </p>
                    )}
                    {r.remedy && (
                      <p>
                        <b>Fix:</b> {r.remedy}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
