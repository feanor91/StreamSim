// Bibliothèque d'icônes de l'utilisateur (images hors de l'application, rangées par dossiers sur le PC) :
// envoi, choix, suppression, export et import. Les icônes intégrées à l'application sont dans shared/icons.js.
import { h, icon, toast, openModal, confirmModal } from './dom.js';
import { api } from './api.js';

export const library = { icons: [], folders: [], loaded: false };

export async function refreshIcons() {
  const r = await api.icons();
  library.icons = r.icons;
  library.folders = r.folders;
  library.loaded = true;
  return library;
}

const toBase64 = (buf) => {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Image → { mime, data } prête à l'envoi : les SVG restent tels quels, les autres formats sont réduits (256 px) en PNG. */
export async function prepareImage(file, size = 256) {
  if (file.type === 'image/svg+xml') return { mime: 'image/svg+xml', data: toBase64(await file.arrayBuffer()) };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image'));
      el.src = url;
    });
    const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return { mime: 'image/png', data: canvas.toDataURL('image/png').split(',')[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Envoie une image dans la bibliothèque (dossier « divers » par défaut) et retourne son chemin. */
export async function uploadIconFile(file, folder = 'divers') {
  if (!file?.type?.startsWith('image/')) throw new Error('Ce fichier n’est pas une image.');
  const name = file.name.replace(/\.[^.]+$/, '');
  const { icon: saved } = await api.uploadIcon({ folder, name, ...(await prepareImage(file)) });
  await refreshIcons();
  return saved.path;
}

const download = (data, name) => {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

export async function exportIcons() {
  const bundle = await api.exportIcons();
  if (!bundle.icons.length) return toast('Aucune icône dans la bibliothèque : rien à exporter.', 'err');
  download(bundle, `streamsim-icones-${new Date().toISOString().slice(0, 10)}.json`);
  toast(`${bundle.icons.length} icône${bundle.icons.length > 1 ? 's' : ''} exportée${bundle.icons.length > 1 ? 's' : ''} dans le dossier Téléchargements`, 'ok');
}

/** Importe un fichier d'export ; propose de remplacer les icônes de même nom dont le contenu diffère. */
export async function importIcons(file) {
  let bundle;
  try {
    bundle = JSON.parse(await file.text());
  } catch {
    return toast('Ce fichier n’est pas un export d’icônes StreamSim.', 'err');
  }
  let res = await api.importIcons(bundle);
  let { result } = res;
  if (result.kept) {
    const ok = await confirmModal({
      title: 'Remplacer des icônes ?',
      message: `${result.kept} icône${result.kept > 1 ? 's portent' : ' porte'} le même nom qu’une icône déjà présente, avec un contenu différent. Les remplacer par celles du fichier ?`,
      confirmLabel: 'Remplacer',
    });
    if (ok) {
      res = await api.importIcons(bundle, true);
      result = { ...result, replaced: res.result.replaced, kept: 0 };
    }
  }
  library.icons = res.icons;
  library.folders = res.folders;
  library.loaded = true;
  const parts = [`${result.added} ajoutée${result.added > 1 ? 's' : ''}`];
  if (result.replaced) parts.push(`${result.replaced} remplacée${result.replaced > 1 ? 's' : ''}`);
  if (result.skipped) parts.push(`${result.skipped} déjà présente${result.skipped > 1 ? 's' : ''}`);
  if (result.kept) parts.push(`${result.kept} conservée${result.kept > 1 ? 's' : ''} (même nom)`);
  if (result.invalid) parts.push(`${result.invalid} ignorée${result.invalid > 1 ? 's' : ''} (invalide)`);
  toast(`Icônes importées : ${parts.join(', ')}.`, 'ok', 5000);
}

/** Sélecteur d'un fichier d'export puis import. */
export function pickAndImportIcons(after = () => {}) {
  const input = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  input.addEventListener('change', async () => {
    if (!input.files[0]) return;
    try {
      await importIcons(input.files[0]);
      after();
    } catch (e) {
      toast(e.message, 'err', 5000);
    }
  });
  document.body.append(input);
  input.click();
  setTimeout(() => input.remove(), 60_000);
}

/**
 * Fenêtre de gestion de la bibliothèque : icônes par dossier, envoi (bouton ou glisser-déposer), suppression,
 * export / import. Avec `onPick`, un clic sur une icône la choisit et ferme la fenêtre.
 * `embeddedCount` / `onMigrate` : images intégrées aux touches, à ranger dans la bibliothèque.
 */
export function openIconLibrary({ onPick = null, current = null, embeddedCount = 0, onMigrate = null } = {}) {
  return openModal((modal, close) => {
    modal.classList.add('icon-lib');
    const body = h('div', { class: 'icon-lib-body' });
    const folderInput = h('input', { list: 'iconFolders', value: library.folders[0] ?? 'divers', placeholder: 'Dossier (ex. mon-avion)', maxlength: 48 });
    const datalist = h('datalist', { id: 'iconFolders' });
    const filter = h('select', { onchange: paint });
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });

    function paint() {
      datalist.replaceChildren(...library.folders.map((f) => h('option', { value: f })));
      const chosen = filter.value;
      filter.replaceChildren(
        h('option', { value: '' }, `Tous les dossiers (${library.icons.length})`),
        ...library.folders.map((f) => h('option', { value: f, selected: f === chosen }, `${f} (${library.icons.filter((i) => i.folder === f).length})`)),
      );
      filter.value = library.folders.includes(chosen) ? chosen : '';
      const shown = library.folders.filter((f) => !filter.value || f === filter.value);
      body.replaceChildren(
        ...(shown.length
          ? shown.map((f) =>
              h(
                'section',
                { class: 'icon-lib-folder' },
                h('h4', {}, f),
                h(
                  'div',
                  { class: 'icon-lib-grid' },
                  ...library.icons.filter((i) => i.folder === f).map((i) =>
                    h(
                      'div',
                      { class: `icon-tile${i.path === current ? ' on' : ''}`, title: i.path, onclick: () => onPick && close(i.path) },
                      h('img', { src: i.path, alt: i.name, draggable: 'false' }),
                      h('span', { class: 'name' }, i.name),
                      h('button', {
                        class: 'del',
                        title: 'Supprimer cette icône',
                        onclick: async (e) => {
                          e.stopPropagation();
                          if (!(await confirmModal({ title: `Supprimer « ${i.name} » ?`, message: 'Les touches qui utilisent cette icône n’auront plus d’image.', confirmLabel: 'Supprimer', danger: true }))) return;
                          try {
                            await api.deleteIcon(i.path);
                            await refreshIcons();
                            paint();
                          } catch (err) {
                            toast(err.message, 'err');
                          }
                        },
                      }, icon('x')),
                    ),
                  ),
                ),
              ),
            )
          : [h('p', { class: 'icon-lib-empty' }, 'Aucune icône pour l’instant. Ajoutez des images ci-dessus, ou importez un fichier d’export.')]),
      );
    }

    async function upload(files) {
      const folder = folderInput.value.trim() || 'divers';
      let n = 0;
      for (const f of files) {
        try {
          await uploadIconFile(f, folder);
          n++;
        } catch (e) {
          toast(`${f.name} : ${e.message}`, 'err', 5000);
        }
      }
      if (n) toast(`${n} icône${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''}`, 'ok');
      paint();
    }
    fileInput.addEventListener('change', () => upload([...fileInput.files]));
    const drop = h(
      'div',
      { class: 'image-drop', onclick: () => fileInput.click() },
      h('span', { class: 'ph' }, icon('image')),
      h('span', {}, 'Cliquez ou déposez des images (PNG, JPG, WebP, GIF, SVG)'),
    );
    drop.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      upload([...e.dataTransfer.files]);
    });

    modal.append(
      h('div', { class: 'explorer-head' }, h('h3', {}, 'Bibliothèque d’icônes'), h('button', { class: 'btn small ghost icon-only', title: 'Fermer', onclick: () => close(null) }, icon('x'))),
      h('p', { class: 'explorer-help' }, 'Vos images, rangées par dossiers sur le PC (hors de l’application). Elles peuvent servir à plusieurs touches et s’exportent / s’importent comme la configuration.'),
      h('div', { class: 'row' }, h('label', { class: 'field', style: { flex: 1 } }, h('span', {}, 'Ranger les nouvelles images dans le dossier'), folderInput, datalist), h('label', { class: 'field', style: { flex: 1 } }, h('span', {}, 'Afficher'), filter)),
      drop,
      fileInput,
      body,
      h(
        'div',
        { class: 'modal-actions icon-lib-actions' },
        embeddedCount && onMigrate
          ? h('button', {
              class: 'btn',
              title: 'Déplace les images collées dans les touches vers la bibliothèque : la configuration devient plus légère et ces images s’exportent avec les icônes.',
              onclick: async (e) => {
                e.currentTarget.disabled = true;
                try {
                  await onMigrate();
                  close(null);
                } catch (err) {
                  toast(err.message, 'err', 5000);
                  e.currentTarget.disabled = false;
                }
              },
            }, `Ranger les ${embeddedCount} image${embeddedCount > 1 ? 's' : ''} intégrée${embeddedCount > 1 ? 's' : ''} aux touches`)
          : null,
        h('button', { class: 'btn', onclick: () => exportIcons().catch((e) => toast(e.message, 'err')) }, icon('download'), 'Exporter'),
        h('button', { class: 'btn', onclick: () => pickAndImportIcons(paint) }, icon('upload'), 'Importer'),
        h('button', { class: 'btn primary', onclick: () => close(null) }, 'Fermer'),
      ),
    );
    paint();
    if (!library.loaded) refreshIcons().then(paint).catch((e) => toast(e.message, 'err'));
  });
}
