# Scrutiny for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings the disk health dashboard of
[Scrutiny](https://github.com/AnalogJ/scrutiny) into Gladys: the S.M.A.R.T.
state of your hard drives and SSDs, as Scrutiny judges it.

- **One device per disk** (identified by its Scrutiny id: model, serial, WWN): failed or not, health (OK,
  warning, failed), temperature, power-on hours, reallocated and pending
  sectors (SATA), hours since the last collection.
- **One instance device**: disks failed, with a warning, in total.
- **Scene triggers**: a disk fails (with the failing attributes), passes
  again (with how long it was failed), is no longer collected (a stopped
  collector) — for any disk, added to Gladys or not.
- **Scene actions**: state of a disk (with a ready-made sentence), count the
  failed disks (for a weekly report).
- **Dashboard widget**: failed disks first, then warnings, with their
  temperature.
- Texts in English, French, German and Spanish.

Neighbours: the Unraid, TrueNAS, Glances and Beszel integrations already show
disk temperatures; this one adds what they do not have, the S.M.A.R.T. verdict
of Scrutiny and its history of failures, for any machine a Scrutiny collector
runs on.

Tested against a real Scrutiny in Docker (v0.9.5, omnibus image), fed with
real `smartctl` outputs: disks passed, with a warning, failed, an NVMe disk, a
stale collection. Not yet on a live installation: feedback welcome on
[the issues](https://github.com/guim31/gladys-scrutiny/issues).

## Requirements

- Gladys Assistant 5.1.0 or later.
- A Scrutiny web server (v0.8 or v0.9) reachable from Gladys (port 8080 by
  default), with a collector sending it data. Basic authentication of a
  reverse proxy in front of it is supported.

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-scrutiny`. Then open its configuration,
enter the address of Scrutiny, and add the disks from the Discover tab.

The full guide: [docs/en.md](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

The container reads `GET /api/summary` and `GET /api/settings` at the chosen
interval (15 minutes by default), and `GET /api/device/{id}/details` for a
disk only after a new collection (the collector usually runs once a day). A
disk is failed when its `device_status` matches the status threshold of the
Scrutiny settings, exactly as the Scrutiny dashboard decides; it has a
warning when it passes but one of its attributes does not. The states of the
devices added to Gladys are published when they change, and the scene events
fire on the transitions of every disk. The last state of each disk is kept in
`/data`, so a disk that failed during a restart is announced once. Redirects
are not followed, so the credentials are never sent to another host.

## Limits

- One Scrutiny server per configuration; read-only (nothing is changed in
  Scrutiny).
- The data is the one of the last collection.
- Scrutiny's notifications, self-test results and history are not read.
- A self-signed HTTPS certificate is not accepted (use `http://` on the local
  network).

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the notes on the
Scrutiny API.

## Credits

- [Scrutiny](https://github.com/AnalogJ/scrutiny) by Jason Kulatunga
  (AnalogJ) and contributors (MIT): the answers in `test/fixtures/scrutiny`
  come from its Docker image, fed with the `smartctl` outputs of its test
  suite. The cover uses the Scrutiny logo from its repository (glasses by
  matias porta lezcano, [the Noun Project](https://thenounproject.com/term/glasses/775232)).
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and on the architecture of
  [gladys-gatus](https://github.com/guim31/gladys-gatus).

Not affiliated with Scrutiny or its author.

## License

Apache-2.0, see [LICENSE](LICENSE).
