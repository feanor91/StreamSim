import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { compareVersions } from '../shared/version.js';
import { createReleaseChecker } from '../server/update.js';
import { startDeckServer, VERSION } from '../server/app.js';

const quiet = { log() {}, warn() {}, error() {} };
const fakeGitHub = (tag) => async () => ({ ok: true, status: 200, json: async () => ({ tag_name: tag, html_url: `https://example/${tag}`, body: 'notes' }) });

test('comparaison de versions', () => {
  assert.ok(compareVersions('v0.10.0', '0.9.9') > 0);
  assert.ok(compareVersions('0.6.1', 'v0.6.2') < 0);
  assert.equal(compareVersions('v1.0', '1.0.0'), 0);
  assert.equal(compareVersions('n’importe quoi', '1.0.0'), 0);
});

test('recherche de mise à jour : disponible, à jour, erreur', async () => {
  const seen = [];
  const newer = createReleaseChecker({ current: '0.6.1', log: quiet, auto: false, fetchImpl: fakeGitHub('v0.7.0') });
  newer.onChange((u) => seen.push(u.state));
  const u = await newer.check();
  assert.equal(u.state, 'available');
  assert.equal(u.latest, '0.7.0');
  assert.equal(u.url, 'https://example/v0.7.0');
  assert.deepEqual(seen, ['checking', 'available']);
  assert.throws(() => newer.install(), /application PC/);

  const same = createReleaseChecker({ current: '0.7.0', log: quiet, auto: false, fetchImpl: fakeGitHub('v0.7.0') });
  assert.equal((await same.check()).state, 'current');

  const offline = createReleaseChecker({ current: '0.7.0', log: quiet, auto: false, fetchImpl: async () => ({ ok: false, status: 404 }) });
  const e = await offline.check();
  assert.equal(e.state, 'error');
  assert.match(e.error, /aucune version publiée/);
});

test('serveur : état de mise à jour exposé et installation déléguée à l’application PC', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-update-'));
  let installed = 0;
  let listener = null;
  const status = { current: VERSION, state: 'ready', latest: '9.9.9', canInstall: true };
  const updater = {
    status: () => status,
    check: async () => status,
    install: () => installed++,
    onChange: (fn) => ((listener = fn), () => (listener = null)),
  };
  const deck = await startDeckServer({ port: 0, host: '127.0.0.1', dataDir, dryRun: true, discovery: false, msfs: false, updater, log: quiet });
  const url = `http://127.0.0.1:${deck.port}`;
  try {
    assert.equal((await fetch(`${url}/api/status`).then((r) => r.json())).version, VERSION);
    const u = await fetch(`${url}/api/update`).then((r) => r.json());
    assert.equal(u.latest, '9.9.9');
    const res = await fetch(`${url}/api/update/install`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 200);
    assert.equal(installed, 1);
    assert.equal(typeof listener, 'function');
  } finally {
    await deck.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
  assert.equal(listener, null);
});

test('serveur : relais de l’APK Android pour la tablette (téléchargé une fois, puis servi)', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-apk-'));
  const apk = Buffer.from('PK\u0003\u0004 faux apk');
  let downloads = 0;
  const apkFetch = async (url) => {
    if (url.includes('/releases/latest')) {
      return { ok: true, status: 200, json: async () => ({ tag_name: 'v9.9.9', assets: [{ name: 'StreamSim-Android-9.9.9.apk', size: apk.length, browser_download_url: 'https://example/apk' }] }) };
    }
    downloads++;
    return { ok: true, status: 200, arrayBuffer: async () => apk.buffer.slice(apk.byteOffset, apk.byteOffset + apk.length) };
  };
  const deck = await startDeckServer({ port: 0, host: '127.0.0.1', dataDir, dryRun: true, discovery: false, msfs: false, simhub: false, updateCheck: false, apkFetch, log: quiet });
  try {
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`http://127.0.0.1:${deck.port}/api/update/android.apk`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/vnd.android.package-archive');
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), apk);
    }
    assert.equal(downloads, 1, 'l’APK est gardé en cache sur le PC');
  } finally {
    await deck.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
