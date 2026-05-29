// Syncs a release version across package.json, src-tauri/tauri.conf.json, and
// src-tauri/Cargo.toml. Used by the release workflow so the git tag is the single
// source of truth. Pure Node, no deps — runs identically on Windows and macOS runners.
//
// Usage: node scripts/sync-version.mjs v1.2.3   (the leading "v" is optional)

import { readFileSync, writeFileSync } from 'node:fs'

const raw = process.argv[2]
if (!raw) {
  console.error('Usage: node scripts/sync-version.mjs <version|tag>')
  process.exit(1)
}

// v1.2.3 -> 1.2.3 ; bare 1.2.3 passes through unchanged.
const version = raw.replace(/^v/, '')

// package.json
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
pkg.version = version
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')

// src-tauri/tauri.conf.json
const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
conf.version = version
writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(conf, null, 2) + '\n')

// src-tauri/Cargo.toml — first `version = "..."` line is the [package] version.
let cargo = readFileSync('src-tauri/Cargo.toml', 'utf8')
cargo = cargo.replace(/^version = ".*"$/m, `version = "${version}"`)
writeFileSync('src-tauri/Cargo.toml', cargo)

console.log('Synced version to', version)
