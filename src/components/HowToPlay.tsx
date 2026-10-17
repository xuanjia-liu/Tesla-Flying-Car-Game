import { Gamepad2, Keyboard, Smartphone, X } from 'lucide-react';
import { useState } from 'react';

const SCHEMES = {
  keyboard: [
    ['W / ↑', 'Accelerate'],
    ['S / ↓', 'Brake · reverse'],
    ['A D / ← →', 'Steer'],
    ['SPACE', 'Tap to hop · hold to fly'],
    ['SHIFT', 'Nitro'],
    ['Q / E', 'Barrel roll (in the air)'],
    ['ESC / P', 'Pause'],
  ],
  touch: [
    ['Drag left side', 'Steer'],
    ['Auto', 'Accelerate'],
    ['THRUST', 'Tap to hop · hold to fly'],
    ['NITRO', 'Boost'],
    ['ROLL', 'Barrel roll (in the air)'],
    ['BRAKE', 'Slow down'],
  ],
  gamepad: [
    ['Left stick', 'Steer'],
    ['RT / LT', 'Throttle / brake'],
    ['A', 'Hop · hold to fly'],
    ['X / RB', 'Nitro'],
    ['B / Y', 'Barrel roll'],
    ['Start', 'Pause'],
  ],
} as const;

const TIPS = [
  'Thrust drains your energy; it refills while you drive and when you fly through rings.',
  'Rings, near misses, roof hops and barrel rolls build a combo multiplier and fill nitro.',
  'Finish a roll before you touch down, or it is a wipeout.',
  'Checkpoint gates add 12 seconds. Crashes cost 3.',
];

export default function HowToPlay({ onClose, touch }: { onClose: () => void; touch: boolean }) {
  const [tab, setTab] = useState<keyof typeof SCHEMES>(touch ? 'touch' : 'keyboard');
  const tabs = [
    ['keyboard', Keyboard],
    ['touch', Smartphone],
    ['gamepad', Gamepad2],
  ] as const;
  return (
    <div className="glass w-full max-w-md animate-fadeup rounded-2xl p-5 text-left shadow-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-sm font-extrabold tracking-[0.3em]">HOW TO FLY</h3>
        <button onClick={onClose} className="icon-btn h-8 w-8" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-black/30 p-1">
        {tabs.map(([id, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold capitalize transition ${
              tab === id ? 'bg-cyan-300 text-ink' : 'text-white/70 hover:bg-white/10'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {id}
          </button>
        ))}
      </div>
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {SCHEMES[tab].map(([k, v]) => (
          <div key={k} className="contents">
            <dt>
              <kbd className="rounded-md border border-white/20 bg-white/10 px-2 py-0.5 font-display text-[10px] font-bold tracking-wider">{k}</kbd>
            </dt>
            <dd className="text-white/75">{v}</dd>
          </div>
        ))}
      </dl>
      <ul className="space-y-1.5 border-t border-white/10 pt-3 text-xs leading-relaxed text-white/55">
        {TIPS.map((t) => (
          <li key={t}>• {t}</li>
        ))}
      </ul>
    </div>
  );
}
