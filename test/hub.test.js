// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a fake Scrutiny (real answers of
// Scrutiny v0.9.5): discovery, states, health, transitions and scene events,
// persistence across restarts, errors, scene actions, the widget, quiet logs,
// and the reading timer of the container.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS, INSTANCE_KEYS, instanceIds } from '../src/devices.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import {
  BASE,
  FakeScrutiny,
  createClock,
  createDevices,
  createWorld,
  idsOf,
} from './helpers/world.js';

const transportOf = (world, externalId) =>
  world.fake.transports.findLast((entry) => entry.device_external_id === externalId)?.transport;
const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const HOUR = 3600_000;

/** A new collection of a disk, `hours` later, then a read. */
async function collect(world, names, hours = 24) {
  world.clock.advance(hours * HOUR);
  for (const name of [names].flat()) {
    world.scrutiny.collect(name, world.clock.now());
  }
  await world.hub.pollNow();
}

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}

test('one device per disk (its Scrutiny id) and one for the instance, nothing polled by Gladys', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.external_id.split(':').slice(2).join(':')),
    [
      'instance:summary',
      'disk:id-0f1e2d3c-0000-4000-8000-000000000001',
      'disk:id-0f1e2d3c-0000-4000-8000-000000000002',
      'disk:id-0f1e2d3c-0000-4000-8000-000000000003',
      'disk:id-0f1e2d3c-0000-4000-8000-000000000004',
    ],
  );
  assert.ok(devices.every((device) => device.should_poll === false));
  // The sector counters only on the ATA disks that report them.
  const keys = (name) =>
    devices
      .find((device) => device.external_id === idsOf(world, name).device)
      .features.map((feature) => feature.external_id.split(':').pop());
  assert.ok(keys('sda').includes(FEATURE_KEYS.PENDING));
  assert.ok(!keys('nvme0').includes(FEATURE_KEYS.REALLOCATED));
  assert.equal(devices[1].name, 'WDC WD140EDFZ-11A0VA0 (sda)');
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('the health of the Scrutiny dashboard: failed, warning, ok, published as soon as a device is added', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const health = Object.fromEntries(world.hub.list().map((disk) => [disk.deviceName, disk.health]));
  assert.deepEqual(health, { sda: 'warning', sdb: 'failed', nvme0: 'ok', sdd: 'failed' });

  assert.equal(world.fake.states.length, 0, 'nothing published before a device is added');
  await createDevices(world);
  const sdb = idsOf(world, 'sdb');
  assert.equal(world.fake.lastState(sdb.feature(FEATURE_KEYS.FAILED)), 1);
  assert.equal(world.fake.lastState(sdb.feature(FEATURE_KEYS.HEALTH)), 'Failed');
  assert.equal(world.fake.lastState(sdb.feature(FEATURE_KEYS.TEMPERATURE)), 25);
  assert.equal(world.fake.lastState(sdb.feature(FEATURE_KEYS.POWER_ON_HOURS)), 65592);
  assert.equal(world.fake.lastState(sdb.feature(FEATURE_KEYS.REALLOCATED)), 1975);
  assert.equal(world.fake.lastState(sdb.feature(FEATURE_KEYS.PENDING)), 8);
  assert.equal(world.fake.lastState(sdb.feature(FEATURE_KEYS.COLLECTION_AGE)), 3);
  const summary = instanceIds(world.gladys);
  assert.equal(world.fake.lastState(summary.feature(INSTANCE_KEYS.FAILED)), 2);
  assert.equal(world.fake.lastState(summary.feature(INSTANCE_KEYS.WARNING)), 1);
  assert.equal(world.fake.lastState(summary.feature(INSTANCE_KEYS.TOTAL)), 4);

  // Nothing changed: nothing sent again.
  const sent = world.fake.states.length;
  await world.hub.pollNow();
  assert.equal(world.fake.states.length, sent);
});

test('the status threshold of Scrutiny is followed: S.M.A.R.T. only leaves a Scrutiny failure as a warning', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.scrutiny.settings.settings.metrics.status_threshold = 1;
  await world.hub.pollNow();
  const sdd = world.hub.find(idsOf(world, 'sdd').device);
  assert.equal(sdd.health, 'warning');
  assert.equal(world.hub.find(idsOf(world, 'sdb').device).health, 'failed');
  // Critical attributes only: the non-critical Spin-Up Time warning of sda is ignored.
  world.scrutiny.settings.settings.metrics.status_filter_attributes = 1;
  await world.hub.pollNow();
  assert.equal(world.hub.find(idsOf(world, 'sda').device).health, 'ok');
});

