// -----------------------------------------------------------------------------
// Scrutiny client: the REST API of the Scrutiny web server (MIT,
// https://github.com/AnalogJ/scrutiny), checked against Scrutiny v0.9.5 in
// Docker fed with simulated collector uploads (test/fixtures/scrutiny):
//
//   GET /api/summary
//       every disk, keyed by its Scrutiny id (the WWN up to v0.8, a UUID
//       since v0.9): `device` (wwn, name, model, serial, capacity, protocol,
//       label, `device_status`: bit 1 failed S.M.A.R.T., bit 2 failed
//       Scrutiny thresholds, `archived`) and `smart` (collector_date, temp,
//       power_on_hours)
//   GET /api/device/{id}/details?duration_key=week
//       the S.M.A.R.T. results of the disk (`attrs`, each with a `status`:
//       bit 1 failed S.M.A.R.T., bit 2 Scrutiny warning, bit 4 failed
//       Scrutiny) and the `metadata` of the attributes (name, critical)
//   GET /api/settings
//       `metrics.status_threshold` (1 S.M.A.R.T., 2 Scrutiny, 3 both) and
//       `metrics.status_filter_attributes` (1: critical attributes only), the
//       way the Scrutiny dashboard computes a disk's state
//
// Scrutiny has no login: basic credentials are sent for a reverse proxy in
// front of it, when configured. Redirects are not followed: the credentials
// would be sent wherever the address points.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // a proxy asks for credentials
  NOT_SCRUTINY: 'not_scrutiny', // something answers, not the Scrutiny API
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  SERVER: 'server', // Scrutiny answers 5xx (its InfluxDB is down, usually)
  HTTP: 'http', // any other HTTP error
});

export class ScrutinyError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'ScrutinyError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export const MAX_BODY_BYTES = 8 * 1024 * 1024;

// Attribute status bits (Scrutiny `AttributeStatus`).
export const ATTRIBUTE_STATUS = Object.freeze({ FAILED_SMART: 1, WARNING: 2, FAILED_SCRUTINY: 4 });

// ATA attributes published as features, when the disk reports them.
export const ATA_REALLOCATED = '5';
export const ATA_PENDING = '197';

/**
 * The one function that talks to the network (fetch). The client takes it as
 * a parameter: the tests replace it with an in-memory Scrutiny
 * (test/helpers/fakeScrutiny.js).
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function httpRequest(url, { method = 'GET', headers = {}, timeoutMs = 15_000 } = {}) {
  const response = await fetch(url, {
    method,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    await response.body?.cancel();
    throw new Error('Response too large');
  }
  const body = await response.text();
  if (body.length > MAX_BODY_BYTES) {
    throw new Error('Response too large');
  }
  return { status: response.status, body };
}

/**
 * The platform id of a disk: its WWN (stable across Scrutiny versions and
 * reinstallations), lower case; else the Scrutiny id; a hash of it when it
 * holds characters an external id cannot carry. A WWN starts with `0x`,
 * `eui.` or `naa.`, a UUID-based id with `id-`, a hash with `h`: no collision.
 */
export function platformIdOf(wwn, key) {
  const lower = typeof wwn === 'string' ? wwn.trim().toLowerCase() : '';
  if (/^[a-z0-9._-]{4,64}$/.test(lower)) {
    return lower;
  }
  const id = typeof key === 'string' ? key.trim().toLowerCase() : '';
  return /^[a-z0-9-]{1,64}$/.test(id)
    ? `id-${id}`
    : `h${createHash('sha1').update(String(key)).digest('hex').slice(0, 20)}`;
}

/** A date of the API, null when missing or Go's zero time. */
export const dateOf = (value) => {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time > Date.UTC(2000, 0, 1) ? time : null;
};

const clean = (value, max) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const count = (value) => (Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null);

/**
 * One disk of the summary, normalized; null when it cannot be identified.
 * @param {string} key its key in the summary (the id the details are read with)
 * @returns {object|null}
 */
export function normalizeDisk(key, raw) {
  const device = raw?.device;
  if (!device || typeof device !== 'object' || typeof key !== 'string' || !key.trim()) {
    return null;
  }
  const smart = raw.smart && typeof raw.smart === 'object' ? raw.smart : {};
  const wwn = clean(device.wwn, 64);
  const model = clean(device.model_name, 120);
  const deviceName = clean(device.device_name, 60);
  const label = clean(device.label, 120);
  const collectedAt = dateOf(smart.collector_date);
  return {
    key: key.trim(),
    id: platformIdOf(wwn, key),
    wwn,
    // As the Scrutiny dashboard can show it: the label set by the user, else
    // the model and the device file.
    name: label || [model || 'Disk', deviceName && `(${deviceName})`].filter(Boolean).join(' '),
    model,
    deviceName,
    serial: clean(device.serial_number, 60),
    protocol: clean(device.device_protocol, 10),
    host: clean(device.host_id, 120),
    capacity: count(device.capacity),
    archived: device.archived === true,
    deviceStatus: Number.isInteger(device.device_status) ? device.device_status : 0,
    collectedAt,
    temperature: collectedAt && Number.isFinite(smart.temp) && smart.temp > 0 ? smart.temp : null,
    powerOnHours: collectedAt ? count(smart.power_on_hours) : null,
  };
}

