// -----------------------------------------------------------------------------
// The Scrutiny hub: the web server read on a timer of the container (every 5
// to 60 minutes, as configured); the states of the added devices published
// when they change, the scene events fired on transitions, and the views the
// widget and the scene actions read. (Adapted from guim31/gladys-gatus.)
//
// Gladys never polls these devices (should_poll: false): the interval is
// beyond the fixed list of the core scheduler, and the scene events must fire
// for every disk, added to Gladys or not — "a disk fails" spares the user one
// scene per device.
//
// A disk's health is the one of the Scrutiny dashboard: failed when its
// `device_status` matches the "status threshold" of the Scrutiny settings
// (S.M.A.R.T., Scrutiny or both); a warning when it passes but one of its
// attributes does not (all of them, or the critical ones only, as set in
// Scrutiny); unknown before its first collection. The attributes are read
// again only when a new collection arrived: the collector runs once a day.
//
// The last health of each disk and whether its collection was stale are kept
// in /data (src/store.js): a disk that failed while the integration or Gladys
// restarted is still announced, once.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  buildDiskDevice,
  buildInstanceDevice,
  collectionAgeHours,
  diskIds,
  diskValues,
  instanceIds,
  instanceValues,
  parseDiskId,
} from './devices.js';
import { ATTRIBUTE_STATUS, ERROR_KINDS, ScrutinyClient, ScrutinyError } from './scrutiny/client.js';
import { hostOf, normalizeConfig } from './config.js';
import { ProblemLog } from './problems.js';
import { CONNECTION_TEXT, ERROR_TEXT, REASON_TEXT, REPORT_TEXT, labelled, pick } from './texts.js';

const logger = createLogger({ name: 'scrutiny-hub' });

export const WIDGET_KEY = 'scrutiny';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  FAILED: 'disk_failed',
  RECOVERED: 'disk_recovered',
  STALE: 'collection_stale',
});

export const HUB_TIMINGS = {
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action reads Scrutiny again when the last read is older.
  freshMs: 60_000,
  // A disk missing from the summary (removed or archived) is forgotten after this.
  forgetMs: 7 * 24 * 3600_000,
};

const MAX_TRANSPORTS_PER_REQUEST = 100;
const DETAILS_CONCURRENCY = 3;
// What a disk's health is computed with when the settings cannot be read:
// the Scrutiny defaults.
const DEFAULT_SETTINGS = { threshold: 3, criticalOnly: false };

/**
 * The attributes of a disk that count, as the Scrutiny settings say.
 * @returns {{ failures: string[], warnings: string[] }} attribute names
 */
export function problemsOf(details, settings) {
  const failures = [];
  const warnings = [];
  for (const attribute of details?.attributes ?? []) {
    if (attribute.status === 0 || (settings.criticalOnly && !attribute.critical)) {
      continue;
    }
    const failsSmart =
      (settings.threshold & 1) !== 0 && (attribute.status & ATTRIBUTE_STATUS.FAILED_SMART) !== 0;
    const failsScrutiny =
      (settings.threshold & 2) !== 0 && (attribute.status & ATTRIBUTE_STATUS.FAILED_SCRUTINY) !== 0;
    (failsSmart || failsScrutiny ? failures : warnings).push(attribute.name);
  }
  return { failures, warnings };
}

export const HEALTHS = ['ok', 'warning', 'failed', 'unknown'];

/**
 * Why a disk failed, for a message: its failing attributes, else what failed
 * as a whole (the overall S.M.A.R.T. check of smartctl has no attribute).
 */
export function failureReason(disk, settings, language) {
  if (disk.failures.length > 0) {
    return disk.failures.join(', ').slice(0, 300);
  }
  const reasons = [];
  if ((disk.deviceStatus & settings.threshold & 1) !== 0) {
    reasons.push(pick(REASON_TEXT.smart, language));
  }
  if ((disk.deviceStatus & settings.threshold & 2) !== 0) {
    reasons.push(pick(REASON_TEXT.scrutiny, language));
  }
  return reasons.join(', ');
}

/** The health of a disk: 'ok', 'warning', 'failed' or 'unknown'. */
export function healthOf(disk, details, settings) {
  if (!disk.collectedAt) {
    return 'unknown';
  }
  if ((disk.deviceStatus & settings.threshold) !== 0) {
    return 'failed';
  }
  const { failures, warnings } = problemsOf(details, settings);
  return failures.length + warnings.length > 0 ? 'warning' : 'ok';
}