test('"a disk fails" and "passes again", once each, for any disk, with the failing attributes', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.equal(world.fake.sceneEvents.length, 0, 'no event at the first read');

  world.scrutiny.disk('nvme0').device_status = 1;
  await collect(world, ['nvme0', 'sda', 'sdb']);
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.FAILED).map((event) => event.data),
    [
      {
        device: idsOf(world, 'nvme0').device,
        disk: 'INTEL SSDPEKNW010T8 (nvme0)',
        model: 'INTEL SSDPEKNW010T8',
        // No failing attribute: the overall S.M.A.R.T. check failed.
        reason: 'S.M.A.R.T. overall check failed',
        temperature: 36,
      },
    ],
  );

  world.scrutiny.disk('nvme0').device_status = 0;
  await collect(world, 'nvme0', 10);
  assert.deepEqual(
    events(world, TRIGGERS.RECOVERED).map((event) => event.data),
    [
      {
        device: idsOf(world, 'nvme0').device,
        disk: 'INTEL SSDPEKNW010T8 (nvme0)',
        model: 'INTEL SSDPEKNW010T8',
        failed_hours: 10,
      },
    ],
  );
  assert.equal(events(world, TRIGGERS.FAILED).length, 1);
});

test('a warning is no failure: no event between ok and warning', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.scrutiny.attribute('sda', '3', 0);
  await collect(world, 'sda', 1);
  assert.equal(world.hub.find(idsOf(world, 'sda').device).health, 'ok');
  world.scrutiny.attribute('sda', '3', 2);
  await collect(world, 'sda', 1);
  assert.equal(world.fake.sceneEvents.length, 0);
});

test('the attributes are read again only after a new collection', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const details = () => world.scrutiny.calls.filter((call) => call.url.includes('/details')).length;
  assert.equal(details(), 4);
  await world.hub.pollNow();
  assert.equal(details(), 4);
  await collect(world, 'sda', 1);
  assert.equal(details(), 5);
});

test('"no longer collected" once per disk past the delay, again after a new collection stops', async (t) => {
  const world = await createWorld({ config: { url: BASE, language: 'en', stale_hours: '26' } });
  t.after(() => world.app.stop());
  world.clock.advance(22 * HOUR);
  await world.hub.pollNow();
  assert.deepEqual(events(world, TRIGGERS.STALE), [], 'sdd was stale at the first read');
  world.clock.advance(2 * HOUR);
  await world.hub.pollNow();
  world.clock.advance(2 * HOUR);
  await world.hub.pollNow();
  // Collected 2, 3 and 1 hours before the start: sda and sdb cross 26 h at
  // +24 h, nvme0 at +26 h.
  assert.deepEqual(
    events(world, TRIGGERS.STALE).map((event) => [event.data.disk, event.data.hours]),
    [
      ['WDC WD140EDFZ-11A0VA0 (sda)', 26],
      ['Hitachi HDS721050DLE630 (sdb)', 27],
      ['INTEL SSDPEKNW010T8 (nvme0)', 27],
    ],
  );
  await collect(world, 'sda', 0);
  assert.equal(world.hub.find(idsOf(world, 'sda').device).stale, false);
  await collect(world, [], 26);
  assert.equal(events(world, TRIGGERS.STALE).length, 4);
});

