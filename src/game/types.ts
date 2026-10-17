export type GameState = 'menu' | 'playing' | 'gameover';

export const COURSE_FINISH = 900;
export const TANK_RESERVE_FRACTION = 0.2;

export interface GameStats {
  score: number;
  timeLeft: number;
  tank: number; // 0..1
  speed: number;
  combo: number;
  distance: number;
  airborne: boolean;
  countdown: number; // >0 = countdown running
}

export interface RunBreakdown {
  crashes: number;
  hardLandings: number;
  flips: number;
  rings: number;
  airtime: number;
}

export interface GameOverResult {
  score: number;
  distance: number;
  breakdown: RunBreakdown;
}

export interface GameEvents {
  onStats: (stats: GameStats) => void;
  onGameOver: (result: GameOverResult) => void;
  onToast: (text: string, tone: 'good' | 'bad') => void;
  onPopup: (label: string, points: number, tone: 'good' | 'bad') => void;
}

export const PALETTE = {
  bodySilver: 0xe8eaf0,
  bodyDark: 0x1a1c20,
  canopy: 0x05070a,
  tailBar: 0xff1a2e,
  thruster: 0x3b6fb5,
  asphalt: 0x14161a,
  lineYellow: 0xd8b73c,
  accent: 0x6fc3ff,
};
