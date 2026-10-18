import { Gamepad2, Keyboard, Smartphone, X } from 'lucide-react';
import { useState } from 'react';

const SCHEMES = {
  keyboard: [
    ['W / ↑', 'Accelerate'],
    ['S / ↓', 'Front thrusters brake · reverse'],
    ['A D / ← →', 'Steer'],
    ['SPACE', 'Tap to hop · hold for a short hover'],
    ['SHIFT', 'Rear mains: launch · boost'],
    ['A D (air)', 'Side thrusters: steer · level'],
    ['Q / E', 'Barrel roll · kickflip (in the air)'],
    ['ESC / P', 'Pause'],
  ],
  touch: [
    ['Drag left side', 'Steer'],
    ['Auto', 'Accelerate'],
    ['HOP', 'Tap to hop · hold for a short hover'],
    ['BOOST', 'Rear mains: launch · boost'],
    ['ROLL', 'Barrel roll (in the air)'],
    ['BRAKE', 'Front thrusters brake'],
  ],
  gamepad: [
    ['Left stick', 'Steer'],
    ['RT / LT', 'Throttle / brake'],
    ['A', 'Hop · hold to hover'],
    ['X / RB', 'Rear mains boost'],
    ['B / Y', 'Barrel roll'],
    ['Start', 'Pause'],
  ],
} as const;

const TIPS = [
  'Every thruster runs on compressed air from the COPV tanks. The compressor tops them up whenever the thrusters rest; rings and tricks add a shot of air.',
  'The down thrusters give a hop or a short hover, not sustained flight. Side thrusters steer and level the car in the air and cushion the landing.',
  'Corner hard at speed and the side pods fire upward for downforce (GRIP), with the vacuum fans and wing helping.',
  'Rings, near misses, roof hops and barrel rolls build a combo multiplier.',
  'Finish a roll before you touch down, or it is a wipeout.',
  'Each stage has a stunt ramp that rolls you upside down and launches you over parked cars. Roll in the air to kickflip upright for a bonus.',
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
