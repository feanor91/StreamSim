import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startDeckServer } from '../server/app.js';
import { createIconLibrary, slug } from '../server/icons.js';
import { AVIATION_ICON_GROUPS, AVIATION_ICONS, aviationIcon, migrateIconPaths, currentIconPath, isUserIconPath } from '../shared/icons.js';
import { validateConfig, defaultConfig } from '../server/store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { log() {}, warn() {}, error() {} };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const png = (extra = '') => ({ mime: 'image/png', data: Buffer.concat([PNG, Buffer.from(extra)]).toString('base64') });
const tmp = (p) => fs.mkdtemp(path.join(os.tmpdir(), p));

test('icônes intégrées : dossiers clairs, chaque icône listée existe et rien ne traîne', async () => {
  for (const g of AVIATION_ICON_GROUPS) {
    const dir = path.join(ROOT, 'public/icons/aviation', g.folder);
    assert.deepEqual((await fs.readdir(dir)).sort(), g.icons.map((n) => `${n}.svg`).sort(), g.folder);
  }
  assert.deepEqual((await fs.readdir(path.join(ROOT, 'public/icons'))).sort(), ['README.md', 'aviation', 'touches-completes']);
  assert.equal(aviationIcon('gear-down'), '/public/icons/aviation/train-et-commandes-de-vol/gear-down.svg');
  assert.throws(() => aviationIcon('nope'));
  assert.equal(AVIATION_ICONS.length, 36);
});

test('icônes intégrées : tous les chemins utilisés par les préréglages existent', async () => {
  const { RAFALE_COCKPIT_PRESETS, RAFALE_PRESETS, MSFS_PRESETS, MSFS_DIAL_PRESETS, MSFS_SLIDER_PRESETS, FBW_PRESETS } = await import('../shared/msfs.js');
  const paths = new Set(JSON.stringify([RAFALE_COCKPIT_PRESETS, RAFALE_PRESETS, MSFS_PRESETS, MSFS_DIAL_PRESETS, MSFS_SLIDER_PRESETS, FBW_PRESETS]).match(/\/public\/icons\/[\w/-]+\.svg/g));
  assert.ok(paths.size > 30);
  for (const p of paths) assert.ok(existsSync(path.join(ROOT, p)), p);
});

test('anciens chemins d’icônes : convertis à la lecture d’une configuration', () => {
  assert.equal(currentIconPath('/public/icons/avia/gear-down.svg'), '/public/icons/aviation/train-et-commandes-de-vol/gear-down.svg');
  assert.equal(currentIconPath('/public/icons/faces/rafale-5k-off.svg'), '/public/icons/touches-completes/rafale/selecteur-5k/off.svg');
  assert.equal(currentIconPath('/public/icons/faces/rafale-aecd-fix.svg'), '/public/icons/touches-completes/rafale/levier-aec-droit/fix.svg');
  assert.equal(currentIconPath('🙂'), '🙂');
  const cfg = defaultConfig();
  const pg = cfg.profiles[0].pages[0];
  pg.keys[3] = { title: 'x', icon: '/public/icons/avia/beacon.svg', alt: { icon: '/public/icons/faces/rafale-apu-on.svg' }, action: { type: 'dial', display: { images: ['/public/icons/faces/rafale-5k-test.svg', '/user-icons/mes-icones/a.png'] } } };
  validateConfig(cfg);
  assert.equal(pg.keys[3].icon, '/public/icons/aviation/feux/beacon.svg');
  assert.equal(pg.keys[3].alt.icon, '/public/icons/touches-completes/rafale/apu/on.svg');
  assert.deepEqual(pg.keys[3].action.display.images, ['/public/icons/touches-completes/rafale/selecteur-5k/test.svg', '/user-icons/mes-icones/a.png']);
  assert.equal(migrateIconPaths(cfg), 0);
  assert.ok(isUserIconPath('/user-icons/mes-icones/a.png') && !isUserIconPath('/public/icons/x.svg'));
});

