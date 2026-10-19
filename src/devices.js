// -----------------------------------------------------------------------------
// Gladys devices, proposed in the Discovery tab (the user adds the ones to
// follow, nothing is created on their behalf):
//
//   - one device per disk, identified by its Scrutiny id (see platformIdOf in
//     src/scrutiny/client.js):
//       failed               input/binary          1 failed, 0 passed — as the
//                                                  Scrutiny dashboard decides it
//       health               text/text             OK / Warning / Failed
//       temperature          temperature-sensor/decimal °C
//       power_on_hours       duration/integer h
//       reallocated_sectors  counter-sensor/integer ATA attribute 5, when reported
//       pending_sectors      counter-sensor/integer ATA attribute 197, when reported
//       collection_age       duration/integer h    since the last collection
//   - one "Scrutiny" device for the instance: disks failed, with a warning, in
//     total.
//
// Published with should_poll: false: the integration reads Scrutiny on its own
// timer (src/hub.js), every 5 to 60 minutes.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { HEALTH_TEXT, pick } from './texts.js';

export const DISK_TYPE = 'disk';
export const INSTANCE_TYPE = 'instance';
export const INSTANCE_ID = 'summary';
export const MODEL = 'Scrutiny';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  FAILED: 'failed',
  HEALTH: 'health',
  TEMPERATURE: 'temperature',
  POWER_ON_HOURS: 'power_on_hours',
  REALLOCATED: 'reallocated_sectors',
  PENDING: 'pending_sectors',
  COLLECTION_AGE: 'collection_age',
});

export const INSTANCE_KEYS = Object.freeze({
  FAILED: 'failed_disks',
  WARNING: 'warning_disks',
  TOTAL: 'total_disks',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.FAILED]: 'Disk failed',
    [FEATURE_KEYS.HEALTH]: 'Health',
    [FEATURE_KEYS.TEMPERATURE]: 'Temperature',
    [FEATURE_KEYS.POWER_ON_HOURS]: 'Power-on hours',
    [FEATURE_KEYS.REALLOCATED]: 'Reallocated sectors',
    [FEATURE_KEYS.PENDING]: 'Pending sectors',
    [FEATURE_KEYS.COLLECTION_AGE]: 'Since last collection',
    [INSTANCE_KEYS.FAILED]: 'Failed disks',
    [INSTANCE_KEYS.WARNING]: 'Disks with a warning',
    [INSTANCE_KEYS.TOTAL]: 'Disks in total',
  },
  fr: {
    [FEATURE_KEYS.FAILED]: 'Disque en échec',
    [FEATURE_KEYS.HEALTH]: 'Santé',
    [FEATURE_KEYS.TEMPERATURE]: 'Température',
    [FEATURE_KEYS.POWER_ON_HOURS]: 'Heures de fonctionnement',
    [FEATURE_KEYS.REALLOCATED]: 'Secteurs réalloués',
    [FEATURE_KEYS.PENDING]: 'Secteurs en attente',
    [FEATURE_KEYS.COLLECTION_AGE]: 'Depuis la dernière collecte',
    [INSTANCE_KEYS.FAILED]: 'Disques en échec',
    [INSTANCE_KEYS.WARNING]: 'Disques en avertissement',
    [INSTANCE_KEYS.TOTAL]: 'Disques au total',
  },
  de: {
    [FEATURE_KEYS.FAILED]: 'Festplatte fehlerhaft',
    [FEATURE_KEYS.HEALTH]: 'Zustand',
    [FEATURE_KEYS.TEMPERATURE]: 'Temperatur',
    [FEATURE_KEYS.POWER_ON_HOURS]: 'Betriebsstunden',
    [FEATURE_KEYS.REALLOCATED]: 'Neu zugewiesene Sektoren',
    [FEATURE_KEYS.PENDING]: 'Ausstehende Sektoren',
    [FEATURE_KEYS.COLLECTION_AGE]: 'Seit der letzten Erfassung',
    [INSTANCE_KEYS.FAILED]: 'Fehlerhafte Festplatten',
    [INSTANCE_KEYS.WARNING]: 'Festplatten mit Warnung',
    [INSTANCE_KEYS.TOTAL]: 'Festplatten insgesamt',
  },
  es: {
    [FEATURE_KEYS.FAILED]: 'Disco con fallo',
    [FEATURE_KEYS.HEALTH]: 'Salud',
    [FEATURE_KEYS.TEMPERATURE]: 'Temperatura',
    [FEATURE_KEYS.POWER_ON_HOURS]: 'Horas de funcionamiento',
    [FEATURE_KEYS.REALLOCATED]: 'Sectores reasignados',
    [FEATURE_KEYS.PENDING]: 'Sectores pendientes',
    [FEATURE_KEYS.COLLECTION_AGE]: 'Desde la última recopilación',
    [INSTANCE_KEYS.FAILED]: 'Discos con fallo',
    [INSTANCE_KEYS.WARNING]: 'Discos con advertencia',
    [INSTANCE_KEYS.TOTAL]: 'Discos en total',
  },
};

