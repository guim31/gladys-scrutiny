// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Scrutiny web server: its address, optional basic credentials (a reverse
// proxy in front of it: Scrutiny itself has no login), how often it is read,
// and after how many hours without a collection a disk counts as "not
// collected any more" (the collector usually runs once a day).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in minutes.
export const POLL_INTERVALS = ['5', '15', '30', '60'];

// Hours without a collection before a disk is reported as stale.
export const STALE_HOURS = ['26', '36', '48', '72', '168'];

export const DEFAULT_CONFIG = {
  url: '',
  username: '',
  password: '',
  poll_interval: '15',
  stale_hours: '36',
  language: 'fr',
};

// Pages of the Scrutiny interface: a URL copied from the browser points at one
// of them (`/web/dashboard`, `/web/device/<id>`), the API lives at the root.
const INTERFACE_PATH = /\/(web|api)(\/.*)?$/i;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10:8080`), or a URL copied from the browser
 * (`http://192.0.2.10:8080/web/dashboard`). HTTP by default for a bare host.
 * A path is kept (Scrutiny behind a reverse proxy sub-path, its `basepath`
 * setting), the interface pages dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs: they have their fields.
  if (url.username || url.password) {
    return null;
  }
  const path = url.pathname.replace(INTERFACE_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const choice = (key, options) =>
    options.includes(String(source[key])) ? String(source[key]) : DEFAULT_CONFIG[key];
  const typed = text('url');
  return {
    // Empty: not configured yet; null: typed but not understood.
    url: typed ? parseServerUrl(typed) : '',
    username: text('username'),
    // A password may start or end with a space: kept as typed.
    password: typeof source.password === 'string' ? source.password : '',
    pollIntervalMs: Number(choice('poll_interval', POLL_INTERVALS)) * 60_000,
    staleMs: Number(choice('stale_hours', STALE_HOURS)) * 3600_000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
