import { useRef, useState } from 'react';
import { ChevronsUp, RotateCw, Zap } from 'lucide-react';
import type { InputManager, TouchState } from '@/game/input';

interface Props {
  input: InputManager;
}

function useHold(input: InputManager, key: keyof Omit<TouchState, 'steer'>) {
  const [down, setDown] = useState(false);
  const set = (v: boolean) => {
    input.touch[key] = v;
    setDown(v);
  };
  return {
    down,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        set(true);
      },
      onPointerUp: () => set(false),
      onPointerCancel: () => set(false),
      onLostPointerCapture: () => set(false),
    },
  };
}

const ring = 'pointer-events-auto touch-none select-none flex flex-col items-center justify-center rounded-full border backdrop-blur-md transition-transform';

export default function TouchControls({ input }: Props) {
  const thrust = useHold(input, 'thrust');
  const boost = useHold(input, 'boost');
  const brake = useHold(input, 'brake');
  const origin = useRef<number | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number; dx: number } | null>(null);
  const [rollFlash, setRollFlash] = useState(false);

  const steerHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      origin.current = e.clientX;
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setKnob({ x: e.clientX - r.left, y: e.clientY - r.top, dx: 0 });
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (origin.current === null) return;
      const dx = Math.max(-70, Math.min(70, e.clientX - origin.current));
      const s = dx / 70;
      input.touch.steer = Math.abs(s) < 0.08 ? 0 : s;
      setKnob((k) => (k ? { ...k, dx } : k));
    },
    onPointerUp: () => {
      origin.current = null;
      input.touch.steer = 0;
      setKnob(null);
    },
    onPointerCancel: () => {
      origin.current = null;
      input.touch.steer = 0;
      setKnob(null);
    },
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none">
      {/* steering zone: drag anywhere on the left */}
      <div className="pointer-events-auto absolute bottom-0 left-0 h-[62%] w-[40%] touch-none" {...steerHandlers}>
        {!knob && (
          <div className="absolute bottom-6 left-6 flex items-center gap-2 text-[10px] font-semibold tracking-[0.25em] text-white/40">
            <span className="text-lg">‹</span> DRAG TO STEER <span className="text-lg">›</span>
          </div>
        )}
        {knob && (
          <div className="absolute" style={{ left: knob.x - 80, top: knob.y - 24 }}>
            <div className="relative h-12 w-40 rounded-full border border-white/20 bg-black/25 backdrop-blur">
              <div
                className="absolute top-1/2 h-10 w-10 -translate-y-1/2 rounded-full border border-cyan-200/70 bg-cyan-300/30 shadow-[0_0_20px_rgba(56,216,255,.6)]"
                style={{ left: `calc(50% - 20px + ${knob.dx}px)` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* action cluster */}
      <div className="absolute bottom-4 right-4 flex items-end gap-3" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex flex-col items-center gap-3">
          <button
            aria-label="Barrel roll"
            className={`${ring} h-14 w-14 border-amber-200/40 bg-amber-300/10 text-amber-100 ${rollFlash ? 'scale-90' : ''}`}
            onPointerDown={(e) => {
              e.preventDefault();
              input.queueRoll(input.touch.steer < -0.2 ? -1 : 1);
              setRollFlash(true);
              window.setTimeout(() => setRollFlash(false), 120);
            }}
          >
            <RotateCw className="h-5 w-5" />
            <span className="text-[8px] font-bold tracking-widest">ROLL</span>
          </button>
          <button aria-label="Brake" className={`${ring} h-12 w-12 border-white/25 bg-black/30 text-white/80 ${brake.down ? 'scale-90 bg-rose-500/30' : ''}`} {...brake.handlers}>
            <span className="text-[8px] font-bold tracking-widest">BRAKE</span>
          </button>
        </div>
        <div className="flex flex-col items-center gap-3">
          <button
            aria-label="Nitro"
            className={`${ring} h-16 w-16 border-fuchsia-300/50 bg-fuchsia-500/15 text-fuchsia-100 ${boost.down ? 'scale-90 bg-fuchsia-500/40' : ''}`}
            {...boost.handlers}
          >
            <Zap className="h-6 w-6" />
            <span className="text-[8px] font-bold tracking-widest">NITRO</span>
          </button>
          <button
            aria-label="Thrust"
            className={`${ring} h-24 w-24 border-cyan-200/60 bg-cyan-400/15 text-cyan-50 shadow-[0_0_30px_rgba(56,216,255,.25)] ${thrust.down ? 'scale-90 bg-cyan-400/40' : ''}`}
            {...thrust.handlers}
          >
            <ChevronsUp className="h-8 w-8" />
            <span className="text-[9px] font-bold tracking-widest">THRUST</span>
          </button>
        </div>
      </div>
    </div>
  );
}
