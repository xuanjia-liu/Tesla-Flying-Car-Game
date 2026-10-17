export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  quality: Quality;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  shake: boolean;
  paint: string;
}

const KEY = 'roadster-settings-v2';

export const isCoarsePointer = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

export function defaultSettings(): Settings {
  return {
    quality: isCoarsePointer() ? 'medium' : 'high',
    musicVolume: 0.6,
    sfxVolume: 0.8,
    muted: false,
    shake: true,
    paint: 'silver',
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    /* corrupted or blocked storage: fall back to defaults */
  }
  return defaultSettings();
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode) */
  }
}
