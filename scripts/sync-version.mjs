// Syncs a release version across package.json, src-tauri/tauri.conf.json, and
// src-tauri/Cargo.toml. Used by the release workflow (tag is the source of truth)
// and by the `npm version` lifecycle hook (package.json is the source of truth).
// Pure Node, no deps — runs identically on Windows and macOS.
//
// Usage:
//   node scripts/sync-version.mjs v1.2.3   sync to the given version/tag (leading "v" optional)
//   node scripts/sync-version.mjs          sync tauri.conf.json + Cargo.toml to package.json's version

import { readFileSync, writeFileSync } from 'node:fs'

const raw = process.argv[2]

// package.json — with an explicit arg, becomes the new version; with no arg, the
// existing version is read back and used to drive the other two files. `npm version`
// has already bumped package.json by the time this hook runs, so no-arg is correct there.
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
// v1.2.3 -> 1.2.3 ; bare 1.2.3 passes through unchanged.
const version = raw ? raw.replace(/^v/, '') : pkg.version
if (raw) {
  pkg.version = version
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
}

// src-tauri/tauri.conf.json
const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
conf.version = version
writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(conf, null, 2) + '\n')

// src-tauri/Cargo.toml — first `version = "..."` line is the [package] version.
let cargo = readFileSync('src-tauri/Cargo.toml', 'utf8')
cargo = cargo.replace(/^version = ".*"$/m, `version = "${version}"`)
writeFileSync('src-tauri/Cargo.toml', cargo)

console.log('Synced version to', version)
