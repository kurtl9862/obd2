import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, ClipboardCheck, MinusCircle, RefreshCw } from 'lucide-react';
import { Card } from '../components/Card.tsx';
import { NotConnected } from './Dashboard.tsx';
import { useObd } from '../lib/obd.tsx';
import { readReadiness } from '../../../core/obd.ts';
import { smogVerdict, type Readiness as ReadinessData } from '../../../core/readiness.ts';
import { vinModelYear } from '../../../core/vin.ts';
import type { VehicleProfile } from '../../../core/vehicles.ts';

export function Readiness({ vehicle }: { vehicle: VehicleProfile }) {
  const obd = useObd();
  const [data, setData] = useState<ReadinessData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { run, status } = obd;

  const read = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await run(readReadiness));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [run]);

  useEffect(() => {
    if (status === 'connected') void read();
  }, [status, read]);

  if (status !== 'connected') return <NotConnected />;

  const year = (obd.vin && vinModelYear(obd.vin)) || vehicle.year;
  const verdict = data ? smogVerdict(data, year) : null;

  return (
    <div className="stack">
      <Card
        title="Smog readiness"
        icon={<ClipboardCheck size={14} />}
        accent="teal"
        error={error}
        actions={
          <button className="btn-ghost" disabled={busy} onClick={() => void read()}>
            <RefreshCw size={13} /> Refresh
          </button>
        }
      >
        {verdict && data && (
          <>
            <div className={`verdict ${verdict.pass ? 'is-pass' : 'is-fail'}`}>
              <strong>{verdict.pass ? 'Likely to pass' : 'Not ready yet'}</strong>
              <span>{verdict.reason}</span>
            </div>
            <dl className="facts">
              <dt>Check-engine light</dt>
              <dd>{data.milOn ? 'On' : 'Off'}</dd>
              <dt>Stored codes</dt>
              <dd>{data.dtcCount}</dd>
              <dt>Engine type</dt>
              <dd>{data.diesel ? 'Diesel' : 'Gasoline'}</dd>
            </dl>
            <ul className="monitors">
              {data.monitors.map((m) => (
                <li key={m.name} className={`is-${m.state}`}>
                  {m.state === 'complete' ? <CheckCircle2 size={15} /> : m.state === 'incomplete' ? <CircleDashed size={15} /> : <MinusCircle size={15} />}
                  <span>{m.name}</span>
                  <span className="muted">{m.state === 'unsupported' ? 'not on this car' : m.state}</span>
                </li>
              ))}
            </ul>
            <p className="muted small">Based on EPA guidance most states follow. Your state’s rules decide.</p>
          </>
        )}
      </Card>
    </div>
  );
}
