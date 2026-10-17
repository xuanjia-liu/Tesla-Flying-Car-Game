import { X } from 'lucide-react';
import type { Quality, Settings } from '@/game/settings';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
}

const QUALITIES: { id: Quality; label: string; note: string }[] = [
  { id: 'low', label: 'Low', note: 'No shadows or bloom' },
  { id: 'medium', label: 'Medium', note: 'Balanced' },
  { id: 'high', label: 'High', note: 'Full effects' },
];

export default function SettingsPanel({ settings, onChange, onClose }: Props) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  return (
    <div className="glass w-full max-w-sm animate-fadeup rounded-2xl p-5 text-left shadow-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-sm font-extrabold tracking-[0.3em]">SETTINGS</h3>
        <button onClick={onClose} className="icon-btn h-8 w-8" aria-label="Close settings">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="label mb-2">Graphics quality</div>
      <div className="mb-1 grid grid-cols-3 gap-1 rounded-xl bg-black/30 p-1">
        {QUALITIES.map((q) => (
          <button
            key={q.id}
            onClick={() => set('quality', q.id)}
            className={`rounded-lg py-2 text-xs font-semibold tracking-wider transition ${
              settings.quality === q.id ? 'bg-cyan-300 text-ink' : 'text-white/70 hover:bg-white/10'
            }`}
          >
            {q.label}
          </button>
        ))}
      </div>
      <div className="mb-4 text-[11px] text-white/40">{QUALITIES.find((q) => q.id === settings.quality)?.note} · resolution adapts automatically</div>

      {(
        [
          ['musicVolume', 'Music'],
          ['sfxVolume', 'Sound effects'],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="mb-3 block">
          <div className="mb-1 flex justify-between text-xs text-white/70">
            <span>{label}</span>
            <span className="tabular-nums text-white/40">{Math.round(settings[key] * 100)}%</span>
          </div>
          <input type="range" min={0} max={1} step={0.05} value={settings[key]} onChange={(e) => set(key, Number(e.target.value))} className="w-full" />
        </label>
      ))}

      <label className="flex cursor-pointer items-center justify-between py-1 text-xs text-white/70">
        <span>Camera shake</span>
        <input type="checkbox" checked={settings.shake} onChange={(e) => set('shake', e.target.checked)} className="h-4 w-4 accent-cyan-300" />
      </label>
      <label className="flex cursor-pointer items-center justify-between py-1 text-xs text-white/70">
        <span>Mute all audio</span>
        <input type="checkbox" checked={settings.muted} onChange={(e) => set('muted', e.target.checked)} className="h-4 w-4 accent-cyan-300" />
      </label>
    </div>
  );
}
