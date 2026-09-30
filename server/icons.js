// Bibliothèque d'icônes de l'utilisateur, hors de l'application :
//
//   <données>/icons/<dossier>/<nom>.<ext>       (png, jpg, webp, gif ou svg)
//   servies à /user-icons/<dossier>/<nom>.<ext>
//
// Une touche y fait référence par ce chemin. Les icônes s'exportent et s'importent comme les
// configurations (fichier JSON : voir exportBundle / importBundle), ce qui permet de les transférer
// vers un autre PC avec la configuration.
import fs from 'node:fs/promises';
import path from 'node:path';

export const MAX_ICON_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ICONS = 2000;
export const BUNDLE_APP = 'streamsim-icons';

const EXT_OF_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
export const MIME_OF_EXT = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
const REL_RE = /^([a-z0-9][a-z0-9-]{0,47})\/([a-z0-9][a-z0-9-]{0,63})\.(png|jpg|webp|gif|svg)$/;

const err = (message, status = 400) => Object.assign(new Error(message), { status });

/** « Mes Icônes 2 » → « mes-icones-2 » : nom de dossier ou de fichier sûr. */
export function slug(text, fallback = 'divers') {
  const s = String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || fallback;
}

// Vérifie que le contenu correspond bien au type annoncé (et pas, par exemple, à une page web).
function looksLike(mime, buf) {
  const head = buf.subarray(0, 16);
  switch (mime) {
    case 'image/png':
      return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return head[0] === 0xff && head[1] === 0xd8;
    case 'image/gif':
      return head.subarray(0, 3).toString('latin1') === 'GIF';
    case 'image/webp':
      return head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
    case 'image/svg+xml':
      return /<svg[\s>]/i.test(buf.subarray(0, 2048).toString('utf8'));
    default:
      return false;
  }
}

export function createIconLibrary(dataDir) {
  const root = path.join(dataDir, 'icons');

  const fileOf = (rel) => {
    if (!REL_RE.test(String(rel))) throw err('Icône introuvable.', 404);
    return path.join(root, rel);
  };

  async function list() {
    const icons = [];
    const folders = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const d of folders) {
      if (!d.isDirectory()) continue;
      const files = await fs.readdir(path.join(root, d.name), { withFileTypes: true }).catch(() => []);
      for (const f of files) {
        const rel = `${d.name}/${f.name}`;
        if (!f.isFile() || !REL_RE.test(rel)) continue;
        const st = await fs.stat(path.join(root, rel)).catch(() => null);
        if (st) icons.push({ path: `/user-icons/${rel}`, folder: d.name, name: f.name.replace(/\.[^.]+$/, ''), size: st.size, mtime: st.mtimeMs });
      }
    }
    icons.sort((a, b) => (a.folder + a.name < b.folder + b.name ? -1 : 1));
    return { icons, folders: [...new Set(icons.map((i) => i.folder))] };
  }

  /** Lit une icône pour la servir. */
  async function read(rel) {
    const file = fileOf(rel);
    try {
      return { data: await fs.readFile(file), mime: MIME_OF_EXT[path.extname(file).slice(1)] };
    } catch {
      throw err('Icône introuvable.', 404);
    }
  }

  function decode({ mime, data }) {
    const ext = EXT_OF_MIME[mime];
    if (!ext) throw err('Format d’image non pris en charge (PNG, JPG, WebP, GIF ou SVG).');
    if (typeof data !== 'string' || !data) throw err('Image vide.');
    const buf = Buffer.from(data, 'base64');
    if (!buf.length) throw err('Image vide.');
    if (buf.length > MAX_ICON_BYTES) throw err(`Image trop lourde (${Math.round(MAX_ICON_BYTES / 1024 / 1024)} Mo au maximum).`, 413);
    if (!looksLike(mime, buf)) throw err('Le contenu du fichier ne correspond pas à une image.');
    return { ext, buf };
  }

  /** Enregistre une icône. Un nom déjà pris avec un autre contenu reçoit un numéro (« nom-2 »). */
  async function save({ folder, name, mime, data }) {
    const { ext, buf } = decode({ mime, data });
    const dir = slug(folder, 'divers');
    const base = slug(name, 'icone');
    await fs.mkdir(path.join(root, dir), { recursive: true });
    for (let n = 1; n < 1000; n++) {
      const file = `${n === 1 ? base : `${base}-${n}`}.${ext}`.slice(-68);
      const full = path.join(root, dir, file);
      const existing = await fs.readFile(full).catch(() => null);
      if (existing && !existing.equals(buf)) continue;
      if (!existing) await fs.writeFile(full, buf);
      return { path: `/user-icons/${dir}/${file}`, folder: dir, name: file.replace(/\.[^.]+$/, ''), size: buf.length, existed: !!existing };
    }
    throw err('Trop d’icônes portent ce nom.');
  }

  async function remove(rel) {
    const file = fileOf(rel);
    await fs.unlink(file).catch((e) => {
      if (e.code === 'ENOENT') throw err('Icône introuvable.', 404);
      throw e;
    });
    // Dossier laissé vide : supprimé aussi.
    await fs.rmdir(path.dirname(file)).catch(() => {});
  }

  /** Toutes les icônes dans un seul fichier JSON (comme l'export d'une configuration). */
  async function exportBundle(version = '') {
    const { icons } = await list();
    const out = [];
    for (const i of icons) {
      const rel = i.path.replace('/user-icons/', '');
      const { data, mime } = await read(rel);
      out.push({ folder: i.folder, file: rel.split('/')[1], mime, data: data.toString('base64') });
    }
    return { app: BUNDLE_APP, version: 1, appVersion: version, exportedAt: new Date().toISOString(), icons: out };
  }

  /**
   * Importe un fichier d'export. Les icônes déjà présentes et identiques sont ignorées ; celles qui ont le
   * même nom mais un autre contenu sont conservées telles quelles, sauf avec `overwrite`.
   */
  async function importBundle(bundle, { overwrite = false } = {}) {
    if (!bundle || bundle.app !== BUNDLE_APP || !Array.isArray(bundle.icons)) throw err('Ce fichier n’est pas un export d’icônes StreamSim.', 422);
    if (bundle.icons.length > MAX_IMPORT_ICONS) throw err(`Trop d’icônes (${MAX_IMPORT_ICONS} au maximum par import).`, 413);
    const result = { added: 0, replaced: 0, skipped: 0, kept: 0, invalid: 0 };
    for (const item of bundle.icons) {
      const rel = `${item?.folder}/${item?.file}`;
      if (!REL_RE.test(rel)) {
        result.invalid++;
        continue;
      }
      let decoded;
      try {
        decoded = decode(item);
      } catch {
        result.invalid++;
        continue;
      }
      if (EXT_OF_MIME[item.mime] !== path.extname(item.file).slice(1)) {
        result.invalid++;
        continue;
      }
      const full = path.join(root, rel);
      const existing = await fs.readFile(full).catch(() => null);
      if (existing?.equals(decoded.buf)) {
        result.skipped++;
        continue;
      }
      if (existing && !overwrite) {
        result.kept++;
        continue;
      }
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, decoded.buf);
      existing ? result.replaced++ : result.added++;
    }
    return result;
  }

  return { list, read, save, remove, exportBundle, importBundle, root };
}