// Display bounds (the core never applies them on write).
export const MAX_TEMPERATURE = 100;
export const MAX_HOURS = 1_000_000;
export const MAX_SECTORS = 1_000_000_000;
export const MAX_DISKS = 10_000;

export const diskIds = (gladys, id) => gladys.externalIds(DISK_TYPE, id);
export const instanceIds = (gladys) => gladys.externalIds(INSTANCE_TYPE, INSTANCE_ID);

/** The platform id of a device external id, null when it is not a disk of ours. */
export function parseDiskId(gladys, externalId) {
  const prefix = diskIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = externalId.slice(prefix.length);
  return /^[a-z0-9._-]{1,70}$/.test(id) ? id : null;
}

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const counter = (name, externalId, max) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    { keep_history: true, min: 0, max },
  );

const hours = (name, externalId) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.DURATION,
    DEVICE_FEATURE_TYPES.DURATION.INTEGER,
    {
      unit: DEVICE_FEATURE_UNITS.HOURS,
      keep_history: true,
      min: 0,
      max: MAX_HOURS,
    },
  );

/**
 * The discovery payload of a disk. The sector counters exist only on the disks
 * that report them (ATA): `disk.details` from the hub, when read.
 */
export function buildDiskDevice(gladys, disk, language = 'en') {
  const ids = diskIds(gladys, disk.id);
  const names = NAMES[language] ?? NAMES.en;
  const params = [{ name: 'SCRUTINY_ID', value: disk.key.slice(0, 255) }];
  for (const [name, value] of [
    ['WWN', disk.wwn],
    ['SERIAL', disk.serial],
    ['MODEL', disk.model],
    ['HOST', disk.host],
  ]) {
    if (value) {
      params.push({ name, value: value.slice(0, 255) });
    }
  }
  const features = [
    sensor(
      names[FEATURE_KEYS.FAILED],
      ids.feature(FEATURE_KEYS.FAILED),
      DEVICE_FEATURE_CATEGORIES.INPUT,
      DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      { keep_history: true, min: 0, max: 1 },
    ),
    sensor(
      names[FEATURE_KEYS.HEALTH],
      ids.feature(FEATURE_KEYS.HEALTH),
      DEVICE_FEATURE_CATEGORIES.TEXT,
      DEVICE_FEATURE_TYPES.TEXT.TEXT,
      { keep_history: true, min: 0, max: 0 },
    ),
    sensor(
      names[FEATURE_KEYS.TEMPERATURE],
      ids.feature(FEATURE_KEYS.TEMPERATURE),
      DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
      DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
      { unit: DEVICE_FEATURE_UNITS.CELSIUS, keep_history: true, min: 0, max: MAX_TEMPERATURE },
    ),
    hours(names[FEATURE_KEYS.POWER_ON_HOURS], ids.feature(FEATURE_KEYS.POWER_ON_HOURS)),
  ];
  if (disk.details?.reallocated !== null && disk.details?.reallocated !== undefined) {
    features.push(
      counter(names[FEATURE_KEYS.REALLOCATED], ids.feature(FEATURE_KEYS.REALLOCATED), MAX_SECTORS),
    );
  }
  if (disk.details?.pending !== null && disk.details?.pending !== undefined) {
    features.push(
      counter(names[FEATURE_KEYS.PENDING], ids.feature(FEATURE_KEYS.PENDING), MAX_SECTORS),
    );
  }
  features.push(
    hours(names[FEATURE_KEYS.COLLECTION_AGE], ids.feature(FEATURE_KEYS.COLLECTION_AGE)),
  );
  return {
    name: disk.name,
    external_id: ids.device,
    model: disk.model ? `${MODEL} · ${disk.model}`.slice(0, 255) : MODEL,
    should_poll: false,
    params,
    features,
  };
}

