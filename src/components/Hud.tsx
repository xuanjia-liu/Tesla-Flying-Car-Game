import { GameStats, COURSE_FINISH, TANK_RESERVE_FRACTION } from '@/game/types';

export interface Popup {
  id: number;
  label: string;
  points: number;
  tone: 'good' | 'bad';
}

interface HudProps {
  stats: GameStats;
  popups: Popup[];
}

function TankGauge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const reserve = Math.round(TANK_RESERVE_FRACTION * 100);
  const low = pct < reserve + 10;
  return (
    <div className="w-40">
      <div className="flex justify-between text-[10px] tracking-[0.2em] text-white/60 mb-1">
        <span>THRUST TANK</span>
        <span className={low ? 'text-red-300' : 'text-sky-300'}>{pct}%</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-white/10 overflow-hidden">
        {/* reserve zone — hovering can't eat into this */}
        <div
          className="absolute right-0 top-0 h-full bg-emerald-400/25 border-l border-emerald-300/70"
          style={{ width: `${reserve}%` }}
        />
        <div
          className={`absolute left-0 top-0 h-full rounded-l-full transition-all duration-150 ${
            low ? 'bg-red-400' : 'bg-sky-400'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[9px] text-emerald-300/70 mt-0.5 tracking-wider">RESERVE: LANDING JETS</div>
    </div>
  );
}

function Speedometer({ speed }: { speed: number }) {
  const mph = Math.round(speed * 2.237);
  const maxMph = 140;
  const frac = Math.min(1, speed * 2.237 / maxMph);
  const gear = mph < 5 ? 1 : mph < 25 ? 2 : mph < 50 ? 3 : mph < 80 ? 4 : mph < 110 ? 5 : 6;
  const angle = -220 * frac + 110;
  return (
    <div className="relative w-24 h-24 md:w-28 md:h-28">
      <div className="absolute inset-0 rounded-full bg-black/45 border-2 border-white/20 backdrop-blur-sm" />
      <svg viewBox="0 0 100 100" className="absolute inset-0">
        <path d="M 18 82 A 42 42 0 1 1 82 82" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="6" strokeLinecap="round" />
        <path
          d="M 18 82 A 42 42 0 1 1 82 82"
          fill="none"
          stroke={frac > 0.85 ? '#f87171' : '#7fd4ff'}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${frac * 198} 400`}
        />
      </svg>
      <div
        className="absolute left-1/2 top-1/2 w-0.5 h-8 origin-bottom bg-white/90"
        style={{ transform: `translate(-50%, -100%) rotate(${angle}deg)`, transformOrigin: '50% 100%' }}
      />
      <div className="absolute left-1/2 top-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
      <div className="absolute inset-x-0 bottom-4 text-center">
        <div className="text-lg font-bold text-white tabular-nums leading-none">{mph}</div>
        <div className="text-[8px] tracking-[0.2em] text-white/50">MPH · G{gear}</div>
      </div>
    </div>
  );
}

function Minimap({ distance }: { distance: number }) {
  const frac = Math.min(1, distance / COURSE_FINISH);
  return (
    <div className="w-28">
      <div className="flex justify-between text-[9px] tracking-[0.2em] text-white/50 mb-1">
        <span>START</span>
        <span>FINISH {Math.max(0, COURSE_FINISH - distance)}m</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-white/10 overflow-visible">
        <div className="absolute left-0 top-0 h-full rounded-full bg-sky-400/70" style={{ width: `${frac * 100}%` }} />
        <div
          className="absolute -top-1 w-3.5 h-3.5 rounded-full bg-white border-2 border-sky-300 shadow"
          style={{ left: `calc(${frac * 100}% - 7px)` }}
        />
      </div>
    </div>
  );
}

export default function Hud({ stats, popups }: HudProps) {
  const seconds = Math.ceil(stats.timeLeft);
  const urgent = stats.timeLeft < 10;
  const counting = stats.countdown > 0;

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* top left: score + combo */}
      <div className="absolute top-3 left-3 md:top-6 md:left-6">
        <div className="text-[10px] tracking-[0.25em] text-white/50">SCORE</div>
        <div className="text-3xl md:text-4xl font-bold text-white tabular-nums leading-tight">{stats.score}</div>
        {stats.combo > 1 && (
          <div className="mt-1 inline-block px-2 py-0.5 rounded bg-amber-400/25 border border-amber-300/60 text-amber-200 text-xs font-bold tracking-widest">
            ×{stats.combo} COMBO
          </div>
        )}
      </div>

      {/* top center: timer */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 text-center">
        <div className="text-[10px] tracking-[0.25em] text-white/50">TIME</div>
        <div
          className={`text-4xl md:text-5xl font-bold tabular-nums leading-tight ${
            urgent ? 'text-red-400 animate-pulse' : 'text-white'
          }`}
        >
          :{Math.max(0, seconds).toString().padStart(2, '0')}
        </div>
      </div>

      {/* top right: minimap */}
      <div className="absolute top-3 right-3 md:top-6 md:right-6">
        <Minimap distance={stats.distance} />
      </div>

      {/* right-middle: stacked popups */}
      <div className="absolute right-3 md:right-6 top-28 md:top-36 flex flex-col items-end gap-1">
        {popups.map((p) => (
          <div
            key={p.id}
            className={`px-2.5 py-1 rounded text-right backdrop-blur ${
              p.tone === 'good' ? 'bg-emerald-500/15 border border-emerald-400/40' : 'bg-red-500/20 border border-red-400/50'
            }`}
          >
            <div className={`text-xs font-bold tracking-wider ${p.tone === 'good' ? 'text-emerald-300' : 'text-red-300'}`}>
              {p.label}
              {p.points > 0 && <span className="ml-2 tabular-nums">+{p.points}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* bottom left: tank */}
      <div className="absolute bottom-24 md:bottom-6 left-3 md:left-6">
        <TankGauge value={stats.tank} />
      </div>

      {/* bottom right: speedometer */}
      <div className="absolute bottom-24 md:bottom-6 right-3 md:right-6">
        <Speedometer speed={stats.speed} />
      </div>

      {/* countdown */}
      {counting && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            key={Math.ceil(stats.countdown)}
            className="text-8xl md:text-9xl font-bold text-white drop-shadow-[0_0_30px_rgba(127,212,255,0.8)] animate-[pop_0.4s_ease-out]"
          >
            {Math.ceil(stats.countdown) > 0 ? Math.ceil(stats.countdown) : 'GO!'}
          </div>
        </div>
      )}
    </div>
  );
}