test('bibliothèque d’icônes : enregistrer, lister, relire, supprimer, noms sûrs', async () => {
  const dir = await tmp('deck-icons-');
  const lib = createIconLibrary(dir);
  try {
    assert.equal(slug('Mes Icônes 2!'), 'mes-icones-2');
    assert.equal(slug('../../etc'), 'etc');
    const a = await lib.save({ folder: 'Mon Avion', name: 'Train ⚙', ...png() });
    assert.equal(a.path, '/user-icons/mon-avion/train.png');
    // Même contenu : pas de doublon ; contenu différent : nom numéroté.
    assert.equal((await lib.save({ folder: 'Mon Avion', name: 'Train', ...png() })).path, a.path);
    assert.equal((await lib.save({ folder: 'Mon Avion', name: 'Train', ...png('x') })).path, '/user-icons/mon-avion/train-2.png');
    const { icons, folders } = await lib.list();
    assert.deepEqual(folders, ['mon-avion']);
    assert.equal(icons.length, 2);
    assert.deepEqual((await lib.read('mon-avion/train.png')).data, PNG);
    await assert.rejects(lib.read('../../etc/passwd'), /introuvable/);
    await assert.rejects(lib.read('mon-avion/../train.png'), /introuvable/);
    await assert.rejects(lib.save({ folder: 'x', name: 'y', mime: 'image/png', data: Buffer.from('<html>').toString('base64') }), /ne correspond pas/);
    await assert.rejects(lib.save({ folder: 'x', name: 'y', mime: 'text/html', data: 'aGk=' }), /Format/);
    await assert.rejects(lib.save({ folder: 'x', name: 'y', mime: 'image/png', data: Buffer.alloc(3 * 1024 * 1024, 1).toString('base64') }), /trop lourde/);
    await lib.save({ folder: 'svg', name: 'rond', mime: 'image/svg+xml', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') });
    await lib.remove('svg/rond.svg');
    assert.ok(!(await lib.list()).folders.includes('svg'), 'dossier vide supprimé');
    await assert.rejects(lib.remove('mon-avion/inconnue.png'), /introuvable/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('bibliothèque d’icônes : export puis import dans une autre installation', async () => {
  const a = await tmp('deck-icons-a-');
  const b = await tmp('deck-icons-b-');
  try {
    const libA = createIconLibrary(a);
    await libA.save({ folder: 'dossier-1', name: 'un', ...png('1') });
    await libA.save({ folder: 'dossier-2', name: 'deux', ...png('2') });
    const bundle = await libA.exportBundle('9.9.9');
    assert.equal(bundle.app, 'streamsim-icons');
    assert.equal(bundle.icons.length, 2);
    const libB = createIconLibrary(b);
    assert.deepEqual(await libB.importBundle(JSON.parse(JSON.stringify(bundle))), { added: 2, replaced: 0, skipped: 0, kept: 0, invalid: 0 });
    assert.deepEqual((await libB.list()).icons.map((i) => i.path), ['/user-icons/dossier-1/un.png', '/user-icons/dossier-2/deux.png']);
    // Réimport : rien à faire.
    assert.equal((await libB.importBundle(bundle)).skipped, 2);
    // Un fichier différent de même nom est conservé, sauf demande de remplacement.
    await fs.writeFile(path.join(libB.root, 'dossier-1', 'un.png'), Buffer.concat([PNG, Buffer.from('autre')]));
    assert.equal((await libB.importBundle(bundle)).kept, 1);
    assert.equal((await libB.importBundle(bundle, { overwrite: true })).replaced, 1);
    // Entrées invalides ignorées, mauvais fichier refusé.
    const bad = { ...bundle, icons: [{ folder: '../x', file: 'a.png', ...png() }, { folder: 'ok', file: 'a.png', mime: 'image/png', data: 'AAAA' }] };
    assert.equal((await libB.importBundle(bad)).invalid, 2);
    await assert.rejects(libB.importBundle({ app: 'autre', icons: [] }), /export d’icônes/);
  } finally {
    await fs.rm(a, { recursive: true, force: true });
    await fs.rm(b, { recursive: true, force: true });
  }
});

test('serveur : icônes de l’utilisateur (envoi, affichage sécurisé, export, import) et anciens chemins servis', async () => {
  const dataDir = await tmp('deck-icons-api-');
  const deck = await startDeckServer({ port: 0, host: '127.0.0.1', dataDir, dryRun: true, discovery: false, msfs: false, simhub: false, log: quiet });
  const base = `http://127.0.0.1:${deck.port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const up = await (await post('/api/icons', { folder: 'Mes icônes', name: 'Logo', ...png() })).json();
    assert.equal(up.icon.path, '/user-icons/mes-icones/logo.png');
    const img = await fetch(base + up.icon.path);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    assert.match(img.headers.get('content-security-policy'), /sandbox/);
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
    assert.equal((await fetch(`${base}/user-icons/..%2F..%2Fconfig.json`)).status, 404);
    assert.equal((await (await fetch(`${base}/api/icons`)).json()).icons.length, 1);
    assert.equal((await post('/api/icons', { folder: 'x', name: 'y', mime: 'image/png', data: 'AAAA' })).status, 400);
    const bundle = await (await fetch(`${base}/api/icons/export`)).json();
    assert.equal(bundle.icons.length, 1);
    assert.equal((await (await post('/api/icons/delete', { path: up.icon.path })).json()).ok, true);
    assert.equal((await fetch(base + up.icon.path)).status, 404);
    const imp = await (await post('/api/icons/import', { bundle })).json();
    assert.equal(imp.result.added, 1);
    assert.equal((await fetch(base + up.icon.path)).status, 200);
    // Anciens chemins d'icônes intégrées : toujours servis (anciens Decks, configurations non migrées).
    assert.equal((await fetch(`${base}/public/icons/avia/gear-down.svg`)).status, 200);
    assert.equal((await fetch(`${base}/public/icons/faces/rafale-5k-off.svg`)).status, 200);
    assert.equal((await fetch(`${base}/public/icons/aviation/feux/beacon.svg`)).status, 200);
  } finally {
    await deck.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('icônes intégrées : visuels des interrupteurs à positions présents', async () => {
  const { SWITCH_FACE_GROUPS, switchFaces, isFacePath } = await import('../shared/icons.js');
  assert.deepEqual(SWITCH_FACE_GROUPS.map((g) => g.positions.length), [3, 3, 3, 8]);
  for (const g of SWITCH_FACE_GROUPS) {
    for (const p of switchFaces(g)) {
      assert.ok(isFacePath(p), p);
      assert.ok(existsSync(path.join(ROOT, p)), p);
    }
  }
});

test('icônes du point de vue : vues et siège, chaque visuel listé existe et le dossier ne contient rien d’autre', async () => {
  const { VIEW_FACE_GROUPS, VIEW_FACES, viewFaces, isFacePath } = await import('../shared/icons.js');
  const root = path.join(ROOT, 'public/icons/touches-completes/point-de-vue');
  assert.deepEqual((await fs.readdir(root)).sort(), VIEW_FACE_GROUPS.map((g) => g.folder).sort());
  for (const g of VIEW_FACE_GROUPS) {
    assert.deepEqual((await fs.readdir(path.join(root, g.folder))).sort(), g.files.map(([n]) => `${n}.svg`).sort(), g.folder);
    for (const f of viewFaces(g)) {
      assert.ok(isFacePath(f) && f.startsWith(VIEW_FACES), f);
      const svg = await fs.readFile(path.join(ROOT, f), 'utf8');
      assert.match(svg, /^<svg[^>]+viewBox="0 0 144 144"/);
      assert.doesNotMatch(svg, /<script|onload=|href=/i);
    }
  }
  assert.equal(VIEW_FACE_GROUPS.find((g) => g.folder === 'siege-pilote').files.length, 6);
  assert.equal(VIEW_FACE_GROUPS.find((g) => g.folder === 'vues').files.length, 2);
});
