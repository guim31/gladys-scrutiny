// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `scrutiny`.
//
// The use case: a glance at the wall tablet tells whether the disks of the
// house (NAS, server, mini PC) are healthy, and which one is not. Three tiles
// (failed, with a warning, the hottest temperature), then one row per disk:
// the failed ones first, then the warnings, the ones no longer collected, the
// healthy ones; ten rows at most, the rest counted.
//
// Every disk by default, or the devices chosen in the widget settings. The
// figures are sent as values, not bound to device features: the widget works
// before the devices are added.
//
// Budget (8 components, 2 texts, 1 status): three tiles, one text when
// Scrutiny does not answer, the status list, a Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { collectionAgeHours } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { CONNECTION_TEXT, ERROR_TEXT, HEALTH_TEXT, STALE_TEXT, ageText, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  pick: {
    en: 'Enter the address of your Scrutiny in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre Scrutiny dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Scrutiny in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su Scrutiny en la configuración de la integración.',
  },
  empty: {
    en: 'No disk to show: check the disks chosen, or that a Scrutiny collector runs.',
    fr: 'Aucun disque à afficher : vérifiez les disques choisis, ou qu’un collecteur Scrutiny tourne.',
    de: 'Keine Festplatte anzuzeigen: Prüfe die gewählten Festplatten oder ob ein Scrutiny-Collector läuft.',
    es: 'Ningún disco que mostrar: compruebe los discos elegidos o que un recolector de Scrutiny funcione.',
  },
  failed: { en: 'Failed', fr: 'En échec', de: 'Fehlerhaft', es: 'Con fallo' },
  warning: { en: 'Warnings', fr: 'Avertissements', de: 'Warnungen', es: 'Advertencias' },
  hottest: { en: 'Hottest', fr: 'Le plus chaud', de: 'Am heißesten', es: 'Más caliente' },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Scrutiny read again.',
    fr: 'Scrutiny relu.',
    de: 'Scrutiny neu gelesen.',
    es: 'Scrutiny leído de nuevo.',
  },
};

const ROW_STYLE = {
  failed: { icon: 'x-circle', color: WIDGET_COLORS.DANGER },
  warning: { icon: 'alert-triangle', color: WIDGET_COLORS.WARNING },
  stale: { icon: 'clock', color: WIDGET_COLORS.WARNING },
  unknown: { icon: 'circle', color: WIDGET_COLORS.NEUTRAL },
  ok: { icon: 'check-circle', color: WIDGET_COLORS.SUCCESS },
};

// Row order: what needs attention first.
const SEVERITY = ['failed', 'warning', 'stale', 'unknown', 'ok'];
const levelOf = (disk) => (disk.stale && disk.health === 'ok' ? 'stale' : disk.health);

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** The disks the widget shows: the chosen devices, else all. */
export function selectDisks(hub, settings) {
  const chosen = [settings?.disks ?? []].flat().filter((id) => typeof id === 'string' && id);
  if (chosen.length > 0) {
    return [...new Set(chosen)].map((id) => hub.find(id)).filter(Boolean);
  }
  return hub.list();
}

export function sortDisks(disks) {
  return [...disks].sort(
    (a, b) =>
      SEVERITY.indexOf(levelOf(a)) - SEVERITY.indexOf(levelOf(b)) || a.name.localeCompare(b.name),
  );
}

function diskRow(disk, now, language) {
  const parts = [];
  if (disk.health !== 'ok') {
    parts.push(pick(HEALTH_TEXT[disk.health], language));
  }
  if (disk.stale) {
    parts.push(STALE_TEXT[language].since(ageText(collectionAgeHours(disk, now), language)));
  } else if (disk.temperature !== null) {
    parts.push(`${disk.temperature} °C`);
  }
  return {
    label: fit(disk.name, 40),
    value: fit(parts.join(' · ') || pick(HEALTH_TEXT[disk.health], language), 40),
    ...ROW_STYLE[levelOf(disk)],
  };
}

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client) {
    return message(hub.config.url === null ? CONNECTION_TEXT.invalidUrl : TEXT.pick, language);
  }
  const disks = sortDisks(selectDisks(hub, settings));
  if (disks.length === 0 && !hub.error) {
    return message(TEXT.empty, language);
  }
  const now = hub.now();
  const failed = disks.filter((disk) => disk.health === 'failed').length;
  const warning = disks.filter((disk) => disk.health === 'warning').length;
  // A stale disk's temperature may be weeks old: not the hottest now.
  const temperatures = disks
    .filter((disk) => !disk.stale)
    .map((disk) => disk.temperature)
    .filter((t) => t !== null);
  const components = [
    {
      type: 'value',
      value: failed,
      label: pick(TEXT.failed, language),
      icon: 'x-circle',
      color: failed > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: warning,
      label: pick(TEXT.warning, language),
      icon: 'alert-triangle',
      color: warning > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (temperatures.length > 0) {
    const hottest = Math.max(...temperatures);
    components.push({
      type: 'value',
      value: hottest,
      unit: '°C',
      label: pick(TEXT.hottest, language),
      icon: 'thermometer',
      // Above 50 °C, most disk makers' operating range ends near.
      color: hottest >= 50 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }

  if (hub.error) {
    components.push({
      type: 'text',
      variant: 'body',
      text: pick(ERROR_TEXT[hub.error.kind], language),
    });
  }

  if (disks.length > 0) {
    let rows = disks.map((disk) => diskRow(disk, now, language));
    if (rows.length > MAX_ROWS) {
      const hidden = rows.length - (MAX_ROWS - 1);
      rows = [
        ...rows.slice(0, MAX_ROWS - 1),
        {
          label: pick(TEXT.more, language),
          value: `+${hidden}`,
          icon: 'more-horizontal',
          color: WIDGET_COLORS.NEUTRAL,
        },
      ];
    }
    components.push({ type: 'status', items: rows });
  }

  components.push({
    type: 'button',
    label: pick(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });

  return { ttl_seconds: hub.error ? 60 : 300, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollNow();
  if (hub.error) {
    return { message: ERROR_TEXT[hub.error.kind] };
  }
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
