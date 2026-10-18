import { Gauge, Wind } from 'lucide-react';
import { GameStats, STAGE_NAMES, ThrusterMode, Tone } from '@/game/types';

export interface Popup {
  id: number;
  label: string;
  points: number;
  tone: Tone;
}

export interface Callout {
  id: number;
  text: string;
  tone: Tone;
}

const toneText: Record<Tone, string> = {
  good: 'text-cyan-200',
  gold: 'text-amber-200',
  bad: 'text-rose-300',
};

function Bar({ value, color, icon, label, warn }: { value: number; color: string; icon: React.ReactNode; label: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`shrink-0 ${warn ? 'text-rose-300 animate-pulse' : 'text-white/70'}`}>{icon}</div>
      <div className="flex-1">
        <div className="mb-1 flex justify-between text-[9px] font-semibold tracking-[0.25em] text-white/50">
          <span>{label}</span>
          <span className="tabular-nums">{Math.round(value * 100)}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full ${color} transition-[width] duration-100`} style={{ width: `${value * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

const modeStyle: Record<ThrusterMode, string> = {
  LAUNCH: 'border-fuchsia-300/60 bg-fuchsia-500/20 text-fuchsia-100',
  BOOST: 'border-fuchsia-300/50 bg-fuchsia-500/15 text-fuchsia-100',
  BRAKE: 'border-rose-300/50 bg-rose-500/15 text-rose-100',
  GRIP: 'border-amber-200/50 bg-amber-300/15 text-amber-100',
  HOVER: 'border-cyan-200/50 bg-cyan-400/15 text-cyan-50',
  LANDING: 'border-cyan-200/50 bg-cyan-400/15 text-cyan-50',
};

function Progress({ progress }: { progress: number }) {
  return (
    <div className="relative mx-auto mt-2 h-1 w-48 rounded-full bg-white/15 sm:w-72">
      <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cyan-300 to-fuchsia-400" style={{ width: `${progress * 100}%` }} />
      {[1 / 3, 2 / 3].map((p) => (
        <div key={p} className={`absolute -top-1 h-3 w-0.5 rounded ${progress >= p ? 'bg-cyan-200' : 'bg-white/40'}`} style={{ left: `${p * 100}%` }} />
      ))}
      <div className="absolute -top-1.5 right-0 h-4 w-1 rounded bg-fuchsia-300" />
      <div
        className="absolute -top-[5px] h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-cyan-200 bg-ink shadow-[0_0_12px_rgba(56,216,255,0.9)]"
        style={{ left: `${progress * 100}%` }}
      />
    </div>
  );
}

interface HudProps {
  stats: GameStats;
  popups: Popup[];
  callouts: Callout[];
  hint: string | null;
  touch: boolean;
}

export default function Hud({ stats, popups, callouts, hint, touch }: HudProps) {
  const secs = Math.max(0, stats.timeLeft);
  const urgent = !stats.attack && secs < 10 && stats.countdown <= 0;
  const mph = Math.round(stats.speed * 2.237);
  const counting = stats.countdown > 0;
  const cd = Math.ceil(stats.countdown);

  return (
    <div className="pointer-events-none absolute inset-0 select-none" style={{ padding: 'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)' }}>
      {/* score + combo */}
      <div className="absolute left-4 top-3 sm:left-6 sm:top-5">
        <div className="label">Score</div>
        <div className="font-display text-2xl font-extrabold tabular-nums leading-tight sm:text-4xl">{stats.score.toLocaleString()}</div>
        {stats.combo > 1 && (
          <div key={stats.combo} className="mt-1 w-28 animate-pop">
            <div className="flex items-baseline gap-1 font-display font-extrabold text-amber-300">
              <span className="text-xl sm:text-2xl">×{stats.combo}</span>
              <span className="text-[10px] tracking-[0.25em] text-amber-200/80">COMBO</span>
            </div>
            <div className="mt-0.5 h-1 rounded-full bg-white/10">
              <div className="h-full rounded-full bg-amber-300" style={{ width: `${stats.comboTimer * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* timer + stage + progress */}
      <div className="absolute left-1/2 top-2 -translate-x-1/2 text-center sm:top-4">
        <div className={`font-display text-3xl font-black tabular-nums leading-none sm:text-5xl ${urgent ? 'animate-pulse text-rose-400' : 'text-white'}`}>
          {Math.floor(secs)}
          <span className="text-lg sm:text-2xl">.{Math.floor((secs % 1) * 10)}</span>
        </div>
        <div className="mt-1 text-[9px] font-semibold tracking-[0.35em] text-white/55 sm:text-[10px]">{stats.mission || STAGE_NAMES[stats.stage]}</div>
        <Progress progress={stats.progress} />
        {stats.attack && stats.countdown <= 0 && (
          <div className="mt-1 text-[9px] font-semibold tracking-[0.28em] text-white/45">R RESTART</div>
        )}
      </div>

      {/* popups */}
      <div className={`absolute right-4 flex flex-col items-end gap-1 sm:right-6 ${touch ? 'top-16' : 'top-24 sm:top-28'}`}>
        {popups.map((p) => (
          <div key={p.id} className="animate-rise text-right">
            <span className={`font-display text-xs font-extrabold tracking-wider sm:text-sm ${toneText[p.tone]}`}>{p.label}</span>
            {p.points > 0 && <span className="ml-2 font-display text-xs font-bold tabular-nums text-white sm:text-sm">+{p.points.toLocaleString()}</span>}
          </div>
        ))}
      </div>

      {/* big callouts */}
      {callouts.map((c) => (
        <div
          key={c.id}
          className={`absolute left-1/2 top-[30%] animate-callout whitespace-nowrap font-display text-3xl font-black tracking-wider sm:text-6xl ${
            c.tone === 'bad' ? 'text-rose-400' : c.tone === 'gold' ? 'text-amber-200' : 'text-white text-glow'
          }`}
          style={{ textShadow: c.tone === 'bad' ? '0 0 24px rgba(255,60,80,.7)' : undefined }}
        >
          {c.text}
        </div>
      ))}

      {/* countdown */}
      {counting && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div key={cd} className="animate-pop font-display text-8xl font-black text-white text-glow sm:text-9xl">
            {cd > 3 ? '' : cd > 0 ? cd : 'GO'}
          </div>
        </div>
      )}

      {/* contextual hint */}
      {hint && (
        <div className={`absolute inset-x-0 flex animate-fadeup justify-center ${touch ? 'top-[7.5rem]' : 'bottom-36 sm:bottom-40'}`}>
          <div className="glass rounded-full px-4 py-2 text-center text-xs font-semibold tracking-wide text-white/90 sm:text-sm">{hint}</div>
        </div>
      )}

      {/* speed + meters */}
      <div className={`absolute ${touch ? 'bottom-14 left-6 w-40' : 'bottom-5 left-1/2 w-72 -translate-x-1/2 sm:bottom-7'}`}>
        <div className={`flex items-end gap-2 ${touch ? 'justify-start' : 'justify-center'}`}>
          <Gauge className="mb-1.5 h-4 w-4 text-white/50" />
          <span className={`font-display font-black tabular-nums leading-none ${touch ? 'text-3xl' : 'text-5xl'} ${stats.boosting ? 'text-fuchsia-300' : 'text-white'}`}>
            {mph}
          </span>
          <span className="mb-1 text-[10px] font-semibold tracking-[0.25em] text-white/50">MPH</span>
          {stats.airborne && stats.altitude > 1 && (
            <span className="mb-1 ml-1 rounded bg-cyan-400/15 px-1.5 py-0.5 text-[10px] font-bold tracking-widest text-cyan-200">
              ALT {Math.round(stats.altitude)}m
            </span>
          )}
        </div>
        <div className="mt-2 space-y-1.5">
          <Bar
            value={stats.air}
            color={stats.air < 0.2 ? 'bg-gradient-to-r from-rose-400 to-rose-200' : 'bg-gradient-to-r from-slate-300 via-sky-200 to-white'}
            icon={<Wind className="h-3.5 w-3.5" />}
            label="AIR · COPV"
            warn={stats.air < 0.15}
          />
          <div className={`flex h-5 ${touch ? 'justify-start' : 'justify-center'}`}>
            {stats.thruster && (
              <span key={stats.thruster} className={`animate-pop rounded border px-2 py-0.5 text-[9px] font-bold tracking-[0.3em] ${modeStyle[stats.thruster]}`}>
                {stats.thruster}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
