import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { startDeckServer } from '../server/app.js';
import { nextPosition, positionOf, switchCount } from '../shared/controls.js';
import { SWITCH_FACE_GROUPS } from '../shared/icons.js';

const quiet = { log() {}, warn() {}, error() {} };

test('interrupteur : position suivante en boucle et en aller-retour', () => {
  assert.deepEqual([0, 1, 2, 0].map((c) => nextPosition(3, 'cycle', c).pos), [1, 2, 0, 1]);
  let cur = { pos: 0, dir: 1 };
  const seen = [];
  for (let i = 0; i < 6; i++) {
    cur = nextPosition(3, 'bounce', cur.pos, cur.dir);
    seen.push(cur.pos);
  }
  assert.deepEqual(seen, [1, 2, 1, 0, 1, 2]);
  assert.equal(nextPosition(8, 'cycle', 7).pos, 0);
  assert.equal(switchCount({ count: 99 }), 12);
  assert.equal(switchCount({ count: 1 }), 2);
  assert.equal(switchCount({}), 3);
});

test('interrupteur : position lue dans le simulateur', () => {
  assert.equal(positionOf(2, undefined, 3), 2);
  assert.equal(positionOf(7.4, undefined, 3), 2, 'bornée à la dernière position');
  assert.equal(positionOf(60, [0, 50, 100], 3), 1, 'valeur la plus proche');
  assert.equal(positionOf('x', undefined, 3), 0);
  for (const g of SWITCH_FACE_GROUPS) assert.ok(g.positions.length >= 3);
});

test('serveur : un appui envoie la position suivante et la mémorise', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-switch-'));
  const deck = await startDeckServer({ port: 0, host: '127.0.0.1', dataDir, dryRun: true, discovery: false, msfs: false, simhub: false, updateCheck: false, log: quiet });
  const url = `http://127.0.0.1:${deck.port}`;
  const json = (p, o) => fetch(url + p, o).then((r) => r.json());
  try {
    const { config } = await json('/api/config');
    const pg = config.profiles[0].pages[0];
    const delay = (ms) => ({ type: 'delay', ms });
    pg.keys[3] = { title: 'Sélecteur', action: { type: 'switch', count: 3, mode: 'bounce', positions: [delay(1), delay(2), delay(3)] } };
    pg.keys[4] = { title: 'Vide', action: { type: 'switch', count: 3, mode: 'cycle', positions: [delay(1), null, delay(3)] } };
    await fetch(`${url}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) });
    const sk = (i) => `default/${pg.id}/${i}`;
    const press = (index) =>
      fetch(`${url}/api/press`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: 'default', pageId: pg.id, index }) });

    assert.equal((await json('/api/config')).values[sk(3)], 0, 'position initiale');
    const seen = [];
    for (let i = 0; i < 5; i++) {
      const res = await press(3);
      assert.equal(res.status, 200);
      seen.push((await res.json()).position);
    }
    assert.deepEqual(seen, [1, 2, 1, 0, 1]);
    assert.equal((await json('/api/config')).values[sk(3)], 1, 'position mémorisée');
    assert.equal(Object.keys((await json('/api/config')).states).length, 0, 'ne pollue pas les états de bascule');

    // Position sans action : refusée avec un message clair.
    const bad = await press(4);
    assert.equal(bad.status, 422);
    assert.match((await bad.json()).error, /position 2/);
  } finally {
    await deck.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
