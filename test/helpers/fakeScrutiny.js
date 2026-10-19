// -----------------------------------------------------------------------------
// An in-memory Scrutiny web server for the tests, started from the real
// answers of Scrutiny v0.9.5 in Docker (test/fixtures/scrutiny): four disks
// fed by simulated collector uploads —
//   sda    WDC WD140EDFZ, passed, a Scrutiny warning on "Spin-Up Time"
//   sdb    Hitachi HDS721050DLE630, failed (S.M.A.R.T. and Scrutiny)
//   nvme0  INTEL SSDPEKNW010T8, passed, no WWN (NVMe)
//   sdd    Samsung SSD 840, failed (Scrutiny), last collected 5 days earlier
// The tests change it (`disk(name).device_status = …`, `collect(name, time)`,
// `down = true`) and read it again through `request`, the HTTP seam of the
// client.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const BASE = 'http://192.0.2.10:8080';

// The time of the fixtures: the collector uploads were 1 to 3 hours earlier
// (5 days for sdd).
export const FIXTURE_TIME = Date.parse('2026-10-19T16:30:00Z');

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/scrutiny/${name}`, import.meta.url), 'utf8'));

export class FakeScrutiny {
  constructor() {
    this.summary = fixture('summary.json');
    this.details = Object.fromEntries(
      Object.keys(this.summary.data.summary).map((key, index) => [
        key,
        fixture(`details-${key.at(-1) ?? index + 1}.json`),
      ]),
    );
    this.settings = {
      success: true,
      settings: { metrics: { status_threshold: 3, status_filter_attributes: 0 } },
    };
    this.down = false;
    /** Device files whose newest result `duration_key=week` does not return. */
    this.olderThanAWeek = new Set();
    /** @type {Record<string, number>} forced HTTP statuses, by path prefix */
    this.statuses = {};
    this.calls = [];
    this.request = this.request.bind(this);
  }

  /** The summary entry of a disk, by device file (`sda`, `nvme0`…). */
  entry(deviceName) {
    const found = Object.entries(this.summary.data.summary).find(
      ([, entry]) => entry.device.device_name === deviceName,
    );
    if (!found) {
      throw new Error(`No disk ${deviceName} in the fake`);
    }
    return { key: found[0], ...found[1] };
  }

  disk(deviceName) {
    return this.entry(deviceName).device;
  }

  /** A new collector upload for a disk, at `time`. */
  collect(deviceName, time) {
    const { key } = this.entry(deviceName);
    this.summary.data.summary[key].smart.collector_date = new Date(time).toISOString();
    const results = this.details[key].data.smart_results;
    results[0].date = new Date(time).toISOString();
  }

  /** Set the status of an attribute of the newest result of a disk. */
  attribute(deviceName, id, status) {
    const { key } = this.entry(deviceName);
    this.details[key].data.smart_results[0].attrs[id].status = status;
  }

  async request(url, { headers = {} } = {}) {
    this.calls.push({ url, headers });
    if (this.down || !url.startsWith(`${BASE}/`)) {
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
    const path = url.slice(BASE.length);
    for (const [prefix, status] of Object.entries(this.statuses)) {
      if (path.startsWith(prefix)) {
        return { status, body: '{"success":false}' };
      }
    }
    if (path === '/api/summary') {
      return { status: 200, body: JSON.stringify(this.summary) };
    }
    if (path === '/api/settings') {
      return { status: 200, body: JSON.stringify(this.settings) };
    }
    const match = path.match(/^\/api\/device\/([^/]+)\/details\?duration_key=(week|forever)$/);
    const details = match && this.details[decodeURIComponent(match[1])];
    if (details) {
      // Scrutiny's `week` covers the last 7 days of results only.
      const old = match[2] === 'week' && this.olderThanAWeek.has(details.data.device.device_name);
      const answer = old ? { ...details, data: { ...details.data, smart_results: [] } } : details;
      return { status: 200, body: JSON.stringify(answer) };
    }
    return { status: 404, body: '404 page not found' };
  }
}
