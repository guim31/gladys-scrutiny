# Scrutiny

[Scrutiny](https://github.com/AnalogJ/scrutiny) watches the health of your
hard drives and SSDs: its collector reads their S.M.A.R.T. data (usually once
a day) and its web dashboard tells which disk passes, which one shows a
warning and which one fails, with thresholds drawn from real failure rates.
This integration brings that dashboard into Gladys: each disk becomes a device
with its health, temperature and counters, scenes react when a disk fails,
passes again or is no longer collected, and a dashboard widget lists the disks
that need attention first.

Gladys reads the Scrutiny web server: it never touches your disks. Everything
stays on your network (no cloud).

Tested against a real Scrutiny in Docker (v0.9.5, the omnibus image), fed with
real `smartctl` outputs from the Scrutiny test suite: disks passed, with a
warning, failed by S.M.A.R.T. and by Scrutiny, an NVMe disk, a stale
collection. Not yet on a live installation: feedback welcome on
[the issues](https://github.com/guim31/gladys-scrutiny/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- A Scrutiny web server (the `omnibus` image, or `web` + InfluxDB) reachable
  from Gladys, usually on port 8080, with at least one collector sending it
  data. Scrutiny v0.8 and v0.9 are supported.
- If a reverse proxy asks for a login in front of Scrutiny: its user and
  password (basic authentication). Scrutiny itself has no login.

## Getting started

### 1. Find the address of Scrutiny

It is the address of its dashboard, for example `http://192.168.1.2:8080`. A
URL copied from the browser works too (`…/web/dashboard`): the integration
keeps the server part. Behind a reverse proxy with a sub-path (the `basepath`
setting of Scrutiny), enter the address with that sub-path.

### 2. Configure the integration

In Gladys, open **Integrations → Scrutiny → Configuration**:

- **Scrutiny address**: the address found above.
- **Proxy user (optional)** and **Proxy password (optional)**: only if a
  reverse proxy asks for them.
- **Refresh interval**: how often Scrutiny is read, 15 minutes by default.
  One request for the list of disks and one for the settings each time; the
  attributes of a disk are read again only after a new collection.
- **Collection too old after**: after how long without a new collection a
  disk fires "Disk no longer collected" (36 hours by default, for a collector
  that runs once a day).
- **Language of the names**: the language of the feature names (set when a
  device is added) and of the texts sent to scenes.

Then click **Test the connection**: it tells how many disks Scrutiny follows,
and how many failed.

### 3. Add the disks

Open the **Discover** tab of the integration and add the disks to follow, and
the **Scrutiny** device if you want the totals. Archived disks of Scrutiny are
not proposed. A disk is identified by its Scrutiny id (built from its model,
serial number and WWN: a WWN alone is not always unique): moving it to another
port or machine keeps the same device, and so does an upgrade from Scrutiny
v0.8 to v0.9.

## The devices

Each disk has these features:

- **Disk failed**: yes when Scrutiny marks the disk as failed, the way its
  dashboard does (the "status threshold" of the Scrutiny settings: S.M.A.R.T.,
  Scrutiny or both). The condition to use in scenes.
- **Health**: OK, Warning (the disk passes but an attribute does not look
  good) or Failed, as a text.
- **Temperature**: at the last collection, in °C.
- **Power-on hours**: as reported by the disk.
- **Reallocated sectors** and **Pending sectors**: S.M.A.R.T. attributes 5 and
  197, only on the disks that report them (SATA). A growing count is the first
  sign of a dying disk.
- **Since last collection**: hours since the collector last sent data for the
  disk.

The **Scrutiny** device counts the **Failed disks**, the
**Disks with a warning** and the **Disks in total**.

## Dashboard

The **Scrutiny disks** widget shows three tiles (failed, warnings, the
hottest temperature), then one row per disk: the failed ones first, then the
warnings, the disks no longer collected and the healthy ones, ten rows at
most. Choose some disks in its settings to show only them. **Refresh** reads
Scrutiny again.

## Scenes

### Triggers

- **A disk fails**: Scrutiny marks a disk as failed after a collection.
  Variables: the disk name, its model, the failing attributes and its
  temperature.
- **A disk passes again**: a failed disk passes again at a new collection, or
  after a change of the Scrutiny status threshold. Variables: the disk name,
  its model and how many hours it was failed.
- **Disk no longer collected**: no new collection for a disk for the delay of
  the configuration (the collector stopped, the disk is gone). One event per
  disk. Variables: the disk name, its model and the hours since its last
  collection.

Each trigger can be limited to some disks. A disk seen for the first time
fires nothing: a disk failed for months is not news. The last state of each
disk is kept by the integration, so a disk that failed while Gladys or the
integration restarted is still announced, once.

### Actions

- **State of a disk**: reads a disk for the next actions: failed or not, its
  health, name, model, temperature, power-on hours, hours since the
  collection, the attributes in cause, and a ready-made sentence such as
  "Samsung SSD 840 (sdd): Failed, 33 °C, collected 5 days ago. UltraDMA CRC
  Error Count."
- **Count the failed disks**: counts the disks failed, with a warning, no
  longer collected and in total, and names the failed ones, for a report.

Both read Scrutiny again when the last reading is more than a minute old.

### Scene ideas

- **A disk fails** → send a Telegram message "Disk {disk} failed:
  {reason}", and light a lamp in red.
- Every Sunday at 10:00 → **Count the failed disks** → if failed is above 0,
  send "{names} failed, {warning} disk(s) with a warning".
- **Disk no longer collected** → notify "The Scrutiny collector of {disk}
  stopped {hours} hours ago": a backup NAS that did not wake up, a collector
  container that crashed.

## Troubleshooting

- **"Scrutiny does not answer"**: check the address and the port from the
  machine of Gladys, and that a firewall does not block it.
- **"Scrutiny answers with an error"**: its database (InfluxDB) is down or
  full; the Scrutiny dashboard shows the same error.
- **"A login is asked"**: a reverse proxy protects Scrutiny; fill in its user
  and password (basic authentication only).
- **"The address redirects"**: enter the `https://` address directly.
- **"Certificate refused"**: a self-signed certificate is not accepted; use
  the `http://` address on your network.
- **No disk**: no collector sent data yet; run it once
  (`docker exec scrutiny scrutiny-collector-metrics run` with the omnibus
  image).
- **A disk stays "Not collected yet"**: it is registered but its collector
  could not read its S.M.A.R.T. data (a USB enclosure, a RAID controller): see
  the collector logs.
- **The health differs from the Scrutiny dashboard**: reload the dashboard;
  the integration reads the same status threshold, at the chosen interval.

## Limits

- The data is the one of the last collection: with the default daily
  collector, a disk failing at noon shows at the next collection.
- Scrutiny's history, its notifications and the self-test results are not
  read; the history of each feature is kept by Gladys.
- The sector counters exist only for SATA disks; NVMe and SAS disks show their
  health, temperature and hours.
- Not affiliated with Scrutiny or its author.
