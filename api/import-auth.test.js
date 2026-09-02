/* The endpoint's guards, over real HTTP: off by default, closed to a wrong key, rate limited.
 * The server is spawned as a child process because server.js starts listening on import. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY = 'test-import-key-0123456789abcdef';
const UID = 'testuid1';

/** Boot an api on an ephemeral port over a throwaway DATA_DIR. */
async function startServer(env = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-test-'));
  fs.writeFileSync(path.join(data, 'db.json'), JSON.stringify({
    users: [{ id: UID, name: 'Test', created: '2026-01-01T00:00:00.000Z' }], creds: [], subs: [], invites: []
  }));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(HERE, 'server.js')], {
    env: { ...process.env, DATA_DIR: data, PORT: String(port), ORIGIN: `http://127.0.0.1:${port}`, AUDIT_LOG: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  // Wait for it to answer rather than sleeping a guessed amount.
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 50));
  }
  return {
    base, data,
    post: (body, headers = {}, qs = '') => fetch(`${base}/api/admin/import-plan${qs}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    }),
    stop: () => { child.kill('SIGKILL'); fs.rmSync(data, { recursive: true, force: true }); },
  };
}

const MINIMAL = { daily_postural_routine: [{ name: 'Wall angels', sets: 3, reps: '10' }] };

test('with no IMPORT_API_KEY the endpoint is inert — 501, not merely unauthenticated', async () => {
  const s = await startServer({ IMPORT_API_KEY: '' });
  try {
    for (const headers of [{}, { 'X-Import-Key': 'anything' }, { 'X-Import-Key': '' }]) {
      const res = await s.post(MINIMAL, headers);
      assert.equal(res.status, 501, 'a default instance must not expose a write path');
      const body = await res.json();
      assert.match(body.error, /not enabled/);
    }
    // …and nothing was written on the way past.
    assert.equal(fs.existsSync(path.join(s.data, `state-${UID}.json`)), false);
  } finally { s.stop(); }
});

test('a wrong or missing key is 401, and writes nothing', async () => {
  const s = await startServer({ IMPORT_API_KEY: KEY });
  try {
    for (const headers of [{}, { 'X-Import-Key': 'wrong' }, { 'X-Import-Key': KEY + 'x' }, { 'X-Import-Key': KEY.slice(0, -1) }]) {
      const res = await s.post(MINIMAL, headers);
      assert.equal(res.status, 401);
    }
    assert.equal(fs.existsSync(path.join(s.data, `state-${UID}.json`)), false);
  } finally { s.stop(); }
});

test('the right key gets in, writes the state, and backs up the previous one', async () => {
  const s = await startServer({ IMPORT_API_KEY: KEY });
  try {
    const first = await s.post(MINIMAL, { 'X-Import-Key': KEY });
    assert.equal(first.status, 200);
    const b1 = await first.json();
    assert.equal(b1.ok, true);
    assert.equal(b1.user_id, UID);
    assert.equal(b1.backup, null, 'nothing to back up on the very first import');
    assert.ok(fs.existsSync(path.join(s.data, `state-${UID}.json`)));

    const second = await s.post(MINIMAL, { 'X-Import-Key': KEY });
    const b2 = await second.json();
    assert.match(b2.backup, /^state-testuid1\.json\.bak-/, 'the previous state was copied aside');
    assert.ok(fs.existsSync(path.join(s.data, b2.backup)));
    assert.equal(b2.counts.routines_created, 0, 'and the second run created nothing');
  } finally { s.stop(); }
});

test('a dry run resolves and reports without touching the disk', async () => {
  const s = await startServer({ IMPORT_API_KEY: KEY });
  try {
    const res = await s.post(MINIMAL, { 'X-Import-Key': KEY }, '?dry_run=1');
    const body = await res.json();
    assert.equal(body.dry_run, true);
    assert.ok(body.counts.routines_created > 0, 'it still says what it would do');
    assert.equal(fs.existsSync(path.join(s.data, `state-${UID}.json`)), false);
  } finally { s.stop(); }
});

test('an unknown profile is 404 with the list, never a write to the wrong one', async () => {
  const s = await startServer({ IMPORT_API_KEY: KEY });
  try {
    const res = await s.post(MINIMAL, { 'X-Import-Key': KEY }, '?user_id=nobody');
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.deepEqual(body.profiles, [{ id: UID, name: 'Test' }]);
    assert.equal(fs.existsSync(path.join(s.data, `state-${UID}.json`)), false);
  } finally { s.stop(); }
});

test('the endpoint is rate limited', async () => {
  const s = await startServer({ IMPORT_API_KEY: KEY, IMPORT_RATE_MAX: '3', IMPORT_RATE_WINDOW_S: '60' });
  try {
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await s.post(MINIMAL, { 'X-Import-Key': 'wrong' })).status);
    assert.deepEqual(codes.slice(0, 3), [401, 401, 401]);
    assert.deepEqual(codes.slice(3), [429, 429]);
    // The limit is on the route, not on the credential — a valid key is throttled too.
    assert.equal((await s.post(MINIMAL, { 'X-Import-Key': KEY })).status, 429);
  } finally { s.stop(); }
});

test('the import never touches db.json — no profile is created, renamed or disabled', async () => {
  const s = await startServer({ IMPORT_API_KEY: KEY });
  try {
    const before = fs.readFileSync(path.join(s.data, 'db.json'), 'utf8');
    await s.post(MINIMAL, { 'X-Import-Key': KEY });
    assert.equal(fs.readFileSync(path.join(s.data, 'db.json'), 'utf8'), before);
  } finally { s.stop(); }
});
