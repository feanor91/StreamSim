// Organisation des icônes intégrées à l'application (dossier public/icons/) :
//
//   public/icons/aviation/<groupe>/<nom>.svg          pictogrammes blancs (fond transparent), colorés par la touche
//   public/icons/touches-completes/<avion>/<pièce>/<état>.svg   visuels de touche entiers (fond, texte, voyant)
//
// et des icônes de l'utilisateur, hors de l'application : <données>/icons/<dossier>/<nom>.<ext>,
// servies à /user-icons/<dossier>/<nom>.<ext> (exportables et importables, voir server/icons.js).

export const AVIATION_ICON_GROUPS = [
  { folder: 'train-et-commandes-de-vol', label: 'Train et commandes de vol', icons: ['gear-down', 'gear-up', 'parking-brake', 'flaps-down', 'flaps-up', 'spoilers', 'trim-up', 'trim-down'] },
  { folder: 'feux', label: 'Feux', icons: ['landing-light', 'taxi-light', 'nav-lights', 'beacon', 'strobe'] },
  { folder: 'pilote-automatique', label: 'Pilote automatique', icons: ['ap', 'fd', 'hdg', 'alt', 'vs', 'nav', 'apr', 'athr', 'knob-left', 'knob-right'] },
  { folder: 'systemes', label: 'Systèmes', icons: ['battery', 'avionics', 'pitot-heat', 'seatbelt', 'engine', 'fuel'] },
  { folder: 'radios-et-divers', label: 'Radios et divers', icons: ['radio', 'altimeter', 'pause', 'pushback', 'door', 'camera', 'plane'] },
];

const FOLDER_OF = Object.fromEntries(AVIATION_ICON_GROUPS.flatMap((g) => g.icons.map((n) => [n, g.folder])));

/** Nom des icônes aviation, à plat (pour les listes de choix). */
export const AVIATION_ICONS = AVIATION_ICON_GROUPS.flatMap((g) => g.icons);

/** Chemin d'une icône aviation à partir de son nom (« gear-down »). */
export const aviationIcon = (name) => {
  if (!FOLDER_OF[name]) throw new Error(`Icône aviation inconnue : ${name}`);
  return `/public/icons/aviation/${FOLDER_OF[name]}/${name}.svg`;
};

/** Dossier des visuels de touche entiers du Rafale. */
export const RAFALE_FACES = '/public/icons/touches-completes/rafale';

/** Visuels d'interrupteurs à plusieurs positions (utilisables avec un visuel par position). */
export const SWITCH_FACES = '/public/icons/touches-completes/interrupteurs';
export const SWITCH_FACE_GROUPS = [
  { folder: 'levier-de-cote', label: 'Levier de côté (3 positions)', positions: ['haut', 'milieu', 'bas'] },
  { folder: 'bascule-de-face', label: 'Bascule de face (3 positions)', positions: ['haut', 'milieu', 'bas'] },
  { folder: 'glissiere', label: 'Glissière (3 positions)', positions: ['haut', 'milieu', 'bas'] },
  { folder: 'selecteur-8-positions', label: 'Sélecteur rotatif (8 positions)', positions: ['1', '2', '3', '4', '5', '6', '7', '8'] },
];
/** Chemins des visuels d'un groupe, dans l'ordre des positions. */
export const switchFaces = (g) => g.positions.map((n) => `${SWITCH_FACES}/${g.folder}/${n}.svg`);

/** Visuels du point de vue : vues cockpit / extérieure et déplacements du siège (haut, bas, gauche…). */
export const VIEW_FACES = '/public/icons/touches-completes/point-de-vue';
const SEAT_MOVES = [['haut', 'Haut'], ['bas', 'Bas'], ['gauche', 'Gauche'], ['droite', 'Droite'], ['avant', 'Avant'], ['arriere', 'Arrière']];
export const VIEW_FACE_GROUPS = [
  { folder: 'vues', label: 'Vues : cockpit et extérieure', files: [['cockpit', 'Cockpit'], ['exterieure', 'Extérieure']] },
  { folder: 'siege-croix', label: 'Siège : croix de flèches', files: SEAT_MOVES },
  { folder: 'siege-pilote', label: 'Siège : pilote', files: SEAT_MOVES },
  { folder: 'siege-fauteuil', label: 'Siège : fauteuil', files: SEAT_MOVES },
];
/** Chemins des visuels d'un groupe, dans l'ordre. */
export const viewFaces = (g) => g.files.map(([n]) => `${VIEW_FACES}/${g.folder}/${n}.svg`);

/** Visuel entier d'une touche : /public/icons/touches-completes/... (affiché en plein cadre). */
export const isFacePath = (icon) => typeof icon === 'string' && /^\/public\/icons\/touches-completes\/[\w/-]+\.svg$/.test(icon);

/** Icône de la bibliothèque de l'utilisateur (image en couleurs, servie par le serveur). */
export const isUserIconPath = (icon) => typeof icon === 'string' && /^\/user-icons\/[^\s"'<>\\]+$/.test(icon);

/** Icône fournie par l'application (pictogramme ou visuel entier). */
export const isBuiltinIconPath = (icon) => typeof icon === 'string' && /^\/public\/icons\/[\w/-]+\.svg$/.test(icon);

// ---------------------------------------------------------------------------
// Anciens chemins (versions ≤ 0.11) : « avia/ » et « faces/ » à plat. Les configurations déjà
// enregistrées ou exportées les contiennent : elles sont converties au chargement.
// ---------------------------------------------------------------------------
const LEGACY = new Map();
for (const n of AVIATION_ICONS) LEGACY.set(`/public/icons/avia/${n}.svg`, aviationIcon(n));
for (const p of ['off', 'test', 'stby', 'norm', 'l', 'r']) LEGACY.set(`/public/icons/faces/rafale-5k-${p}.svg`, `${RAFALE_FACES}/selecteur-5k/${p}.svg`);
for (const n of ['apu', 'ecs']) for (const st of ['off', 'on']) LEGACY.set(`/public/icons/faces/rafale-${n}-${st}.svg`, `${RAFALE_FACES}/${n}/${st}.svg`);
for (const [side, dir] of [['g', 'levier-aec-gauche'], ['d', 'levier-aec-droit']]) {
  for (const p of ['stop', 'idle', 'norm', 'fix']) LEGACY.set(`/public/icons/faces/rafale-aec${side}-${p}.svg`, `${RAFALE_FACES}/${dir}/${p}.svg`);
}

/** Nouveau chemin d'une icône (inchangé si le chemin est déjà à jour ou inconnu). */
export const currentIconPath = (p) => LEGACY.get(p) ?? p;

/** Convertit, sur place, tous les anciens chemins d'icônes d'une configuration. Retourne le nombre modifié. */
export function migrateIconPaths(node) {
  let n = 0;
  const walk = (o) => {
    if (Array.isArray(o)) {
      o.forEach((v, i) => {
        if (typeof v === 'string' && LEGACY.has(v)) {
          o[i] = LEGACY.get(v);
          n++;
        } else walk(v);
      });
    } else if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string' && LEGACY.has(v)) {
          o[k] = LEGACY.get(v);
          n++;
        } else walk(v);
      }
    }
  };
  walk(node);
  return n;
}
