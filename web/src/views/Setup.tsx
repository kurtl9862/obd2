import { Laptop, LifeBuoy, Repeat, Smartphone, Wifi } from 'lucide-react';
import { Card } from '../components/Card.tsx';

/**
 * The full setup guide for the usual rig: MacBook Air + Goliath Wi-Fi ELM327 + iPhone.
 * The adapter has no internet and takes over the Mac's Wi-Fi, so the iPhone's Personal Hotspot
 * over its cable keeps the Mac online. The Mac helper (bridge/bridge.ts) relays the adapter's
 * TCP socket to the app on http://localhost:35001.
 */
export function Setup() {
  return (
    <div className="stack">
      <Card title="How it fits together" icon={<Laptop size={14} />} accent="teal">
        <div className="help">
          <p>Three devices, each with one job:</p>
          <dl className="facts">
            <dt>Goliath ELM327</dt>
            <dd>
              Plugs into the car’s OBD-II port and makes its own Wi-Fi network. It has no internet. Its address is <code>192.168.0.10</code>, port{' '}
              <code>35000</code>.
            </dd>
            <dt>MacBook Air</dt>
            <dd>
              Joins the adapter’s Wi-Fi and runs the Mac helper (<code>npm start</code>), which talks to the adapter and serves this app at{' '}
              <code>http://localhost:35001</code>.
            </dd>
            <dt>iPhone</dt>
            <dd>
              Plugged into the Mac with its cable, with Personal Hotspot on, so the Mac stays online (recalls, VIN lookups, Ask Claude, maps)
              while its Wi-Fi is busy with the adapter.
            </dd>
          </dl>
          <p>
            <code>Car → ELM327 (Wi-Fi) → Mac helper → Chrome</code>, and separately <code>Mac → iPhone (USB) → internet</code>.
          </p>
        </div>
      </Card>

      <Card title="Once, before the first drive" icon={<Wifi size={14} />} accent="blue">
        <ol className="steps help">
          <li>
            On the Mac, in Terminal, in the <code>obd2</code> folder: run <code>npm run setup</code>, then <code>npm run build</code>.
          </li>
          <li>
            Plug the iPhone into the Mac. If the iPhone asks, tap <b>Trust</b>. On the iPhone, open <b>Settings › Personal Hotspot</b> and turn on{' '}
            <b>Allow Others to Join</b>.
          </li>
          <li>
            On the Mac, open <b>System Settings › Network</b>. <b>iPhone USB</b> should be listed and green. Open the <b>…</b> menu at the bottom of
            the list, choose <b>Set Service Order</b>, drag <b>iPhone USB</b> above <b>Wi-Fi</b> and click OK. This makes the Mac use the iPhone for
            internet even while Wi-Fi is joined to the adapter.
          </li>
          <li>
            Plug the adapter into the car (usually under the dash, near the steering column) and turn the ignition on. On the Mac, join its Wi-Fi network
            (often <code>WiFi_OBDII</code>, no password).
          </li>
          <li>
            Run <code>npm start</code>. The first time, macOS may ask to let Terminal <b>find devices on local networks</b>: click <b>Allow</b>, or
            the helper can’t reach the adapter.
          </li>
          <li>
            Open <code>http://localhost:35001</code> in Chrome or Edge, pick <b>Wi-Fi adapter</b> on the Connect screen, and click <b>Connect</b>.
          </li>
        </ol>
      </Card>

      <Card title="Every time after that" icon={<Repeat size={14} />} accent="gold">
        <ol className="steps help">
          <li>Adapter in the car, ignition on (engine running for live values, or just on for codes).</li>
          <li>iPhone plugged into the Mac with Personal Hotspot on.</li>
          <li>Mac Wi-Fi joined to the adapter’s network.</li>
          <li>
            <code>npm start</code>, open <code>http://localhost:35001</code>, click <b>Connect</b>.
          </li>
          <li>When you’re done, rejoin your normal Wi-Fi. The adapter drains a little power, so unplug it if the car will sit for days.</li>
        </ol>
      </Card>

      <Card title="If something doesn’t work" icon={<LifeBuoy size={14} />} accent="coral">
        <dl className="facts help">
          <dt>“Can’t reach the adapter”</dt>
          <dd>
            Check the Mac’s Wi-Fi menu shows the adapter’s network, and that the ignition is on (the adapter turns off with the car on some
            models). Then check <b>System Settings › Privacy &amp; Security › Local Network</b> has Terminal turned on.
          </dd>
          <dt>Joined, but still can’t reach it</dt>
          <dd>
            Some adapters don’t hand out an address. In <b>System Settings › Network › Wi-Fi › Details › TCP/IP</b>, set <b>Configure IPv4</b> to{' '}
            <b>Manually</b>, IP address <code>192.168.0.11</code>, subnet mask <code>255.255.255.0</code>, and leave <b>Router</b> empty (so internet
            still goes through the iPhone). Set it back to <b>Using DHCP</b> afterwards for your home Wi-Fi.
          </dd>
          <dt>Adapter uses a different address</dt>
          <dd>
            Some clones use <code>192.168.4.1</code> or port <code>23</code>. Start the helper with{' '}
            <code>npm start -- --adapter 192.168.4.1:35000</code> (whatever your adapter’s manual says).
          </dd>
          <dt>No internet while connected</dt>
          <dd>
            Make sure Personal Hotspot is still on (the iPhone turns it off after a while with nothing connected), the cable is plugged in, and{' '}
            <b>iPhone USB</b> is above <b>Wi-Fi</b> in the service order.
          </dd>
          <dt>The Mac keeps jumping back to home Wi-Fi</dt>
          <dd>
            In <b>System Settings › Wi-Fi</b>, open your home network’s <b>…</b> menu and turn off <b>Auto-Join</b> while you’re in the car, or just
            work from the driveway out of its range.
          </dd>
          <dt>Connect hangs on “Connecting…”</dt>
          <dd>Finding the car’s protocol can take 15 seconds. If it times out, turn the ignition off and on, wait 10 seconds, and try again.</dd>
          <dt>The page won’t load</dt>
          <dd>
            The helper must be running in Terminal. Use <code>localhost</code>, not the Mac’s network address: the helper only answers this Mac.
          </dd>
        </dl>
      </Card>

      <Card title="About the phone" icon={<Smartphone size={14} />} accent="teal">
        <div className="help">
          <p>
            The iPhone is the Mac’s internet connection, not a second screen. The Mac helper only listens on the Mac itself, so the app can’t be
            opened from the phone, and iPhone browsers can’t talk to an OBD adapter directly.
          </p>
          <p>
            No cable? Turning on Personal Hotspot and connecting the Mac over <b>Bluetooth</b> also works, but it’s slower. iPhone Wi-Fi hotspot
            won’t work, because the Mac’s Wi-Fi is busy with the adapter.
          </p>
        </div>
      </Card>
    </div>
  );
}
