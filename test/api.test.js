import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { startDeckServer } from '../server/app.js';

const quiet = { log() {}, warn() {}, error() {} };

test('interface : les requêtes sans paramètre (mise à jour) sont acceptées par le serveur', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-api-'));
  let installs = 0;
  const status = { current: '1.0.0', state: 'available', latest: '2.0.0', canInstall: true };
  const updater = { status: () => status, check: async () => status, install: () => installs++, onChange: () => () => {} };
  const deck = await startDeckServer({ port: 0, host: '127.0.0.1', dataDir, dryRun: true, discovery: false, msfs: false, simhub: false, updater, log: quiet });
  // Le client de l'interface utilise des adresses relatives : on les résout vers le serveur de test.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => realFetch(new URL(url, `http://127.0.0.1:${deck.port}`), opts);
  try {
    const { api } = await import('../public/js/api.js');
    assert.equal((await api.checkUpdate()).latest, '2.0.0');
    await api.installUpdate();
    assert.equal(installs, 1);
  } finally {
    globalThis.fetch = realFetch;
    await deck.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('documentation : servie par le serveur à /docs, avec les sections principales', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-docs-'));
  const deck = await startDeckServer({ port: 0, host: '127.0.0.1', dataDir, dryRun: true, discovery: false, msfs: false, simhub: false, log: quiet });
  try {
    const res = await fetch(`http://127.0.0.1:${deck.port}/docs`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    for (const id of ['principe', 'actions', 'jeux', 'mode-jeu', 'msfs', 'code-avionique', 'simhub', 'rafale', 'depannage']) {
      assert.ok(html.includes(`id="${id}"`), `section ${id}`);
    }
    // Tous les liens internes du sommaire pointent vers une section existante.
    for (const [, target] of html.matchAll(/href="#([\w-]+)"/g)) assert.ok(html.includes(`id="${target}"`), `lien #${target}`);
    assert.match(html, /Mode jeu/);
    assert.match(html, /MobiFlight/);
    const index = await (await fetch(`http://127.0.0.1:${deck.port}/`)).text();
    assert.match(index, /href="\/docs"/);
  } finally {
    await deck.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('pages : aucune limite de nombre de pages, enregistrées et relues intégralement', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-pages-'));
  const deck = await startDeckServer({ port: 0, host: '127.0.0.1', dataDir, dryRun: true, discovery: false, msfs: false, simhub: false, log: quiet });
  const base = `http://127.0.0.1:${deck.port}`;
  try {
    const { config } = await (await fetch(`${base}/api/config`)).json();
    const profile = config.profiles[0];
    profile.pages = Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, name: `Page ${i + 1}`, keys: { 0: { title: `T${i}`, icon: '⭐', color: '#334155', action: { type: 'page', pageId: i ? `p${i - 1}` : 'p499' } } } }));
    const put = await fetch(`${base}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) });
    assert.equal(put.status, 200);
    const back = await (await fetch(`${base}/api/config`)).json();
    assert.equal(back.config.profiles[0].pages.length, 500);
    assert.equal(back.config.profiles[0].pages[499].name, 'Page 500');
  } finally {
    await deck.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