test('a disk that failed during a restart is announced once, not twice', async (t) => {
  const clock = createClock();
  const first = await createWorld({ clock });
  await first.app.stop();
  first.scrutiny.disk('sda').device_status = 2;
  first.scrutiny.collect('sda', clock.now());
  const second = await createWorld({ clock, scrutiny: first.scrutiny, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.deepEqual(
    events(second, TRIGGERS.FAILED).map((event) => event.data.disk),
    ['WDC WD140EDFZ-11A0VA0 (sda)'],
  );
  await second.app.stop();
  const third = await createWorld({ clock, scrutiny: first.scrutiny, dataDir: first.dataDir });
  t.after(() => third.app.stop());
  assert.equal(third.fake.sceneEvents.length, 0);
});

test('an archived disk leaves the list; unarchived within a week it is no news', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.scrutiny.disk('sdb').archived = true;
  await world.hub.pollNow();
  assert.equal(world.hub.list().length, 3);
  assert.equal(world.fake.discoveredDevices.length, 4);
  world.clock.advance(2 * 24 * HOUR);
  world.scrutiny.disk('sdb').archived = false;
  await world.hub.pollNow();
  assert.equal(world.fake.sceneEvents.filter((e) => e.key !== TRIGGERS.STALE).length, 0);
});

test('Scrutiny unreachable: status, badges, one warning, no disk event; back again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.scrutiny.down = true;
  const lines = await captureLogs(t, 'info', async () => {
    await world.hub.pollNow();
    await world.hub.pollNow();
  });
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /ECONNREFUSED/);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.equal(world.fake.connectionStatus.message.en, 'Scrutiny does not answer');
  assert.equal(transportOf(world, idsOf(world, 'sda').device), 'unreachable');
  assert.equal(world.fake.sceneEvents.length, 0);
  world.scrutiny.down = false;
  await world.hub.pollNow();
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.equal(transportOf(world, idsOf(world, 'sda').device), 'local');
});

test('errors by kind: InfluxDB down, a proxy login, no Scrutiny; the settings alone may fail', async (t) => {
  const world = await createWorld({
    config: { url: `${BASE}/web/dashboard`, username: 'me', password: 'secret', language: 'fr' },
  });
  t.after(() => world.app.stop());
  assert.equal(world.scrutiny.calls[0].url, `${BASE}/api/summary`);
  assert.equal(world.scrutiny.calls[0].headers.authorization, 'Basic bWU6c2VjcmV0');
  for (const [status, message] of [
    [500, 'Scrutiny répond en erreur : vérifiez sa base de données (InfluxDB)'],
    [401, "Une connexion est demandée : vérifiez l'utilisateur et le mot de passe de votre proxy"],
    [404, 'Aucun Scrutiny à cette adresse'],
  ]) {
    world.scrutiny.statuses = { '/api/summary': status };
    await world.hub.pollNow();
    assert.equal(world.fake.connectionStatus.message.fr, message);
  }
  world.scrutiny.statuses = { '/api/settings': 404 };
  await world.hub.pollNow();
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('no address, or one not understood: the status says what to do', async (t) => {
  const empty = await createWorld({ config: { language: 'en' } });
  t.after(() => empty.app.stop());
  assert.match(empty.fake.connectionStatus.message.en, /Enter the address/);
  const wrong = await createWorld({ config: { url: 'ftp://x', language: 'en' } });
  t.after(() => wrong.app.stop());
  assert.match(wrong.fake.connectionStatus.message.en, /not understood/);
});

test('"State of a disk" and "Count the failed disks", in the language of the configuration', async (t) => {
  const world = await createWorld({ config: { url: BASE, language: 'fr' } });
  t.after(() => world.app.stop());
  const state = await world.fake.sceneAction('get_disk_status', {
    device: idsOf(world, 'sdd').device,
  });
  assert.equal(state.success, true, state.error);
  assert.deepEqual(state.data.outputs, {
    failed: true,
    health: 'En échec',
    name: 'Samsung SSD 840 Series (sdd)',
    model: 'Samsung SSD 840 Series',
    temperature: 33,
    power_on_hours: 19497,
    collection_age_hours: 120,
    attributes: 'UltraDMA CRC Error Count',
    sentence:
      'Samsung SSD 840 Series (sdd) : En échec, 33 °C, collecté il y a 5 jours. UltraDMA CRC Error Count.',
  });
  const unknown = await world.fake.sceneAction('get_disk_status', { device: 'nope' });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /n'est pas un disque Scrutiny/);

  const count = await world.fake.sceneAction('count_failed_disks', {});
  assert.deepEqual(count.data.outputs, {
    failed: 2,
    warning: 1,
    stale: 1,
    total: 4,
    names: 'Hitachi HDS721050DLE630 (sdb), Samsung SSD 840 Series (sdd)',
  });

  world.scrutiny.down = true;
  world.clock.advance(HOUR);
  const down = await world.fake.sceneAction('count_failed_disks', {});
  assert.equal(down.success, false);
  assert.match(down.error, /Scrutiny ne répond pas/);
});

test('the widget: failed disks first, then warnings, stale, healthy; tiles and a Refresh button', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'de' });
  assert.equal(ack.success, true, ack.error);
  const content = ack.data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(
    content.components.slice(0, 3).map((c) => [c.label, c.value]),
    [
      ['Fehlerhaft', 2],
      ['Warnungen', 1],
      ['Am heißesten', 36],
    ],
  );
  const rows = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    rows.map((row) => [row.label, row.value]),
    [
      ['Hitachi HDS721050DLE630 (sdb)', 'Fehlerhaft · 25 °C'],
      ['Samsung SSD 840 Series (sdd)', 'Fehlerhaft · vor 5 Tagen erfasst'],
      ['WDC WD140EDFZ-11A0VA0 (sda)', 'Warnung · 32 °C'],
      ['INTEL SSDPEKNW010T8 (nvme0)', '36 °C'],
    ],
  );
  assert.equal(content.components.at(-1).label, 'Aktualisieren');

  // Chosen disks only.
  const one = await world.fake.widgetGet(WIDGET_KEY, {
    settings: { disks: [idsOf(world, 'nvme0').device] },
    language: 'en',
  });
  assert.equal(one.data.content.components.find((c) => c.type === 'status').items.length, 1);

  const refreshed = await world.fake.widgetAction(WIDGET_KEY, 'refresh', {});
  assert.equal(refreshed.success, true, refreshed.error);
});