export class ScrutinyHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/scrutiny/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    /** @type {Map<string, object>} disks of the last read, by platform id */
    this.disks = new Map();
    /** @type {Map<string, { collectedAt: number|null, details: object }>} by platform id */
    this.details = new Map();
    this.settings = DEFAULT_SETTINGS;
    this.settingsKnown = true;
    this.readAt = 0;
    this.error = null;
    this.polling = null;
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = { disks: {} };
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    // A hand-edited or damaged file must not stop the readings.
    const disks = {};
    for (const [id, state] of Object.entries(
      saved.disks && typeof saved.disks === 'object' ? saved.disks : {},
    )) {
      if (state && typeof state === 'object' && HEALTHS.includes(state.health)) {
        disks[id] = { ...state, stale: state.stale === true, since: Number(state.since) || 0 };
      }
    }
    const settings = saved.settings;
    this.saved = {
      disks,
      ...(settings && [1, 2, 3].includes(settings.threshold)
        ? {
            settings: {
              threshold: settings.threshold,
              criticalOnly: settings.criticalOnly === true,
            },
          }
        : {}),
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const signature = JSON.stringify([config.url, config.username, config.password]);
    if (signature !== this.signature) {
      if (this.signature !== null && JSON.parse(this.signature)[0] !== config.url) {
        // Another Scrutiny: the states saved for the previous one mean nothing.
        this.saved = { disks: {} };
        this.store.save(this.saved);
      }
      this.signature = signature;
      this.client = config.url
        ? new ScrutinyClient({
            url: config.url,
            username: config.username,
            password: config.password,
            request: this.request,
          })
        : null;
      this.disks = new Map();
      this.details = new Map();
      this.readAt = 0;
      this.error = null;
      this.polling = null;
    }
    if (previous.language !== config.language) {
      // New names for the Discovery tab.
      this.discovered = null;
    }
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  /** The next read by the timer, after `delayMs` (the refresh interval by default). */
  schedulePoll(delayMs = this.config.pollIntervalMs) {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading Scrutiny works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, delayMs);
  }

  // --- Reading Scrutiny ------------------------------------------------------

  /** Read the server now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read again when the last read is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * Read the server and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    let disks;
    let settings;
    try {
      disks = (await client.summary()).filter((disk) => !disk.archived);
      settings = await this.readSettings(client);
    } catch (err) {
      if (!(err instanceof ScrutinyError)) {
        throw err;
      }
      return client === this.client && this.applyFailure(err);
    }
    if (client !== this.client) {
      return false;
    }
    await this.readDetails(client, disks);
    // Checked once more after the last await: applySuccess changes the state
    // before its first await, so a read of a previous client never lands.
    if (client !== this.client) {
      return false;
    }
    return this.applySuccess(disks, settings);
  }

  /**
   * The Scrutiny settings; the last ones read (kept in /data) when unreadable.
   * @returns {Promise<{ settings: object, known: boolean }>} `known` false when
   *   they were never read from this server: the defaults are a guess then.
   */
  async readSettings(client) {
    try {
      const settings = await client.settings();
      this.problems.recover('settings', 'Scrutiny settings read again');
      return { settings, known: true, read: true };
    } catch (err) {
      // An unreachable server fails the whole read; another answer (an older
      // Scrutiny, a proxy rule) only costs the settings.
      if (err instanceof ScrutinyError && err.kind === ERROR_KINDS.UNREACHABLE) {
        throw err;
      }
      this.problems.fail('settings', `Scrutiny settings not read: ${err.message}`);
      if (this.saved.settings) {
        return { settings: this.saved.settings, known: true };
      }
      // A Scrutiny without the settings route always used its defaults; a
      // proxy or a server error only hides them: the defaults are a guess.
      return { settings: DEFAULT_SETTINGS, known: err.kind === ERROR_KINDS.NOT_SCRUTINY };
    }
  }

  /** The attributes of the disks collected since their last reading. */
  async readDetails(client, disks) {
    const queue = disks.filter((disk) => {
      const cached = this.details.get(disk.id);
      return disk.collectedAt && (!cached || cached.collectedAt !== disk.collectedAt);
    });
    const failures = [];
    const worker = async () => {
      for (let disk = queue.shift(); disk; disk = queue.shift()) {
        try {
          const details = await client.details(disk.key);
          // No result at all (the history was cleaned): the attributes known
          // stay, and nothing is cached, so they are asked again next time.
          if (client === this.client && details.attributes.length > 0) {
            this.details.set(disk.id, { collectedAt: disk.collectedAt, details });
          }
        } catch (err) {
          // The last known attributes stay, read again at the next cycle.
          failures.push(`${disk.name}: ${err.message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: DETAILS_CONCURRENCY }, worker));
    if (client !== this.client) {
      return;
    }
    if (failures.length > 0) {
      this.problems.fail(
        'details',
        `Disk attributes not read (${failures.length}): ${failures[0]}`,
      );
    } else {
      this.problems.recover('details', 'Disk attributes read again');
    }
  }

  async applySuccess(disks, { settings, known, read = false }) {
    let widgetChanged = this.error !== null || this.readAt === 0;
    if (this.error) {
      logger.info('Scrutiny answers again');
    }
    if (this.readAt === 0) {
      logger.info(`Scrutiny (${hostOf(this.config.url)}): ${disks.length} disk(s)`);
    }
    this.error = null;
    this.readAt = this.now();
    if (JSON.stringify(settings) !== JSON.stringify(this.settings)) {
      widgetChanged = true;
    }
    this.settings = settings;
    this.settingsKnown = known;

    // Everything below up to the events is synchronous: a concurrent read
    // (a new configuration) cannot interleave with it.
    const now = this.now();
    const next = new Map();
    const events = [];
    let dirty = false;
    if (read && JSON.stringify(settings) !== JSON.stringify(this.saved.settings)) {
      this.saved.settings = settings;
      dirty = true;
    }
    for (const disk of disks) {
      if (next.has(disk.id)) {
        continue;
      }
      const details = this.details.get(disk.id)?.details ?? null;
      const view = {
        ...disk,
        details,
        health: healthOf(disk, details, settings),
        ...problemsOf(details, settings),
        stale: disk.collectedAt !== null && now - disk.collectedAt >= this.config.staleMs,
      };
      next.set(disk.id, view);
      const previous = this.disks.get(disk.id);
      if (
        !previous ||
        ['health', 'stale', 'name', 'temperature'].some((key) => previous[key] !== view[key])
      ) {
        widgetChanged = true;
      }
      dirty = this.transition(view, events) || dirty;
    }
    if ([...this.disks.keys()].some((id) => !next.has(id))) {
      widgetChanged = true; // a disk removed or archived in Scrutiny
    }
    this.disks = next;
    for (const id of this.details.keys()) {
      if (!next.has(id)) {
        this.details.delete(id);
      }
    }
    // A disk missing from the summary is forgotten after a week only: a disk
    // archived then unarchived must not be announced as new.
    for (const [id, saved] of Object.entries(this.saved.disks)) {
      if (next.has(id)) {
        continue;
      }
      if (saved.missingSince === undefined) {
        saved.missingSince = now;
        dirty = true;
      } else if (now - saved.missingSince >= this.timings.forgetMs) {
        delete this.saved.disks[id];
        dirty = true;
      }
    }
    // Written only when something changed: no wear of the SD card at every read.
    if (dirty) {
      this.store.save(this.saved);
    }
    for (const [key, disk, extra] of events) {
      await this.fire(key, disk, extra);
    }
    await this.publishStates();
    return widgetChanged;
  }

  applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`Scrutiny: ${err.message}`);
    }
    return wasError !== err.kind;
  }

  /**
   * Compare a disk with its last saved state; queue the scene events.
   * @param {object} disk with its new `health` and `stale`
   * @param {Array} events where the events to fire are pushed
   * @returns {boolean} whether the saved state changed
   */
  transition(disk, events) {
    const previous = this.saved.disks[disk.id];
    const now = this.now();
    if (!this.settingsKnown && (!previous || disk.health !== previous.health)) {
      // A health computed with guessed settings would announce failures
      // Scrutiny does not see: compared once the settings are read.
      return false;
    }
    if (!previous) {
      // First sight: no event, a disk failed for months is not news.
      this.saved.disks[disk.id] = { health: disk.health, stale: disk.stale, since: now };
      return true;
    }
    let dirty = false;
    if (previous.missingSince !== undefined) {
      delete previous.missingSince;
      dirty = true;
    }
    if (disk.health !== 'unknown' && disk.health !== previous.health) {
      if (disk.health === 'failed') {
        // From "unknown" too: a first collection that fails is news.
        logger.info(`${disk.name} failed`);
        events.push([
          TRIGGERS.FAILED,
          disk,
          {
            reason: failureReason(disk, this.settings, this.config.language),
            temperature: disk.temperature ?? 0,
          },
        ]);
      } else if (previous.health === 'failed') {
        const hours = Math.max(0, Math.round((now - previous.since) / 3600_000));
        logger.info(`${disk.name} passes again after ${hours} h`);
        events.push([TRIGGERS.RECOVERED, disk, { failed_hours: hours }]);
      }
      if (disk.health === 'failed' || previous.health === 'failed') {
        previous.since = now;
      }
      previous.health = disk.health;
      dirty = true;
    }
    if (disk.stale !== previous.stale) {
      if (disk.stale) {
        logger.info(`${disk.name}: no collection for ${collectionAgeHours(disk, now)} h`);
        events.push([TRIGGERS.STALE, disk, { hours: collectionAgeHours(disk, now) }]);
      }
      previous.stale = disk.stale;
      dirty = true;
    }
    return dirty;
  }

  async fire(key, disk, extra = {}) {
    const data = {
      device: diskIds(this.gladys, disk.id).device,
      disk: disk.name,
      model: disk.model,
      ...extra,
    };
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  list() {
    return [...this.disks.values()];
  }

  discoveredDevices() {
    const language = this.config.language;
    if (!this.client || this.readAt === 0 || this.error) {
      return null; // nothing read: keep the list Gladys has
    }
    return [
      buildInstanceDevice(this.gladys, language),
      ...this.list().map((disk) => buildDiskDevice(this.gladys, disk, language)),
    ];
  }

  /** Publish the Discovery list when it changed (a disk added, renamed…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices() ?? (this.client ? null : []);
    if (devices === null) {
      return;
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read Scrutiny, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) a device: its states sent before were dropped
   * by Gladys, and a device deleted then added again needs its badge.
   */
  async onDeviceCreated(device) {
    this.transports.delete(device.external_id);
    // The SDK forgets what it sent for this device: everything goes again.
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.pollNow();
  }

  /**
   * The states of the added devices. The SDK skips the values Gladys already
   * has (and sends an unchanged one again after `heartbeatMs`).
   */
  async publishStates() {
    if (this.readAt === 0 || this.error) {
      return;
    }
    const now = this.now();
    const states = [];
    for (const disk of this.disks.values()) {
      if (!this.isCreated(diskIds(this.gladys, disk.id).device)) {
        continue; // Gladys drops the states of a device not added
      }
      for (const { key: _key, ...state } of diskValues(
        this.gladys,
        disk,
        now,
        this.config.language,
      )) {
        states.push(state);
      }
    }
    if (this.isCreated(instanceIds(this.gladys).device)) {
      for (const { key: _key, ...state } of instanceValues(this.gladys, this.list())) {
        states.push(state);
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: local, or unreachable. */
  async publishTransports() {
    if (!this.client || this.readAt === 0) {
      return;
    }
    const transport = this.error ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL;
    const entries = [];
    const ids = [
      instanceIds(this.gladys).device,
      ...[...this.disks.keys()].map((id) => diskIds(this.gladys, id).device),
    ];
    for (const externalId of ids) {
      if (this.isCreated(externalId) && this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.problems.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.problems.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (this.config.url === '') {
      return { connected: false, message: CONNECTION_TEXT.noUrl };
    }
    if (!this.config.url) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views and commands (widget, scene actions, report) ----------------------

  /** The disk of a device external id, null when unknown. */
  find(externalId) {
    const id = parseDiskId(this.gladys, externalId);
    return (id && this.disks.get(id)) || null;
  }

  /** Throws the reason Scrutiny cannot answer, if any. */
  assertReadable() {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new Error(pick(status.message, this.config.language));
    }
  }

  /** "Test the connection": read Scrutiny now, one line. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const message = {};
    const status = this.connectionStatus();
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (!status.connected) {
        message[language] = pick(status.message, language);
        continue;
      }
      const disks = this.list();
      const parts = [text.ok, text.disks(disks.length)];
      const failed = disks.filter((disk) => disk.health === 'failed').length;
      const warning = disks.filter((disk) => disk.health === 'warning').length;
      if (failed > 0) {
        parts.push(text.failed(failed));
      }
      if (warning > 0) {
        parts.push(text.warning(warning));
      }
      message[language] = labelled('Scrutiny', parts.join(', '), language);
    }
    return message;
  }
}

export { ERROR_KINDS };
