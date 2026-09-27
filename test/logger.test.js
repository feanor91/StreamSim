import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createLogger } from '../server/logger.js';

test('journal : lignes horodatées dans un fichier', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deck-log-'));
  const silent = { log() {}, warn() {}, error() {} };
  const log = createLogger(path.join(dir, 'logs', 'streamsim.log'), { console: silent });
  log.log('démarrage');
  log.error('échec', new Error('boum'));
  const text = await fs.readFile(log.file, 'utf8');
  assert.match(text, /INFO  démarrage/);
  assert.match(text, /ERROR échec Error: boum/);
  await fs.rm(dir, { recursive: true, force: true });
});

test('journal : heure locale avec le décalage horaire', async () => {
  const { localStamp } = await import('../server/logger.js');
  const d = new Date(2026, 8, 27, 14, 10, 35, 942);
  const off = -d.getTimezoneOffset();
  const tz = `${off >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
  assert.equal(localStamp(d), `2026-09-27 14:10:35.942 ${tz}`);
  assert.equal(TZ_CHECK(localStamp(d)), true);
});
const TZ_CHECK = (s) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2}$/.test(s);