test('the widget folds more than ten disks, and says what to do without address or answer', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const summary = world.scrutiny.summary.data.summary;
  const model = Object.values(summary)[2];
  for (let i = 0; i < 12; i += 1) {
    summary[`extra-${i}`] = structuredClone({
      ...model,
      device: {
        ...model.device,
        wwn: `0x50000000000001${String(i).padStart(2, '0')}`,
        device_name: `sd${i}`,
      },
    });
  }
  await world.hub.pollNow();
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  const rows = ack.data.content.components.find((c) => c.type === 'status').items;
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.at(-1), {
    label: 'Others',
    value: '+7',
    icon: 'more-horizontal',
    color: 'neutral',
  });
  assert.deepEqual(validateWidgetContent(ack.data.content), []);

  world.scrutiny.down = true;
  await world.hub.pollNow();
  const down = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  assert.ok(down.data.content.components.some((c) => c.text === 'Scrutiny does not answer'));

  const empty = await createWorld({ config: { language: 'en' } });
  t.after(() => empty.app.stop());
  const pick = await empty.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  assert.match(pick.data.content.components[0].text, /Enter the address/);
});

test('a device added later gets its states at once, and the widget refreshes', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const refreshes = world.fake.widgetRefreshes.length;
  await createDevices(world, (device) => device.external_id === idsOf(world, 'sda').device);
  assert.equal(world.fake.lastState(idsOf(world, 'sda').feature(FEATURE_KEYS.HEALTH)), 'Warning');
  assert.ok(world.fake.widgetRefreshes.length > refreshes);
});

test('a new language renames the features proposed and the health text', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  await world.fake.configUpdated({ url: BASE, language: 'es' });
  const device = world.fake.discoveredDevices.find(
    (d) => d.external_id === idsOf(world, 'sda').device,
  );
  assert.equal(device.features[0].name, 'Disco con fallo');
  assert.equal(
    world.fake.lastState(idsOf(world, 'sda').feature(FEATURE_KEYS.HEALTH)),
    'Advertencia',
  );
});

test('another Scrutiny address: the states saved for the previous one are dropped', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.configUpdated({ url: 'http://192.0.2.99:8080', language: 'en' });
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.deepEqual(world.hub.saved.disks, {});
});

test('"Test the connection" reads Scrutiny and reports in the four languages', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data?.message ?? ack.message, {
    en: 'Scrutiny: Connected, 4 disk(s), 2 failed, 1 with a warning',
    fr: 'Scrutiny : Connecté, 4 disque(s), 2 en échec, 1 en avertissement',
    de: 'Scrutiny: Verbunden, 4 Festplatte(n), 2 fehlerhaft, 1 mit Warnung',
    es: 'Scrutiny: Conectado, 4 disco(s), 2 con fallo, 1 con advertencia',
  });
});

