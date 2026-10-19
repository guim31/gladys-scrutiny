// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, disk health, the "Test the connection" report,
// scene outputs and errors. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './scrutiny/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your Scrutiny in the configuration.',
    fr: "Saisissez l'adresse de votre Scrutiny dans la configuration.",
    de: 'Gib die Adresse deines Scrutiny in der Konfiguration ein.',
    es: 'Introduzca la dirección de su Scrutiny en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2:8080',
    fr: 'Adresse incomprise, ex. http://192.168.1.2:8080',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2:8080',
    es: 'Dirección no válida, p. ej. http://192.168.1.2:8080',
  },
};

// One short explanation per error kind (src/scrutiny/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Scrutiny does not answer',
    fr: 'Scrutiny ne répond pas',
    de: 'Scrutiny antwortet nicht',
    es: 'Scrutiny no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'Certificate refused: use an http:// address or a trusted certificate',
    fr: 'Certificat refusé : utilisez une adresse http:// ou un certificat reconnu',
    de: 'Zertifikat abgelehnt: Nutze eine http://-Adresse oder ein vertrauenswürdiges Zertifikat',
    es: 'Certificado rechazado: use una dirección http:// o un certificado reconocido',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'A login is asked: check the user and password of your proxy',
    fr: "Une connexion est demandée : vérifiez l'utilisateur et le mot de passe de votre proxy",
    de: 'Eine Anmeldung wird verlangt: Prüfe Benutzer und Passwort deines Proxys',
    es: 'Se pide iniciar sesión: compruebe el usuario y la contraseña de su proxy',
  },
  [ERROR_KINDS.NOT_SCRUTINY]: {
    en: 'No Scrutiny at this address',
    fr: 'Aucun Scrutiny à cette adresse',
    de: 'Kein Scrutiny unter dieser Adresse',
    es: 'No hay ningún Scrutiny en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'The address redirects: enter the https:// address',
    fr: "L'adresse redirige : saisissez l'adresse en https://",
    de: 'Die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'La dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.SERVER]: {
    en: 'Scrutiny answers with an error: check its database (InfluxDB)',
    fr: 'Scrutiny répond en erreur : vérifiez sa base de données (InfluxDB)',
    de: 'Scrutiny antwortet mit einem Fehler: Prüfe seine Datenbank (InfluxDB)',
    es: 'Scrutiny responde con un error: compruebe su base de datos (InfluxDB)',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'Unexpected answer, see the logs',
    fr: 'Réponse inattendue, voir les logs',
    de: 'Unerwartete Antwort, sieh in den Protokollen nach',
    es: 'Respuesta inesperada, consulte los registros',
  },
};

// The health of a disk, in words (the `health` feature, widget rows, scene
// outputs).
export const HEALTH_TEXT = {
  ok: { en: 'OK', fr: 'OK', de: 'OK', es: 'OK' },
  warning: { en: 'Warning', fr: 'Avertissement', de: 'Warnung', es: 'Advertencia' },
  failed: { en: 'Failed', fr: 'En échec', de: 'Fehlerhaft', es: 'Con fallo' },
  unknown: {
    en: 'Not collected yet',
    fr: 'Pas encore collecté',
    de: 'Noch nicht erfasst',
    es: 'Aún sin recopilar',
  },
};

// Why a disk failed when no attribute does (the `reason` of "A disk fails").
export const REASON_TEXT = {
  smart: {
    en: 'S.M.A.R.T. overall check failed',
    fr: 'test global S.M.A.R.T. en échec',
    de: 'S.M.A.R.T.-Gesamtprüfung fehlgeschlagen',
    es: 'prueba global S.M.A.R.T. fallida',
  },
  scrutiny: {
    en: 'Scrutiny thresholds exceeded',
    fr: 'seuils de Scrutiny dépassés',
    de: 'Scrutiny-Schwellen überschritten',
    es: 'umbrales de Scrutiny superados',
  },
};

// "Collected 3 days ago", for a stale disk: a widget row and a scene output.
export const STALE_TEXT = {
  en: { since: (age) => `collected ${age} ago` },
  fr: { since: (age) => `collecté il y a ${age}` },
  de: { since: (age) => `vor ${age} erfasst` },
  es: { since: (age) => `recopilado hace ${age}` },
};

// A duration in hours, rounded to days past two days.
export const AGE_TEXT = {
  en: { hours: (n) => `${n} h`, days: (n) => `${n} days` },
  fr: { hours: (n) => `${n} h`, days: (n) => `${n} jours` },
  de: { hours: (n) => `${n} Std.`, days: (n) => `${n} Tagen` },
  es: { hours: (n) => `${n} h`, days: (n) => `${n} días` },
};

/** "36 h", "3 days" (German in the dative: "vor 3 Tagen"). */
export function ageText(hours, language) {
  const text = AGE_TEXT[language] ?? AGE_TEXT.en;
  return hours >= 48 ? text.days(Math.floor(hours / 24)) : text.hours(hours);
}

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'Connected',
    disks: (count) => `${count} disk(s)`,
    failed: (count) => `${count} failed`,
    warning: (count) => `${count} with a warning`,
  },
  fr: {
    ok: 'Connecté',
    disks: (count) => `${count} disque(s)`,
    failed: (count) => `${count} en échec`,
    warning: (count) => `${count} en avertissement`,
  },
  de: {
    ok: 'Verbunden',
    disks: (count) => `${count} Festplatte(n)`,
    failed: (count) => `${count} fehlerhaft`,
    warning: (count) => `${count} mit Warnung`,
  },
  es: {
    ok: 'Conectado',
    disks: (count) => `${count} disco(s)`,
    failed: (count) => `${count} con fallo`,
    warning: (count) => `${count} con advertencia`,
  },
};

// Errors of the scene actions (shown in Gladys).
export const ACTION_TEXT = {
  unknownDisk: {
    en: 'This device is not a Scrutiny disk.',
    fr: "Cet appareil n'est pas un disque Scrutiny.",
    de: 'Dieses Gerät ist keine Scrutiny-Festplatte.',
    es: 'Este dispositivo no es un disco de Scrutiny.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
