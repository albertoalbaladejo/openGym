#!/usr/bin/env node
/* Post a plan file to POST /api/admin/import-plan and print the summary.
 *
 * No dependencies — Node's own fetch and argv, same constraint the rest of the repo keeps.
 *
 *   node scripts/import-plan.mjs plans/my-plan.json
 *   node scripts/import-plan.mjs plan.json --url https://gym.example.com --user <uid>
 *   node scripts/import-plan.mjs plan.json --dry-run
 *
 * The key comes from --key, then IMPORT_API_KEY in the environment, then the .env file
 * next to docker-compose.yml. It is never printed, not even on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { file: null, url: null, user: null, key: null, dryRun: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v == null) fail(`${a} needs a value`); return v; };
    if (a === '--url') out.url = val();
    else if (a === '--user' || a === '--user-id') out.user = val();
    else if (a === '--key') out.key = val();
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--json') out.json = true;
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else if (a.startsWith('-')) fail(`unknown option ${a}`);
    else if (!out.file) out.file = a;
    else fail('more than one plan file given');
  }
  return out;
}

function usage() {
  console.log(`Usage: node scripts/import-plan.mjs <plan.json> [options]

  --url <origin>    where openGym lives          (default: ORIGIN from .env, else http://localhost:8080)
  --user <id|name>  which profile to import into (default: the only profile on the instance)
  --key <key>       the import key               (default: IMPORT_API_KEY from the environment or .env)
  --dry-run         resolve and report, write nothing
  --json            print the raw response instead of the summary`);
}

const fail = msg => { console.error('✗ ' + msg); process.exit(2); };

/** Minimal .env reader — enough for KEY=value lines, which is all this file has. */
function readEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function report(r, dryRun) {
  const c = r.counts || {};
  console.log(`\n${dryRun ? '◦ dry run — nothing was written' : '✓ imported'}  ·  profile ${r.user_id}`);
  if (r.backup) console.log(`  backup      ${r.backup}`);
  console.log(`  routines    ${plural(c.routines_created || 0, 'created', 'created')}, ${c.routines_updated || 0} updated`);
  console.log(`  exercises   ${c.exercises_matched || 0} matched in the catalogue, ` +
    `${c.exercises_custom_created || 0} created as custom, ${c.exercises_custom_reused || 0} custom reused`);
  if (c.day_overrides) console.log(`  calendar    ${plural(c.day_overrides, 'day override', 'day overrides')} ${dryRun ? 'would be written' : 'written'} (deload weeks)`);

  if (r.exercises?.custom_created?.length) {
    console.log('\n  Created as custom exercises (not in the dataset):');
    r.exercises.custom_created.forEach(e => console.log(`    · ${e.name}  →  ${e.body_part}`));
  }
  if (r.exercises?.unresolved?.length) {
    console.log('\n  ✗ Not imported:');
    r.exercises.unresolved.forEach(e => console.log(`    · ${e.name || '(no name)'} — ${e.reason}`));
  }
  const week = r.week || {};
  const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = Object.keys(week);
  if (days.length) {
    console.log('\n  Week:');
    [1, 2, 3, 4, 5, 6, 0].filter(d => week[d]).forEach(d => console.log(`    ${DAYN[d]}  ${week[d]}`));
  }
  if (r.warnings?.length) {
    console.log('\n  Warnings:');
    r.warnings.forEach(w => console.log(`    ! ${w}`));
  }
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) { usage(); process.exit(2); }
  if (!fs.existsSync(args.file)) fail(`no such file: ${args.file}`);

  let payload;
  try { payload = JSON.parse(fs.readFileSync(args.file, 'utf8')); }
  catch (e) { fail(`${args.file} is not valid JSON — ${e.message}`); }

  const env = readEnvFile();
  const key = args.key || process.env.IMPORT_API_KEY || env.IMPORT_API_KEY;
  if (!key) fail('no import key — pass --key, or set IMPORT_API_KEY in the environment or in .env');

  const base = (args.url || process.env.OPENGYM_URL || env.ORIGIN || 'http://localhost:8080').replace(/\/+$/, '');
  const url = new URL(base + '/api/admin/import-plan');
  if (args.user) url.searchParams.set('user_id', args.user);
  if (args.dryRun) url.searchParams.set('dry_run', '1');

  console.log(`→ ${url.origin}${url.pathname}  ·  ${path.basename(args.file)}`);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Import-Key': key },
      body: JSON.stringify(payload),
    });
  } catch (e) { fail(`could not reach ${url.origin} — ${e.message}`); }

  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 400) }; }

  if (args.json) { console.log(JSON.stringify(body, null, 2)); process.exit(res.ok ? 0 : 1); }

  if (!res.ok) {
    // The three the endpoint is designed to answer with get an explanation, because each one
    // means a different thing to fix.
    if (res.status === 501) console.error('✗ 501 — plan import is switched off on this instance.\n  Set IMPORT_API_KEY in .env and restart: docker compose up -d --build api');
    else if (res.status === 401) console.error('✗ 401 — the instance rejected the key. Check IMPORT_API_KEY matches the one the api container was started with.');
    else if (res.status === 429) console.error('✗ 429 — rate limited. Wait for the window to pass and try again.');
    else if (res.status === 404 && body.profiles) {
      console.error(`✗ 404 — ${body.error}`);
      body.profiles.forEach(p => console.error(`    ${p.id}  ${p.name}`));
    } else console.error(`✗ ${res.status} — ${body.error || text.slice(0, 200)}`);
    process.exit(1);
  }

  report(body, body.dry_run);
}

main();
