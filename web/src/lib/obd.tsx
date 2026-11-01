import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Elm327, type AdapterInfo, type LogEntry } from '../../../core/elm327.ts';
import type { Transport } from '../../../core/transport.ts';
import { WebSocketTransport } from '../../../core/ws-transport.ts';
import { SimTransport } from '../../../core/sim-transport.ts';
import { readVin, supportedPids } from '../../../core/obd.ts';
import { SerialTransport } from '../transports/serial.ts';
import { BluetoothTransport } from '../transports/bluetooth.ts';
import type { ConnectionKind, Settings } from './settings.ts';

export type Status = 'idle' | 'connecting' | 'connected' | 'error';

interface ObdState {
  status: Status;
  error: string | null;
  info: AdapterInfo | null;
  transportLabel: string | null;
  supported: number[];
  vin: string | null;
}

interface ObdApi extends ObdState {
  connect(kind: ConnectionKind, settings: Settings): Promise<void>;
  disconnect(): Promise<void>;
  /**
   * Run one whole operation with the adapter to itself. Operations that switch modules (ATSH)
   * must not interleave with others, so everything that talks to the car goes through here.
   */
  run<T>(fn: (elm: Elm327) => Promise<T>): Promise<T>;
  log: LogEntry[];
  /** Bumps when the log changes, so the console can re-render without the whole app doing so. */
  logVersion: number;
}

const ObdContext = createContext<ObdApi | null>(null);

const LOG_LIMIT = 600;

function makeTransport(kind: ConnectionKind, s: Settings): Transport {
  switch (kind) {
    case 'wifi':
      return new WebSocketTransport(s.bridgeUrl);
    case 'serial':
      return new SerialTransport(s.baudRate);
    case 'ble':
      return new BluetoothTransport();
    case 'sim':
      return new SimTransport();
  }
}

export function ObdProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ObdState>({
    status: 'idle',
    error: null,
    info: null,
    transportLabel: null,
    supported: [],
    vin: null,
  });
  const elmRef = useRef<Elm327 | null>(null);
  const lock = useRef<Promise<unknown>>(Promise.resolve());
  const logRef = useRef<LogEntry[]>([]);
  const [logVersion, setLogVersion] = useState(0);
  const logTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addLog = useCallback((entry: LogEntry) => {
    const log = logRef.current;
    log.push(entry);
    if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
    // Batch re-renders: the adapter can produce dozens of lines a second.
    logTimer.current ??= setTimeout(() => {
      logTimer.current = null;
      setLogVersion((v) => v + 1);
    }, 250);
  }, []);

  const run = useCallback(<T,>(fn: (elm: Elm327) => Promise<T>): Promise<T> => {
    const go = () => {
      const elm = elmRef.current;
      if (!elm) return Promise.reject(new Error('Not connected'));
      return fn(elm);
    };
    const result = lock.current.then(go, go);
    lock.current = result.catch(() => {});
    return result;
  }, []);

  const disconnect = useCallback(async () => {
    const elm = elmRef.current;
    elmRef.current = null;
    setState((s) => ({ ...s, status: 'idle', info: null, transportLabel: null, supported: [] }));
    if (elm) await elm.close().catch(() => {});
  }, []);

  const connect = useCallback(
    async (kind: ConnectionKind, settings: Settings) => {
      await disconnect();
      setState((s) => ({ ...s, status: 'connecting', error: null, vin: null }));
      const transport = makeTransport(kind, settings);
      try {
        addLog({ at: Date.now(), dir: 'info', text: `Opening ${transport.label}…` });
        await transport.open();
        const elm = new Elm327(transport, addLog);
        transport.onClose = (reason) => {
          if (elmRef.current !== elm) return;
          elmRef.current = null;
          addLog({ at: Date.now(), dir: 'info', text: reason ?? 'Disconnected' });
          setState((s) => ({ ...s, status: 'error', error: reason ?? 'Disconnected', info: null, supported: [] }));
        };
        const info = await elm.init();
        elmRef.current = elm;
        const supported = await run((e) => supportedPids(e));
        const vin = await run((e) => readVin(e)).catch(() => null);
        setState({ status: 'connected', error: null, info, transportLabel: transport.label, supported, vin });
      } catch (err) {
        await transport.close().catch(() => {});
        elmRef.current = null;
        const message = (err as Error).name === 'NotFoundError' ? 'No device was chosen.' : (err as Error).message;
        addLog({ at: Date.now(), dir: 'info', text: `Connection failed: ${message}` });
        setState((s) => ({ ...s, status: 'error', error: message }));
      }
    },
    [addLog, disconnect, run],
  );

  const api = useMemo<ObdApi>(
    () => ({ ...state, connect, disconnect, run, log: logRef.current, logVersion }),
    [state, connect, disconnect, run, logVersion],
  );
  return <ObdContext.Provider value={api}>{children}</ObdContext.Provider>;
}

export function useObd(): ObdApi {
  const ctx = useContext(ObdContext);
  if (!ctx) throw new Error('useObd outside ObdProvider');
  return ctx;
}
