import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Send, Terminal } from 'lucide-react';
import { Card } from '../components/Card.tsx';
import { useObd } from '../lib/obd.tsx';

const QUICK = ['ATI', 'ATRV', 'ATDP', '0100', '0902', '03'];

/**
 * Services that change something in the car. Typing one asks first: a stray "04" clears codes,
 * and the others can reset modules or start routines.
 */
function writeWarning(cmd: string): string | null {
  const c = cmd.replace(/\s+/g, '').toUpperCase();
  if (c.startsWith('AT') || c.startsWith('ST')) return null;
  const svc = c.slice(0, 2);
  if (svc === '04') return 'This clears trouble codes and resets smog readiness.';
  if (svc === '14') return 'This clears diagnostic information in a module.';
  if (['11', '27', '28', '2E', '2F', '31', '34', '35', '36', '37', '3B', '3D', '85'].includes(svc)) {
    return 'This command can change settings, reset a module, or run a routine in the car.';
  }
  if (c.startsWith('1002') || c.startsWith('1003') || c.startsWith('1081') || c.startsWith('1085')) {
    return 'This switches a module into a programming or extended session.';
  }
  return null;
}

export function Console() {
  const obd = useObd();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const connected = obd.status === 'connected';

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [obd.logVersion]);

  const send = async (cmd: string) => {
    setError(null);
    const warning = writeWarning(cmd);
    if (warning && !window.confirm(`${warning}\n\nSend "${cmd}" anyway?`)) return;
    try {
      await obd.run(async (elm) => {
        await elm.send(cmd.trim(), 10000);
        const c = cmd.replace(/\s+/g, '').toUpperCase();
        // Commands that change how replies are printed would break the app's parser: set it back up.
        if (/^AT(Z|D|WS|H0|S0|E1|L1)/.test(c)) await elm.init();
        else if (/^AT(SH|CRA|AR|CF|CM)/.test(c)) elm.forgetTarget();
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    void send(input);
    setInput('');
  };

  return (
    <div className="stack">
      <Card title="Adapter console" icon={<Terminal size={14} />} accent="violet" error={error}>
        <p className="muted small">Everything the app sends and the adapter answers. You can type AT commands and raw requests too.</p>
        <div className="log" role="log" aria-live="off">
          {obd.log.map((e, i) => (
            <div key={i} className={`log-line is-${e.dir}`}>
              <span className="log-time">{new Date(e.at).toLocaleTimeString()}</span>
              <span className="log-dir">{e.dir === 'tx' ? '›' : e.dir === 'rx' ? '‹' : '•'}</span>
              <span className="log-text">{e.text || '(empty)'}</span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <form className="row" onSubmit={submit}>
          <input
            className="console-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={connected ? 'e.g. ATRV or 010C' : 'Connect first'}
            disabled={!connected}
            spellCheck={false}
            autoCapitalize="characters"
          />
          <button className="btn-primary" disabled={!connected}>
            <Send size={13} /> Send
          </button>
        </form>
        <div className="row wrap">
          {QUICK.map((q) => (
            <button key={q} className="pill" disabled={!connected} onClick={() => void send(q)}>
              {q}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
