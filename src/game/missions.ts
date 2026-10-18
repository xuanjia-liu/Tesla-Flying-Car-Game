import type { Piece } from './track';

export interface MissionInfo {
  id: number;
  name: string;
  place: string;
  blurb: string;
  attack: boolean;
  par: number;
  time: number;
}

export const MISSIONS: MissionInfo[] = [
  {
    id: 0,
    name: 'COLD-GAS PROVING',
    place: 'Mojave dawn',
    blurb: 'A gate, a cliff, a train, a river. Every thruster has a different job.',
    attack: false,
    par: 0,
    time: 90,
  },
  {
    id: 1,
    name: 'CAUSEWAY CIRCUIT',
    place: 'Coastal dusk',
    blurb: 'An elevated ribbon. Banked turns, a wallride, a loop, jumps. Time attack.',
    attack: true,
    par: 14,
    time: 0,
  },
  {
    id: 2,
    name: 'NEON REACTOR',
    place: 'Night city',
    blurb: 'Tighter and higher. Two loops, wallrides both ways, a long boosted jump.',
    attack: true,
    par: 15,
    time: 0,
  },
];

/** Positive angle is a left turn. Bank leans into the turn. */
export const CIRCUITS: Piece[][] = [
  [
    { k: 'straight', len: 36 },
    { k: 'checkpoint' },
    { k: 'turn', radius: 32, angle: -Math.PI * 0.9, bank: 0.62 },
    { k: 'straight', len: 18 },
    { k: 'slope', len: 12, dy: 3.2 },
    { k: 'gap', len: 14 },
    { k: 'slope', len: 14, dy: -3.2 },
    { k: 'straight', len: 16, boost: true },
    { k: 'wall', len: 42, side: 1 },
    { k: 'straight', len: 12 },
    { k: 'checkpoint' },
    { k: 'loop', radius: 13 },
    { k: 'straight', len: 16 },
    { k: 'turn', radius: 26, angle: Math.PI * 0.75, bank: 0.58 },
    { k: 'slope', len: 10, dy: 2.4 },
    { k: 'gap', len: 12 },
    { k: 'slope', len: 12, dy: -2.4 },
    { k: 'straight', len: 16, boost: true },
    { k: 'checkpoint' },
    { k: 'turn', radius: 22, angle: -Math.PI, bank: 0.66 },
    { k: 'wall', len: 40, side: -1 },
    { k: 'loop', radius: 12 },
    { k: 'straight', len: 14 },
    { k: 'slope', len: 14, dy: 4 },
    { k: 'gap', len: 16 },
    { k: 'slope', len: 16, dy: -4 },
    { k: 'turn', radius: 30, angle: Math.PI * 0.65, bank: 0.5 },
    { k: 'straight', len: 22 },
    { k: 'finish' },
  ],
  [
    { k: 'straight', len: 28, boost: true },
    { k: 'turn', radius: 22, angle: Math.PI * 0.7, bank: 0.72 },
    { k: 'turn', radius: 22, angle: -Math.PI * 0.7, bank: 0.72 },
    { k: 'checkpoint' },
    { k: 'slope', len: 14, dy: 4 },
    { k: 'gap', len: 18 },
    { k: 'slope', len: 16, dy: -4 },
    { k: 'wall', len: 36, side: -1 },
    { k: 'straight', len: 10 },
    { k: 'loop', radius: 11 },
    { k: 'checkpoint' },
    { k: 'straight', len: 12, boost: true },
    { k: 'wall', len: 34, side: 1 },
    { k: 'turn', radius: 20, angle: -Math.PI * 0.55, bank: 0.5 },
    { k: 'loop', radius: 12 },
    { k: 'slope', len: 10, dy: 2.2 },
    { k: 'gap', len: 13 },
    { k: 'slope', len: 12, dy: -2.2 },
    { k: 'straight', len: 12, boost: true },
    { k: 'checkpoint' },
    { k: 'turn', radius: 18, angle: Math.PI * 1.15, bank: 0.78 },
    { k: 'wall', len: 38, side: 1 },
    { k: 'loop', radius: 10 },
    { k: 'straight', len: 10 },
    { k: 'slope', len: 12, dy: 5 },
    { k: 'gap', len: 18 },
    { k: 'slope', len: 14, dy: -5 },
    { k: 'turn', radius: 16, angle: -Math.PI * 0.85, bank: 0.7 },
    { k: 'straight', len: 20 },
    { k: 'finish' },
  ],
];
