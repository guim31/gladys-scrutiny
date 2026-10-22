# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.0] - 2026-10-19

### Added

- First version: the disks of a Scrutiny web server (v0.8 or v0.9) in Gladys,
  one device per disk, identified by its Scrutiny id (model, serial, WWN): failed or not, health (OK,
  warning, failed, as the Scrutiny dashboard decides it), temperature,
  power-on hours, reallocated and pending sectors (SATA), hours since the last
  collection; and a Scrutiny device with the disks failed, with a warning and
  in total.
- Scene triggers: a disk fails, passes again, is no longer collected (after a
  delay chosen in the configuration), for any disk, added to Gladys or not,
  announced once even across a restart.
- Scene actions: state of a disk, with a ready-made sentence; count the failed
  disks, for a report.
- Dashboard widget: failed disks first, then warnings, with their temperature,
  and a Refresh button.
- Optional basic authentication, for a reverse proxy in front of Scrutiny.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/guim31/gladys-scrutiny/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-scrutiny/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-scrutiny/releases/tag/v1.0.0
