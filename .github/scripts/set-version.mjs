// Usage: node .github/scripts/set-version.mjs <version | base | base-beta.N>
// Patches tauri.conf.json and Cargo.toml in the CI checkout and prints the
// resulting version. "base" (or a base with -beta.N) is resolved against the
// version currently in tauri.conf.json with any prerelease suffix removed.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const confPath = 'packages/app/src-tauri/tauri.conf.json';
const cargoPath = 'packages/app/src-tauri/Cargo.toml';

const conf = JSON.parse(readFileSync(confPath, 'utf8'));
const base = String(conf.version).split('-')[0];
const arg = process.argv[2] ?? 'base';
const version = arg === 'base' ? base : arg.replace(/^base(?=-)/, base);

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  console.error(`Invalid version: ${version}`);
  process.exit(1);
}

conf.version = version;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');

const cargo = readFileSync(cargoPath, 'utf8');
const patched = cargo.replace(/^version = ".*"$/m, `version = "${version}"`);
if (patched === cargo && !cargo.includes(`version = "${version}"`)) {
  console.error('Cargo.toml version line not found');
  process.exit(1);
}
writeFileSync(cargoPath, patched);

console.log(version);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=v${version}\n`);
}
