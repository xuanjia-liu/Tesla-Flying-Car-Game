export type GameState = 'loading' | 'menu' | 'playing' | 'gameover';

export const STAGE_LENGTH = 500;
export const COURSE_LENGTH = STAGE_LENGTH * 3;
export const ROAD_HALF_WIDTH = 15;
export const RAIL_X = 30;

export const STAGE_NAMES = ['MOJAVE DAWN', 'COASTAL CAUSEWAY', 'NEON DISTRICT'] as const;

export interface GameStats {
  score: number;
  timeLeft: number;
  air: number; // 0..1 COPV pressure, refilled by the onboard compressor
  thruster: ThrusterMode | null; // the cold-gas function firing right now
  speed: number; // m/s
  combo: number;
  comboTimer: number; // 0..1 until the combo drops
  progress: number; // 0..1 along the course
  distance: number;
  airborne: boolean;
  altitude: number;
  countdown: number; // >0 while the start countdown runs
  stage: number;
  boosting: boolean;
}

export type ThrusterMode = 'LAUNCH' | 'BOOST' | 'BRAKE' | 'GRIP' | 'HOVER' | 'LANDING';

export interface RunBreakdown {
  crashes: number;
  hardLandings: number;
  tricks: number;
  rings: number;
  ringsTotal: number;
  nearMisses: number;
  stunts: number;
  stuntsTotal: number;
  airtime: number;
  topSpeed: number;
  checkpoints: number;
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface GameOverResult {
  score: number;
  distance: number;
  finished: boolean;
  runTime: number;
  grade: Grade;
  breakdown: RunBreakdown;
}

export type Tone = 'good' | 'bad' | 'gold';

export interface GameEvents {
  onStats: (stats: GameStats) => void;
  onGameOver: (result: GameOverResult) => void;
  onPopup: (label: string, points: number, tone: Tone) => void;
  onCallout: (text: string, tone: Tone) => void;
  onStage: (stage: number) => void;
  onHint: (hint: HintId | null) => void;
}

export type HintId = 'drive' | 'fly' | 'boost' | 'grip' | 'roll' | 'ramp' | 'barrier' | 'gantry' | 'stunt' | 'kickflip';

export const PAINTS = [
  { id: 'silver', name: 'Quicksilver', hex: 0xd9dce2 },
  { id: 'red', name: 'Ultra Red', hex: 0xb3121f },
  { id: 'black', name: 'Obsidian', hex: 0x15171b },
  { id: 'blue', name: 'Deep Blue', hex: 0x1d3f8f },
  { id: 'pearl', name: 'Pearl White', hex: 0xf2f2ee },
] as const;

export function gradeFor(score: number, finished: boolean): Grade {
  if (finished && score >= 40000) return 'S';
  if (score >= 25000) return 'A';
  if (score >= 14000) return 'B';
  if (score >= 6000) return 'C';
  return 'D';
}
