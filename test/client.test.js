// -----------------------------------------------------------------------------
// The Scrutiny client and the configuration: addresses, platform ids,
// normalization of the real answers (v0.9 keyed by UUID, v0.8 by WWN, a disk
// never collected), errors by kind.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseServerUrl } from '../src/config.js';
import {
  ERROR_KINDS,
  ScrutinyClient,
  normalizeDetails,
  normalizeDisk,
  platformIdOf,
} from '../src/scrutiny/client.js';
import { BASE, FakeScrutiny } from './helpers/fakeScrutiny.js';

test('the address: bare host, copied from the browser, behind a sub-path; credentials refused', () => {
  assert.equal(parseServerUrl('192.0.2.10:8080'), 'http://192.0.2.10:8080');
  assert.equal(parseServerUrl('http://192.0.2.10:8080/web/dashboard'), 'http://192.0.2.10:8080');
  assert.equal(
    parseServerUrl('https://nas.example/scrutiny/web/device/0x5000cca000000001'),
    'https://nas.example/scrutiny',
  );
  assert.equal(parseServerUrl('http://me:pw@192.0.2.10'), null);
  assert.equal(parseServerUrl('ftp://192.0.2.10'), null);
  const config = normalizeConfig({ url: ' 192.0.2.10 ', poll_interval: '60', stale_hours: '9' });
  assert.equal(config.pollIntervalMs, 3600_000);
  assert.equal(config.staleMs, 36 * 3600_000, 'an unknown choice falls back to the default');
  assert.equal(config.language, 'fr');
});

test('platform ids: the WWN, else the Scrutiny id, else a hash; never one for another', () => {
  assert.equal(platformIdOf('0x5000CCA000000001', 'x'), '0x5000cca000000001');
  assert.equal(platformIdOf('eui.0025385b71b07e2f', 'x'), 'eui.0025385b71b07e2f');
  assert.equal(
    platformIdOf('', '0F1E2D3C-0000-4000-8000-000000000003'),
    'id-0f1e2d3c-0000-4000-8000-000000000003',
  );
  assert.match(platformIdOf('', 'disk with spaces'), /^h[0-9a-f]{20}$/);
});

test('a disk never collected (Go zero time) has no health data; a v0.8 summary keyed by WWN works', () => {
  const disk = normalizeDisk('0x5000cca000000009', {
    device: { wwn: '0x5000cca000000009', device_name: 'sde', model_name: 'X', device_status: 0 },
    smart: { collector_date: '0001-01-01T00:00:00Z', temp: 0, power_on_hours: 0 },
  });
  assert.equal(disk.collectedAt, null);
  assert.equal(disk.temperature, null);
  assert.equal(disk.powerOnHours, null);
  assert.equal(disk.key, '0x5000cca000000009');
  assert.equal(disk.name, 'X (sde)');
  assert.equal(
    normalizeDisk('k', { device: { label: 'Backup', model_name: 'X', device_name: 'sde' } }).name,
    'Backup',
  );
  assert.equal(normalizeDisk('k', {}), null);
});

test('the details: the newest result, the sector counters only for ATA', () => {
  const fake = new FakeScrutiny();
  const nvme = fake.details['0f1e2d3c-0000-4000-8000-000000000003'];
  const details = normalizeDetails(nvme.data, nvme.metadata);
  assert.equal(details.reallocated, null);
  assert.equal(details.pending, null);
  assert.ok(details.attributes.length > 5);
  assert.deepEqual(normalizeDetails({}), { attributes: [], reallocated: null, pending: null });
});

test('errors by kind: refused, certificate, redirect, not Scrutiny, not JSON', async () => {
  const client = (answer) =>
    new ScrutinyClient({
      url: BASE,
      request: async () => {
        if (answer instanceof Error) {
          throw answer;
        }
        return answer;
      },
    });
  const kind = async (answer) => {
    try {
      await client(answer).summary();
    } catch (err) {
      return err.kind;
    }
    return null;
  };
  const coded = (code) => Object.assign(new Error('fetch failed'), { cause: { code } });
  assert.equal(await kind(coded('ECONNREFUSED')), ERROR_KINDS.UNREACHABLE);
  assert.equal(await kind(coded('DEPTH_ZERO_SELF_SIGNED_CERT')), ERROR_KINDS.TLS);
  assert.equal(await kind({ status: 301, body: '' }), ERROR_KINDS.REDIRECT);
  assert.equal(await kind({ status: 403, body: '' }), ERROR_KINDS.AUTH);
  assert.equal(await kind({ status: 502, body: '' }), ERROR_KINDS.SERVER);
  assert.equal(await kind({ status: 418, body: '' }), ERROR_KINDS.HTTP);
  assert.equal(await kind({ status: 200, body: '<html>' }), ERROR_KINDS.NOT_SCRUTINY);
  assert.equal(
    await kind({ status: 200, body: '{"success":true,"data":{}}' }),
    ERROR_KINDS.NOT_SCRUTINY,
  );
});
