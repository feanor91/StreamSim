# Icônes intégrées à StreamSim

```
public/icons/
├── aviation/                    Pictogrammes blancs sur fond transparent (colorés par la touche)
│   ├── train-et-commandes-de-vol/   train, volets, aérofreins, compensateur, frein de parc
│   ├── feux/                        atterrissage, roulage, navigation, anticollision, strobe
│   ├── pilote-automatique/          AP, FD, HDG, ALT, V/S, NAV, APR, A/THR, molettes
│   ├── systemes/                    batterie, avionique, dégivrage, ceintures, moteur, carburant
│   └── radios-et-divers/            radio, altimètre, pause, pushback, porte, caméra, avion
└── touches-completes/           Visuels de touche entiers (fond, texte et voyant compris)
    ├── interrupteurs/               visuels d'interrupteurs à positions
    │   ├── levier-de-cote/ bascule-de-face/ glissiere/   haut, milieu, bas
    │   └── selecteur-8-positions/   1 à 8
    ├── point-de-vue/                vues et déplacements du siège (choix d'icône → Image)
    │   ├── vues/                    cockpit, exterieure
    │   └── siege-croix/ siege-pilote/ siege-fauteuil/   haut, bas, gauche, droite, avant, arriere
    └── rafale/
        ├── selecteur-5k/            off, test, stby, norm, l, r
        ├── apu/  ecs/               off, on
        ├── levier-aec-gauche/       stop, idle, norm, fix
        └── levier-aec-droit/        stop, idle, norm, fix
```

- **aviation/** : SVG 64 × 64, traits blancs de 4 (`stroke="#fff"`), extrémités arrondies, sans texte.
  Ajouter une icône : déposer le fichier dans le bon dossier puis la déclarer dans
  `shared/icons.js` (`AVIATION_ICON_GROUPS`) pour qu'elle apparaisse dans le choix d'icône. Les visuels du point de vue se déclarent de même dans `VIEW_FACE_GROUPS`.
- **touches-completes/** : SVG 144 × 144 affichés en plein cadre à la place de la touche.
  Un dossier par thème (avion, point de vue…), un sous-dossier par commande, un fichier par état ou position.

Ces icônes sont **dans l'application** et mises à jour avec elle. Vos propres images ne vont pas ici :
elles sont rangées dans la **bibliothèque d'icônes** (dossier `icons/` des données de StreamSim,
voir la documentation), qui s'exporte et s'importe comme la configuration.

Anciens chemins (versions jusqu'à 0.11 : `avia/` et `faces/`) : convertis automatiquement dans les
configurations et toujours servis par le serveur.