/** The discovery payload of the instance summary. */
export function buildInstanceDevice(gladys, language = 'en') {
  const ids = instanceIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: 'Scrutiny',
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [],
    features: Object.values(INSTANCE_KEYS).map((key) =>
      counter(names[key], ids.feature(key), MAX_DISKS),
    ),
  };
}

/** Whole hours since the last collection, null when never collected. */
export const collectionAgeHours = (disk, now) =>
  disk.collectedAt ? Math.max(0, Math.floor((now - disk.collectedAt) / 3600_000)) : null;

/**
 * The value of every known feature of a disk: `{ key, device_feature_external_id, state }`.
 * @param {object} disk normalized disk, with `health` ('ok'|'warning'|'failed'|'unknown')
 *   and `details` set by the hub
 * @param {number} now
 * @param {string} language of the health text
 */
export function diskValues(gladys, disk, now, language = 'en') {
  const ids = diskIds(gladys, disk.id);
  const values = [];
  if (disk.health !== 'unknown') {
    values.push({ key: FEATURE_KEYS.FAILED, state: disk.health === 'failed' ? 1 : 0 });
    values.push({ key: FEATURE_KEYS.HEALTH, text: pick(HEALTH_TEXT[disk.health], language) });
  }
  if (disk.temperature !== null) {
    values.push({
      key: FEATURE_KEYS.TEMPERATURE,
      state: Math.min(disk.temperature, MAX_TEMPERATURE),
    });
  }
  if (disk.powerOnHours !== null) {
    values.push({
      key: FEATURE_KEYS.POWER_ON_HOURS,
      state: Math.min(disk.powerOnHours, MAX_HOURS),
    });
  }
  for (const [key, value] of [
    [FEATURE_KEYS.REALLOCATED, disk.details?.reallocated],
    [FEATURE_KEYS.PENDING, disk.details?.pending],
  ]) {
    if (Number.isFinite(value)) {
      values.push({ key, state: Math.min(value, MAX_SECTORS) });
    }
  }
  const age = collectionAgeHours(disk, now);
  if (age !== null) {
    values.push({ key: FEATURE_KEYS.COLLECTION_AGE, state: Math.min(age, MAX_HOURS) });
  }
  return values.map(({ key, ...value }) => ({
    key,
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}

/** The values of the instance summary. */
export function instanceValues(gladys, disks) {
  const ids = instanceIds(gladys);
  return [
    { key: INSTANCE_KEYS.FAILED, state: disks.filter((d) => d.health === 'failed').length },
    { key: INSTANCE_KEYS.WARNING, state: disks.filter((d) => d.health === 'warning').length },
    { key: INSTANCE_KEYS.TOTAL, state: disks.length },
  ].map(({ key, state }) => ({ key, device_feature_external_id: ids.feature(key), state }));
}
