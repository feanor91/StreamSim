// Journal de fonctionnement : console + fichier (utile pour comprendre un problème
// survenu pendant un vol). Le fichier est limité en taille : au-delà de 2 Mo, il est
// renommé en « .1 » (l'ancien « .1 » est écrasé) et un nouveau fichier commence.
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';

const MAX_BYTES = 2 * 1024 * 1024;

export function createLogger(file, { console: out = console } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {}

  const write = (level, args) => {
    const text = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : inspect(a))).join(' ');
    const line = `${localStamp()} ${level.padEnd(5)} ${text}\n`;
    try {
      if (size + line.length > MAX_BYTES) {
        fs.renameSync(file, `${file}.1`);
        size = 0;
      }
      fs.appendFileSync(file, line);
      size += Buffer.byteLength(line);
    } catch {
      // Journal indisponible (disque plein…) : on continue sans.
    }
  };

  return {
    file,
    log: (...a) => (out.log(...a), write('INFO', a)),
    warn: (...a) => (out.warn(...a), write('WARN', a)),
    error: (...a) => (out.error(...a), write('ERROR', a)),
  };
}

/** Heure locale du PC avec son décalage (ex. « 2026-09-27 14:10:35.942 +02:00 »). */
export function localStamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const tz = `${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)} ${tz}`;
}

/**
 * Filet de sécurité : une erreur imprévue (bibliothèque SimConnect, promesse oubliée…)
 * est enregistrée au lieu d'arrêter le serveur, pour que la tablette reste utilisable.
 */
export function keepAlive(log) {
  process.on('uncaughtException', (e) => log.error('Erreur inattendue (le serveur continue) :', e));
  process.on('unhandledRejection', (e) => log.error('Promesse rejetée non traitée (le serveur continue) :', e));
}