/**
 * The newest S.M.A.R.T. result of the details answer, as the hub reads it.
 * @returns {{ attributes: object[], reallocated: number|null, pending: number|null }}
 */
export function normalizeDetails(data, metadata = {}) {
  const results = Array.isArray(data?.smart_results) ? data.smart_results : [];
  const newest = results
    .filter((result) => result && typeof result === 'object')
    .reduce(
      (best, result) => ((dateOf(result.date) ?? 0) > (dateOf(best?.date) ?? 0) ? result : best),
      null,
    );
  const attrs = newest?.attrs && typeof newest.attrs === 'object' ? newest.attrs : {};
  const attributes = Object.entries(attrs)
    .filter(([, attr]) => attr && typeof attr === 'object')
    .map(([id, attr]) => ({
      id,
      name: clean(metadata?.[id]?.display_name, 80) || id,
      critical: metadata?.[id]?.critical === true,
      status: Number.isInteger(attr.status) ? attr.status : 0,
    }));
  const raw = (id) => (id in attrs ? count(attrs[id].raw_value) : null);
  const ata = (newest?.device_protocol ?? 'ATA') === 'ATA';
  return {
    attributes,
    reallocated: ata ? raw(ATA_REALLOCATED) : null,
    pending: ata ? raw(ATA_PENDING) : null,
  };
}

export class ScrutinyClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} [options.username] basic credentials, for a proxy
   * @param {string} [options.password]
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, username = '', password = '', request = httpRequest, timeoutMs = 15_000 }) {
    this.url = url;
    this.authorization = username
      ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
      : null;
    this.request = request;
    this.timeoutMs = timeoutMs;
  }

  async call(path) {
    try {
      return await this.request(`${this.url}${path}`, {
        headers: {
          accept: 'application/json',
          ...(this.authorization ? { authorization: this.authorization } : {}),
        },
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      const code = err.cause?.code ?? err.code;
      if (TLS_CODES.has(code)) {
        throw new ScrutinyError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
      }
      throw new ScrutinyError(ERROR_KINDS.UNREACHABLE, code ?? err.name ?? err.message);
    }
  }

  /** The parsed JSON of a GET, `{ success: true, … }` as Scrutiny answers. */
  async json(path) {
    const { status, body } = await this.call(path);
    if (status === 401 || status === 403) {
      throw new ScrutinyError(ERROR_KINDS.AUTH, `Credentials refused (HTTP ${status})`, { status });
    }
    if (status >= 300 && status < 400) {
      throw new ScrutinyError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new ScrutinyError(
        ERROR_KINDS.NOT_SCRUTINY,
        'No Scrutiny API at this address (HTTP 404)',
        {
          status,
        },
      );
    }
    if (status >= 500) {
      throw new ScrutinyError(ERROR_KINDS.SERVER, `Scrutiny error (HTTP ${status})`, { status });
    }
    if (status < 200 || status >= 300) {
      throw new ScrutinyError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, { status });
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      data = null;
    }
    if (!data || typeof data !== 'object' || data.success !== true) {
      throw new ScrutinyError(ERROR_KINDS.NOT_SCRUTINY, 'The answer is not a Scrutiny answer');
    }
    return data;
  }

  /**
   * Every disk of the dashboard (the archived ones included, flagged).
   * @returns {Promise<object[]>}
   * @throws {ScrutinyError}
   */
  async summary() {
    const data = await this.json('/api/summary');
    const summary = data.data?.summary;
    if (!summary || typeof summary !== 'object') {
      throw new ScrutinyError(ERROR_KINDS.NOT_SCRUTINY, 'The answer has no disk summary');
    }
    return Object.entries(summary)
      .map(([key, raw]) => normalizeDisk(key, raw))
      .filter(Boolean);
  }

  /**
   * The newest S.M.A.R.T. attributes of a disk.
   * @param {string} key its key in the summary
   * @throws {ScrutinyError}
   */
  async details(key) {
    const data = await this.json(
      `/api/device/${encodeURIComponent(key)}/details?duration_key=week`,
    );
    return normalizeDetails(data.data, data.metadata);
  }

  /**
   * How the Scrutiny dashboard decides a disk failed.
   * @returns {Promise<{ threshold: number, criticalOnly: boolean }>}
   * @throws {ScrutinyError}
   */
  async settings() {
    const data = await this.json('/api/settings');
    const metrics = data.settings?.metrics ?? {};
    return {
      threshold: [1, 2, 3].includes(metrics.status_threshold) ? metrics.status_threshold : 3,
      criticalOnly: metrics.status_filter_attributes === 1,
    };
  }
}
