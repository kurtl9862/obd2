# OBD2

A browser app for reading any car's OBD-II port from a laptop: live gauges, trouble codes (read and clear), smog-check readiness, VIN and freeze frame, with extras for the cars we own. Runs in Chrome or Edge, so the laptop stays online while it's connected.

**Version 0.1** · Phase 1: connect and read

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
| 2010 Nissan Pathfinder SE | Transmission fluid temperature from the transmission computer (7E1, service 21). The current formula is a **guess** borrowed from the Nissan Patrol; phase 2's explorer will find the real one. |
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

- **Phase 2:** transmission-module explorer to find ATF/CVT temperature on each car, temperature alarm, drive logging with CSV export, fuel economy.
- **Phase 3:** code lookups and AI explanations online, GPS drive map, a health report to share, a Pathfinder card on Halberd.
- Maybe: an ESP32 board that makes the Wi-Fi adapter look like a USB one.
