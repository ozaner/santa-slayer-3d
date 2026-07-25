/** Level registry: arena builder + presentation + wave script. */
import { buildVillage } from './village.js';
import { buildWorkshop } from './workshop.js';
import { buildYard } from './yard.js';

export const LEVELS = [
  {
    id: 'village',
    title: 'THE NORTH POLE VILLAGE',
    subtitle: 'They came for the toys.',
    build: buildVillage,
    sky: { zenith: 0x060a20, horizon: 0x2b3f78, ground: 0x141c34, aurora: 0.62 },
    fogColor: 0x1b2a52,
    fogDensity: 0.0055,
    envIntensity: 0.7,
    light: {
      hemi: 0.82, hemiSky: 0x8fbaff, hemiGround: 0x4a5480,
      ambient: 0.55, ambientColor: 0x46567f,
      sun: 1.2, sunColor: 0xbfd4ff, sunPos: [42, 66, -58], fill: 0.4,
    },
    waves: [
      { name: 'Crumbs in the snow', enemies: { grunt: 6 } },
      { name: 'Sharpened candy', enemies: { grunt: 7, sword: 3 } },
      { name: 'They brought shields', enemies: { grunt: 6, sword: 4, shield: 2 } },
      { name: 'The brutes wake up', enemies: { grunt: 8, sword: 5, shield: 2, snowman: 2 } },
      { name: 'Everything at once', enemies: { grunt: 10, sword: 6, shield: 4, snowman: 3 } },
    ],
  },
  {
    id: 'workshop',
    title: "SANTA'S WORKSHOP",
    subtitle: 'The production line never stopped.',
    build: buildWorkshop,
    indoor: true,
    sky: { aurora: 0 },
    fogColor: 0x2a1d16,
    fogDensity: 0.014,
    envIntensity: 0.5,
    light: {
      hemi: 0.72, hemiSky: 0xffc78a, hemiGround: 0x5c4636,
      ambient: 0.6, ambientColor: 0x6b4c33,
      sun: 0.35, sunColor: 0xffd9a8, sunPos: [30, 60, 20], fill: 0.5,
    },
    waves: [
      { name: 'Assembly line', enemies: { grunt: 7, sword: 2 } },
      { name: 'Quality control', enemies: { grunt: 6, sword: 5, shield: 2 } },
      { name: 'Night shift', enemies: { grunt: 8, sword: 5, shield: 3, snowman: 2 } },
      { name: 'Overtime', enemies: { grunt: 9, sword: 7, shield: 4, snowman: 3 } },
      { name: 'Full capacity', enemies: { grunt: 12, sword: 8, shield: 5, snowman: 4 } },
    ],
  },
  {
    id: 'yard',
    title: 'THE SLEIGH YARD',
    subtitle: 'Something enormous is waiting.',
    build: buildYard,
    mode: 'boss',
    sky: { zenith: 0x120820, horizon: 0x5a2440, ground: 0x1a1020, aurora: 0.4 },
    fogColor: 0x2a1730,
    fogDensity: 0.0075,
    envIntensity: 0.62,
    light: {
      hemi: 0.78, hemiSky: 0xffa0c0, hemiGround: 0x4a3450,
      ambient: 0.55, ambientColor: 0x5a3f66,
      sun: 1.0, sunColor: 0xffc0a0, sunPos: [-40, 55, 40], fill: 0.42,
    },
    waves: [],
  },
];
