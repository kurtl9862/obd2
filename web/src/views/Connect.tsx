import { Bluetooth, Cable, FlaskConical, Plug, Unplug, Wifi } from 'lucide-react';
import { Card } from '../components/Card.tsx';
import { Segmented } from '../components/Segmented.tsx';
import { useObd } from '../lib/obd.tsx';
import type { ConnectionKind, Settings } from '../lib/settings.ts';
import { SerialTransport } from '../transports/serial.ts';
import { BluetoothTransport } from '../transports/bluetooth.ts';

const KINDS: { value: ConnectionKind; label: string }[] = [
  { value: 'wifi', label: 'Wi-Fi adapter' },
  { value: 'serial', label: 'USB' },
  { value: 'ble', label: 'Bluetooth LE' },
  { value: 'sim', label: 'Simulator' },
];

export function Connect({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  const obd = useObd();
  const kind = settings.connection;
  const busy = obd.status === 'connecting';
  const connected = obd.status === 'connected';
  const unsupported =
    (kind === 'serial' && !SerialTransport.supported()) || (kind === 'ble' && !BluetoothTransport.supported());

  return (
    <div className="stack">
      <Card
        title="Connection"
        icon={<Plug size={14} />}
        accent="teal"
        error={obd.status === 'error' ? obd.error : null}
        actions={connected ? <span className="pill is-good">Connected · {obd.transportLabel}</span> : null}
      >
        <Segmented label="How the adapter connects" value={kind} options={KINDS} onChange={(v) => update({ connection: v })} />

        {kind === 'wifi' && <WifiHelp settings={settings} update={update} />}
        {kind === 'serial' && (
          <div className="help">
            <p>
              <Cable size={14} className="inline-icon" /> Plug a USB adapter (OBDLink EX, vLinker FS, or any FTDI / CH340 cable) into the Mac and
              the car. Paired Bluetooth Classic adapters also show up here. Chrome will ask which port to use.
            </p>
            <label className="field">
              <span>Speed</span>
              <select value={settings.baudRate} onChange={(e) => update({ baudRate: Number(e.target.value) })}>
                {[38400, 115200, 9600, 230400, 500000].map((b) => (
                  <option key={b} value={b}>
                    {b} baud{b === 38400 ? ' (most ELM327)' : b === 115200 ? ' (OBDLink, vLinker)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {kind === 'ble' && (
          <p className="help">
            <Bluetooth size={14} className="inline-icon" /> For Bluetooth LE adapters like the OBDLink CX or vLinker MC+. Turn the ignition on, then
            pick the adapter from Chrome’s list.
          </p>
        )}
        {kind === 'sim' && (
          <p className="help">
            <FlaskConical size={14} className="inline-icon" /> A pretend car in the browser: an engine warming up, a transmission temperature, two
            stored codes and one pending. Good for trying the app away from the truck.
          </p>
        )}

        {unsupported && (
          <p className="warn">This browser can’t do that. Use Chrome or Edge on the Mac (Safari and Firefox don’t support it).</p>
        )}

        <div className="row">
          {connected ? (
            <button className="btn-ghost" onClick={() => void obd.disconnect()}>
              <Unplug size={14} /> Disconnect
            </button>
          ) : (
            <button className="btn-primary" disabled={busy || unsupported} onClick={() => void obd.connect(kind, settings)}>
              <Plug size={14} /> {busy ? 'Connecting…' : 'Connect'}
            </button>
          )}
          {busy && <span className="muted">Finding the car’s protocol can take up to 15 seconds.</span>}
        </div>

        {obd.info && (
          <dl className="facts">
            <dt>Adapter</dt>
            <dd>{obd.info.version}</dd>
            <dt>Protocol</dt>
            <dd>{obd.info.protocolName}</dd>
            <dt>Values available</dt>
            <dd>{obd.supported.length}</dd>
          </dl>
        )}
      </Card>
    </div>
  );
}

function WifiHelp({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  return (
    <div className="help">
      <p>
        <Wifi size={14} className="inline-icon" /> For Wi-Fi adapters like the Goliath ELM327. Your Mac’s Wi-Fi joins the adapter, and your
        iPhone keeps you online over its cable.
      </p>
      <ol className="steps">
        <li>Plug the adapter into the car and turn the ignition on.</li>
        <li>
          On the iPhone, turn on <b>Personal Hotspot</b>, then plug it into the Mac with its cable.
        </li>
        <li>
          On the Mac, join the adapter’s Wi-Fi network (often named <code>WiFi_OBDII</code>).
        </li>
        <li>
          In <b>System Settings › Network</b>, open the <b>…</b> menu, choose <b>Set Service Order</b>, and drag <b>iPhone USB</b> above{' '}
          <b>Wi-Fi</b>. You only do this once.
        </li>
        <li>
          In Terminal, in the <code>obd2</code> folder, run <code>npm start</code> (the Mac helper), then click Connect.
        </li>
      </ol>
      <label className="field">
        <span>Mac helper address</span>
        <input value={settings.bridgeUrl} onChange={(e) => update({ bridgeUrl: e.target.value })} spellCheck={false} />
      </label>
    </div>
  );
}
