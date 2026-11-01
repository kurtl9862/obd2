# OBD2

A browser app for reading any car's OBD-II port from a laptop: live gauges, trouble codes (read and clear), smog-check readiness, VIN and freeze frame, with extras for the cars we own. Runs in Chrome or Edge, so the laptop stays online while it's connected.

**Version 0.3** · Phase 3: online extras

## Quick start (Mac)

Needs Node 22.18 or newer (`brew install node`).

```sh
npm run setup        # once: installs the web app's packages
npm run build        # builds the web app into web/dist
npm start            # the Mac helper: serves the app at http://localhost:35001
```

Then open <http://localhost:35001> in Chrome or Edge and click **Connect**.

No car handy? `npm run sim` starts the helper with a pretend car, or pick **Simulator** on the Connect screen.

## Connecting

| Adapter | How | Notes |
|---|---|---|
| **Wi-Fi** (the Goliath ELM327) | Mac Wi-Fi joins the adapter; the Mac helper relays it to the browser | Keep internet by plugging in the iPhone with Personal Hotspot on, then in System Settings › Network › … › Set Service Order, drag **iPhone USB** above **Wi-Fi** (once). Adapter address defaults to `192.168.0.10:35000`; change it with `npm start -- --adapter 192.168.0.10:35000`. |
| **USB** (OBDLink EX, vLinker FS, FTDI/CH340 cables) | Web Serial, straight from the browser | Pick the baud rate on the Connect screen (38400 for most ELM327, 115200 for OBDLink and vLinker). Paired Bluetooth Classic adapters show up here too. |
| **Bluetooth LE** (OBDLink CX, vLinker MC+) | Web Bluetooth, straight from the browser | |
| **Simulator** | Built in | A warming engine, two stored codes, one pending, a transmission temperature block. |

Safari and Firefox can't do Web Serial or Web Bluetooth; use Chrome or Edge. The Wi-Fi path works in any browser because the helper does the networking.

## Vehicles

Pick a vehicle at the top. Every car gets the standard OBD-II features; a profile adds model-specific values and notes ([core/vehicles.ts](core/vehicles.ts)).

| Profile | Extras |
|---|---|
| 2010 Nissan Pathfinder SE | Transmission fluid temperature from the transmission computer (7E1, service 21). The current formula is a **guess** borrowed from the Nissan Patrol; the Explorer (below) finds the real one. |
| 2020 Honda Civic Sport sedan | None yet (Honda keeps CVT temperature behind service 22; to be found). |
| 2020 Nissan Sentra SR | CVT fluid temperature, a formula shared for Nissan CVTs, **unverified** on this car. 2020+ Sentras have Nissan's security gateway, which may refuse clearing codes. |
| Other vehicle | Standard OBD-II only. |

Values marked *unverified* are off until you turn them on under **Choose values**, and show a badge on their tile.

## How it's put together

```
core/     Shared TypeScript, no dependencies: the ELM327 driver, reply parsing (ISO-TP),
          OBD-II decoding (PIDs, codes, readiness, VIN), vehicle profiles, the simulator.
web/      The app: React 19 + Vite + TypeScript, plain CSS (same look as Halberd).
          Transports for Web Serial and Web Bluetooth live here.
bridge/   The Mac helper: Node, no dependencies. Relays a Wi-Fi adapter's TCP socket to
          a WebSocket on localhost and serves web/dist. fake-adapter.ts pretends to be one.
```

Every way of reaching the adapter implements one small `Transport` interface ([core/transport.ts](core/transport.ts)), so the dashboard, codes and everything else don't care which adapter is plugged in. Everything that talks to the car goes through one queue, because switching modules (`ATSH`) mustn't interleave with other requests.

The helper only listens on `127.0.0.1` and only accepts pages from `localhost`. To use a hosted copy of the app (for example GitHub Pages) with the helper, add `--allow-origin https://kurtl9862.github.io`.

## Finding transmission temperature (Explorer)

Carmakers don't publish where fluid temperature lives, so the **Explorer** finds it on your own car:

1. Start with a **cold** engine (parked overnight). Connect, open **Explorer**, pick the transmission module and press **Scan**. Nissans answer service 21 (PIDs 01-FF); Hondas and most newer cars use service 22, scanned a few hundred ids at a time.
2. Press **Start recording** and drive normally for 15-20 minutes, until the coolant is fully warm. Other screens keep working meanwhile.
3. **Likely temperatures** ranks the bytes that started near the outside temperature and climbed with the coolant, with a guessed formula like `A-40`. Press **Use this** on the best one: it's saved to that vehicle and shows on the dashboard.
4. Check it once against something you trust (an infrared thermometer on the pan, or a shop scan tool).

**Save recording** keeps the raw data as a file, so it can be re-analyzed or shared. **Vehicle › Export profile** shares the values you found; a friend with the same car can **Import values**.

## Recording drives

Press **Record drive** on the dashboard. Every update is saved in the browser (IndexedDB) and keeps going if you switch screens. **Logs** shows each drive's time, distance, average fuel economy and temperature peaks, and exports a CSV in your units.

Fuel economy comes from the fuel-rate PID when the car has one, otherwise from mass airflow (gasoline at 14.7:1).

Any value with a limit (coolant at 110 °C / 230 °F, ATF and CVT at 105 °C / 221 °F) shows a banner and beeps when it goes over, on every screen.

## Online extras

These need internet, which the iPhone tether provides while the Mac is on the adapter's Wi-Fi.

- **Vehicle › Online lookups** decodes any VIN with NHTSA (engine, transmission, drive, body) and lists recalls for that model. It works without a car connected, so you can type a friend's VIN. Recalls are per model; nhtsa.gov/recalls says whether a specific VIN was already fixed.
- **Ask Claude** next to each trouble code opens a Claude chat with the code, its description, the module and your car already filled in.
- **Report** reads codes, smog readiness, battery, fuel trims and other telling values, flags anything worth a look, adds open recalls, and prints or saves as a one-page PDF for a mechanic.
- **GPS on drives:** recordings save the laptop's location (allow it once in Chrome). **Logs** draws the route coloured by speed and exports a **GPX** file for Google Earth, gpx.studio or Strava. Turn it off under Dashboard › Choose values.

The browser calls NHTSA directly; if that's blocked, it retries through the Mac helper (`/nhtsa/...`), which only forwards to NHTSA's two API hosts.

## Safety

- **Clearing codes** asks first, and explains that it resets smog readiness and erases freeze frame data.
- The **console** asks before sending anything that changes the car (clear codes, module resets, routines, programming sessions).
- Nothing in the app writes to the car beyond clearing codes.

## Development

```sh
npm test             # core and helper tests (node --test), including the full Wi-Fi path
npm run typecheck    # Node code and the web app
npm run dev          # Vite dev server on :5173 (run "npm run sim" alongside for the Wi-Fi path)
npm run fake-adapter # a pretend Wi-Fi adapter on 127.0.0.1:35000
```

## Roadmap

- ~~Phase 2~~ done: explorer, temperature alarm, drive logging with CSV, fuel economy, profile sharing.
- ~~Phase 3~~ done: VIN decode and recalls, Ask Claude about a code, printable health report, GPS drive map with GPX.
- Next: confirm the transmission temperature on the real truck, then a Pathfinder card on Halberd.
- Maybe: an ESP32 board that makes the Wi-Fi adapter look like a USB one.
