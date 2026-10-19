// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Has this disk failed?" is already a scene condition on the device feature.
// The actions are about what a condition cannot do: put a disk's state in a
// message ("WDC WD140EDFZ (sda): Warning, 32 °C — Spin-Up Time"), and count
// the failed disks across Scrutiny, added to Gladys or not, for a weekly
// report. Both read Scrutiny again when the last read is older than a minute.
// -----------------------------------------------------------------------------

import { collectionAgeHours } from './devices.js';
import { ACTION_TEXT, HEALTH_TEXT, STALE_TEXT, ageText, labelled, pick } from './texts.js';

// Names listed in the `names` output, at most (the rest is counted).
export const MAX_LISTED_NAMES = 20;

async function readable(hub) {
  // An error of the last reading is not final: read again first.
  if (!hub.client) {
    hub.assertReadable();
  }
  await hub.refreshIfStale();
  hub.assertReadable();
}

/** "41 °C, 3 days without collection — Reallocated Sectors Count". */
export function describe(disk, now, language) {
  const parts = [pick(HEALTH_TEXT[disk.health], language)];
  if (disk.temperature !== null) {
    parts.push(`${disk.temperature} °C`);
  }
  if (disk.stale) {
    parts.push(STALE_TEXT[language].since(ageText(collectionAgeHours(disk, now), language)));
  }
  const attributes = [...disk.failures, ...disk.warnings].join(', ');
  return `${labelled(disk.name, parts.join(', '), language)}.${attributes ? ` ${attributes}.` : ''}`;
}

export const SCENE_ACTIONS = {
  async get_disk_status(hub, { fields = {} }) {
    await readable(hub);
    const language = hub.config.language;
    const disk = hub.find(fields.device);
    if (!disk) {
      throw new Error(pick(ACTION_TEXT.unknownDisk, language));
    }
    const now = hub.now();
    return {
      failed: disk.health === 'failed',
      health: pick(HEALTH_TEXT[disk.health], language),
      name: disk.name,
      model: disk.model,
      temperature: disk.temperature ?? 0,
      power_on_hours: disk.powerOnHours ?? 0,
      collection_age_hours: collectionAgeHours(disk, now) ?? 0,
      attributes: [...disk.failures, ...disk.warnings].join(', ').slice(0, 300),
      sentence: describe(disk, now, language),
    };
  },

  async count_failed_disks(hub) {
    await readable(hub);
    const disks = hub.list();
    const names = (health) =>
      disks
        .filter((disk) => disk.health === health)
        .map((disk) => disk.name)
        .sort((a, b) => a.localeCompare(b));
    const failed = names('failed');
    const listed = failed.slice(0, MAX_LISTED_NAMES);
    return {
      failed: failed.length,
      warning: names('warning').length,
      stale: disks.filter((disk) => disk.stale).length,
      total: disks.length,
      names:
        failed.length > listed.length
          ? `${listed.join(', ')}, +${failed.length - listed.length}`
          : listed.join(', '),
    };
  },
};
