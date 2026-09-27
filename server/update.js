// Recherche de mise à jour dans les versions publiées sur GitHub.
//
// Le serveur autonome (npm start) signale seulement qu'une version plus récente
// existe, avec le lien de téléchargement. L'application PC fournit son propre
// gestionnaire (electron-updater) qui télécharge et installe la mise à jour :
// il expose la même interface { status, check, install, onChange }.
import fs from 'node:fs/promises';
import path from 'node:path';
import { compareVersions, RELEASES_REPO, RELEASES_URL } from '../shared/version.js';

const CHECK_EVERY = 6 * 3600_000;

export function createReleaseChecker({ current, log = console, fetchImpl = globalThis.fetch, auto = true } = {}) {
  const listeners = new Set();
  let state = { current, state: 'idle', latest: null, url: RELEASES_URL, notes: '', error: null, canInstall: false, progress: null };
  let timer = null;
  let first = null;

  const set = (patch) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  };

  async function check() {
    set({ state: 'checking', error: null });
    try {
      const res = await fetchImpl(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'StreamSim' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(res.status === 404 ? 'aucune version publiée trouvée' : `GitHub a répondu ${res.status}`);
      const rel = await res.json();
      const latest = String(rel.tag_name ?? '').replace(/^v/i, '');
      const newer = compareVersions(latest, current) > 0;
      set({ state: newer ? 'available' : 'current', latest, url: rel.html_url ?? RELEASES_URL, notes: rel.body ?? '' });
      if (newer) log.log?.(`Mise à jour disponible : v${latest} (installée : v${current}).`);
    } catch (e) {
      set({ state: 'error', error: `Recherche de mise à jour impossible : ${e.message}` });
    }
    return state;
  }

  if (auto) {
    first = setTimeout(check, 5_000);
    first.unref?.();
    timer = setInterval(check, CHECK_EVERY);
    timer.unref?.();
  }

  return {
    status: () => state,
    check,
    install() {
      throw Object.assign(new Error('Installation automatique disponible uniquement dans l’application PC.'), { status: 400 });
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close() {
      clearTimeout(first);
      clearInterval(timer);
      listeners.clear();
    },
  };
}

/**
 * APK Android de la dernière version publiée, téléchargé une fois par le PC puis servi
 * à la tablette par le réseau local. Utile quand la tablette ne peut pas le télécharger
 * elle-même (Android 7 et certaines connexions sécurisées de GitHub).
 */
export function createApkRelay({ dir, fetchImpl = globalThis.fetch, log = console } = {}) {
  let pending = null;

  async function fetchLatest() {
    const res = await fetchImpl(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'StreamSim' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
    const rel = await res.json();
    const asset = (rel.assets ?? []).find((a) => /\.apk$/i.test(a.name ?? ''));
    if (!asset) throw new Error('aucune application Android dans la dernière version');
    const name = String(asset.name).replace(/[^\w.-]/g, '_');
    const file = path.join(dir, name);
    try {
      const st = await fs.stat(file);
      if (!asset.size || st.size === asset.size) return { file, name, size: st.size };
    } catch {}
    log.log?.(`Téléchargement de ${name} pour la tablette…`);
    const dl = await fetchImpl(asset.browser_download_url, { headers: { 'User-Agent': 'StreamSim' }, signal: AbortSignal.timeout(120_000) });
    if (!dl.ok) throw new Error(`téléchargement refusé (${dl.status})`);
    const data = Buffer.from(await dl.arrayBuffer());
    await fs.mkdir(dir, { recursive: true });
    // Anciennes versions supprimées ; écriture puis renommage pour ne jamais servir un fichier incomplet.
    for (const old of await fs.readdir(dir).catch(() => [])) if (/\.apk$/i.test(old) && old !== name) await fs.rm(path.join(dir, old), { force: true });
    await fs.writeFile(`${file}.tmp`, data);
    await fs.rename(`${file}.tmp`, file);
    return { file, name, size: data.length };
  }

  return {
    /** { file, name, size } de l'APK à jour (téléchargé si besoin, une seule fois à la fois). */
    latest() {
      pending ??= fetchLatest().finally(() => (pending = null));
      return pending;
    },
  };
}
