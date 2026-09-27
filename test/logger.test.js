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
