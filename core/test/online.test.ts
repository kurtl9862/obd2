import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askClaudeUrl, parseRecalls, parseVinDecode, recallsUrl, vinDecodeUrl } from '../nhtsa.ts';
import { distanceKm, projectTrack, toGpx } from '../gps.ts';

test('VIN decode: a clean decode', () => {
  const d = parseVinDecode({
    Results: [
      {
        Make: 'NISSAN',
        Model: 'Pathfinder',
        ModelYear: '2010',
        Trim: 'SE',
        DisplacementL: '4.0',
        EngineCylinders: '6',
        EngineModel: 'VQ40DE',
        TransmissionSpeeds: '5',
        TransmissionStyle: 'Automatic',
        DriveType: '4WD/4-Wheel Drive/4x4',
        BodyClass: 'Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)',
        FuelTypePrimary: 'Gasoline',
        ErrorCode: '0',
        ErrorText: '0 - VIN decoded clean.',
      },
    ],
  });
  assert.equal(d?.make, 'Nissan');
  assert.equal(d?.year, 2010);
  assert.equal(d?.engine, '4.0L 6-cylinder (VQ40DE)');
  assert.equal(d?.transmission, '5-speed Automatic');
  assert.equal(d?.warning, null);
});

test('VIN decode: warnings and garbage', () => {
  const d = parseVinDecode({ Results: [{ Make: 'HONDA', Model: 'Civic', ModelYear: '2020', ErrorCode: '1', ErrorText: '1 - Check Digit (9th position) does not calculate properly.' }] });
  assert.match(d?.warning ?? '', /Check Digit/);
  assert.equal(parseVinDecode({ Results: [{ Make: '' }] }), null);
  assert.equal(parseVinDecode(null), null);
  assert.equal(vinDecodeUrl('ABC', '/nhtsa/vpic'), '/nhtsa/vpic/DecodeVinValues/ABC?format=json');
});

test('recalls: newest first, park-it flag', () => {
  const r = parseRecalls({
    results: [
      { NHTSACampaignNumber: '11V000', ReportReceivedDate: '05/01/2011', Component: 'AIR BAGS', Summary: 'a', parkIt: false },
      { NHTSACampaignNumber: '18V111', ReportReceivedDate: '20/03/2018', Component: 'FUEL', Summary: 'b', parkIt: true },
    ],
  });
  assert.deepEqual(r.map((x) => x.campaign), ['18V111', '11V000']);
  assert.equal(r[0].parkIt, true);
  assert.deepEqual(parseRecalls({}), []);
  assert.equal(recallsUrl('Nissan', 'Pathfinder', 2010), 'https://api.nhtsa.gov/recalls/recallsByVehicle?make=Nissan&model=Pathfinder&modelYear=2010');
});

test('Ask Claude link carries the code and the car', () => {
  const url = new URL(askClaudeUrl('P0420', 'Catalyst efficiency below threshold (bank 1)', '2010 Nissan Pathfinder SE'));
  assert.equal(url.origin + url.pathname, 'https://claude.ai/new');
  const q = url.searchParams.get('q') ?? '';
  assert.match(q, /2010 Nissan Pathfinder SE has trouble code P0420 \(Catalyst/);
  assert.match(q, /safe to keep driving/);
});

test('GPX and track drawing', () => {
  const pts = [
    { t: 0, lat: 37.0, lon: -122.0, speedKmh: 0 },
    { t: 1000, lat: 37.01, lon: -122.0, speedKmh: 36 },
    { t: 2000, lat: 37.01, lon: -121.99 },
  ];
  const gpx = toGpx('Pathfinder <test>', Date.UTC(2026, 10, 1), pts);
  assert.match(gpx, /<trkpt lat="37.010000" lon="-122.000000"><time>2026-11-01T00:00:01.000Z<\/time><extensions><speed>10.00<\/speed>/);
  assert.match(gpx, /Pathfinder &#60;test&#62;/);
  assert.equal(Math.round(distanceKm(pts[0], pts[1]) * 100) / 100, 1.11);
  const xy = projectTrack(pts, 200, 100);
  assert.ok(xy[1].y < xy[0].y, 'north is up');
  assert.ok(xy[2].x > xy[1].x, 'east is right');
  for (const p of xy) assert.ok(p.x >= 0 && p.x <= 200 && p.y >= 0 && p.y <= 100);
});

test('health check against the pretend car', async () => {
  const { FakeCar } = await import('../emulator.ts');
  const { SimTransport } = await import('../sim-transport.ts');
  const { Elm327 } = await import('../elm327.ts');
  const { collectHealth, healthFlags } = await import('../health.ts');
  const { VEHICLES } = await import('../vehicles.ts');
  const t = new SimTransport(new FakeCar(), 0);
  await t.open();
  const elm = new Elm327(t);
  await elm.init();
  const atf = VEHICLES[0].extraPids[0];
  const h = await collectHealth(elm, [atf]);
  assert.equal(h.vin?.length, 17);
  assert.equal(h.codes?.length, 3);
  assert.ok(h.values.has(0x05), 'coolant read');
  assert.equal(h.extras.length, 1);
  const flags = healthFlags(h);
  assert.ok(flags.some((f) => f.level === 'bad' && /stored trouble code/.test(f.text)));
  assert.ok(flags.some((f) => /pending/.test(f.text)));
  await elm.close();
});
