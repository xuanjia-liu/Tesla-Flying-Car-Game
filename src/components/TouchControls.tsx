import { InputManager, TouchInput } from '@/game/input';

interface TouchControlsProps {
  input: InputManager;
}

type TouchKey = keyof TouchInput;

function holdHandlers(input: InputManager, key: TouchKey, downValue: number | boolean) {
  const set = (v: number | boolean) => input.setTouch({ [key]: v } as Partial<TouchInput>);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      set(downValue);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      set(key === 'flipQueued' || key === 'cushionQueued' ? false : 0);
    },
    onPointerLeave: () => set(key === 'flipQueued' || key === 'cushionQueued' ? false : 0),
    onPointerCancel: () => set(key === 'flipQueued' || key === 'cushionQueued' ? false : 0),
  };
}

const btn =
  'pointer-events-auto flex items-center justify-center rounded-full bg-black/35 border border-white/30 text-white/90 font-bold backdrop-blur active:bg-white/35 select-none touch-none';

export default function TouchControls({ input }: TouchControlsProps) {
  return (
    <div className="md:hidden absolute inset-x-0 bottom-0 z-20 p-3 pb-5 flex justify-between items-end pointer-events-none">
      {/* left cluster: steer + brake */}
      <div className="flex gap-2.5">
        <button className={`${btn} w-16 h-16 text-2xl`} {...holdHandlers(input, 'steer', -1)} aria-label="Steer left">
          ◀
        </button>
        <button className={`${btn} w-16 h-16 text-2xl`} {...holdHandlers(input, 'steer', 1)} aria-label="Steer right">
          ▶
        </button>
        <button className={`${btn} w-14 h-14 text-[10px] tracking-wider`} {...holdHandlers(input, 'forward', -1)} aria-label="Brake">
          BRAKE
        </button>
      </div>

      {/* right cluster: actions */}
      <div className="flex flex-col items-end gap-2.5">
        <div className="flex gap-2.5">
          <button className={`${btn} w-14 h-14 text-[10px] tracking-wider`} {...holdHandlers(input, 'boost', true)} aria-label="Boost">
            BOOST
          </button>
          <button
            className={`${btn} w-14 h-14 text-[10px] tracking-wider`}
            {...holdHandlers(input, 'flipQueued', true)}
            aria-label="Flip"
          >
            FLIP
          </button>
        </div>
        <div className="flex gap-2.5">
          <button
            className={`${btn} w-20 h-14 text-[10px] tracking-wider`}
            {...holdHandlers(input, 'cushionQueued', true)}
            aria-label="Cushion jets"
          >
            CUSHION
          </button>
          <button className={`${btn} w-24 h-16 text-xs tracking-widest`} {...holdHandlers(input, 'hop', true)} aria-label="Hop">
            HOP
          </button>
        </div>
      </div>
    </div>
  );
}