test('Gladys restarted: everything is sent again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const sent = world.fake.states.length;
  await world.hub.resync(world.hub.config);
  assert.ok(world.fake.states.length > sent);
});

test('a normal reading cycle writes nothing at the info level', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const sent = world.fake.states.length;
  const lines = await captureLogs(t, 'info', async () => {
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await collect(world, ['sda', 'sdb', 'nvme0'], 6);
    }
  });
  assert.ok(world.fake.states.length > sent, 'states were published');
  assert.deepEqual(lines, []);
});

test('the internal timer reads Scrutiny and publishes the changes, without any poll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const world = await createWorld({ timers: true });
  t.after(() => world.app.stop());
  await createDevices(world);
  const reads = world.scrutiny.calls.length;
  world.scrutiny.disk('nvme0').device_status = 1;
  t.mock.timers.tick(15 * 60_000);
  // Let the read and the publications settle.
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(world.scrutiny.calls.length > reads);
  assert.equal(world.fake.lastState(idsOf(world, 'nvme0').feature(FEATURE_KEYS.FAILED)), 1);
});

test('a disk collected more than a week ago keeps its attributes (the whole history is asked)', async (t) => {
  const scrutiny = new FakeScrutiny();
  scrutiny.olderThanAWeek.add('sdd');
  const world = await createWorld({ scrutiny });
  t.after(() => world.app.stop());
  const sdd = world.hub.find(idsOf(world, 'sdd').device);
  assert.deepEqual(sdd.failures, ['UltraDMA CRC Error Count']);
  assert.equal(sdd.details.reallocated, 0);
});

test('settings unreadable after a restart: the last ones read are kept, no false failure', async (t) => {
  const clock = createClock();
  const first = await createWorld({ clock });
  first.scrutiny.settings.settings.metrics.status_threshold = 1;
  await first.hub.pollNow();
  assert.equal(first.hub.find(idsOf(first, 'sdd').device).health, 'warning');
  await first.app.stop();
  first.scrutiny.statuses = { '/api/settings': 502 };
  const second = await createWorld({ clock, scrutiny: first.scrutiny, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.equal(second.hub.find(idsOf(second, 'sdd').device).health, 'warning');
  assert.equal(second.fake.sceneEvents.length, 0);
});

test('settings never read (a proxy refuses them): no failure is announced on guessed thresholds', async (t) => {
  const scrutiny = new FakeScrutiny();
  scrutiny.statuses = { '/api/settings': 403 };
  const world = await createWorld({ scrutiny });
  t.after(() => world.app.stop());
  world.scrutiny.disk('nvme0').device_status = 2;
  await collect(world, 'nvme0', 1);
  assert.equal(world.fake.sceneEvents.length, 0);
  // Readable again: compared from then on.
  world.scrutiny.statuses = {};
  await world.hub.pollNow();
  world.scrutiny.disk('nvme0').device_status = 0;
  await collect(world, 'nvme0', 1);
  world.scrutiny.disk('nvme0').device_status = 1;
  await collect(world, 'nvme0', 1);
  assert.equal(events(world, TRIGGERS.FAILED).length, 1);
});

test('a disk first seen before its first collection: a failing first collection is announced', async (t) => {
  const scrutiny = new FakeScrutiny();
  const key = scrutiny.entry('nvme0').key;
  scrutiny.summary.data.summary[key].smart.collector_date = '0001-01-01T00:00:00Z';
  const world = await createWorld({ scrutiny });
  t.after(() => world.app.stop());
  assert.equal(world.hub.find(idsOf(world, 'nvme0').device).health, 'unknown');
  world.scrutiny.disk('nvme0').device_status = 1;
  await collect(world, 'nvme0', 1);
  assert.equal(events(world, TRIGGERS.FAILED).length, 1);
  world.scrutiny.disk('nvme0').device_status = 0;
  await collect(world, 'nvme0', 1);
  assert.equal(events(world, TRIGGERS.RECOVERED).length, 1);
});

test('a damaged state file does not stop the readings', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gladys-scrutiny-'));
  writeFileSync(
    join(dataDir, 'scrutiny-state.json'),
    JSON.stringify({ disks: { a: null, b: { health: 'odd' } }, settings: { threshold: 9 } }),
  );
  const world = await createWorld({ dataDir });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.equal(world.hub.list().length, 4);
});
