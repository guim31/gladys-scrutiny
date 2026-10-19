// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Scrutiny, a temporary
// /data and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs: the tests read Scrutiny with
// `world.hub.pollNow()`. (Adapted from guim31/gladys-gatus.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { diskIds } from '../../src/devices.js';
import { platformIdOf } from '../../src/scrutiny/client.js';
import { Store } from '../../src/store.js';
import { BASE, FIXTURE_TIME, FakeScrutiny } from './fakeScrutiny.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = FIXTURE_TIME) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export async function createWorld({
  clock = createClock(),
  scrutiny = new FakeScrutiny(),
  config = { url: BASE, language: 'en' },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-scrutiny-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: scrutiny.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, scrutiny, app, hub: app.hub, clock, dataDir };
}

/** External ids of the device of a disk of the fake, by device file. */
export const idsOf = (world, deviceName) => {
  const entry = world.scrutiny.entry(deviceName);
  return diskIds(world.gladys, platformIdOf(entry.device.wwn, entry.key));
};

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { BASE, FIXTURE_TIME, FakeScrutiny };
