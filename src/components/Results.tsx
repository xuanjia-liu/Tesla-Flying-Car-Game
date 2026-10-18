import { Download, Home, RotateCcw, Trophy } from 'lucide-react';
import type { GameOverResult } from '@/game/types';
import { saveNewsCard } from './NewsCard';

interface Props {
  result: GameOverResult;
  best: number;
  newBest: boolean;
  onRetry: () => void;
  onMenu: () => void;
}

const gradeColor: Record<string, string> = {
  S: 'from-amber-200 to-fuchsia-400',
  A: 'from-cyan-200 to-sky-400',
  B: 'from-emerald-200 to-cyan-400',
  C: 'from-slate-200 to-slate-400',
  D: 'from-slate-300 to-slate-500',
};

export default function Results({ result, best, newBest, onRetry, onMenu }: Props) {
  const b = result.breakdown;
  const stats: [string, string][] = [
    ['Rings', `${b.rings}/${b.ringsTotal}`],
    ['Tricks', String(b.tricks)],
    ['Stunts', `${b.stunts}/${b.stuntsTotal}`],
    ['Top speed', `${b.topSpeed} mph`],
    ['Airtime', `${b.airtime}s`],
    ['Wipeouts', String(b.crashes + b.hardLandings)],
  ];
  return (
    <div className="glass w-full max-w-lg animate-fadeup rounded-3xl p-6 text-center shadow-2xl sm:p-8">
      <div className="label">
        {result.attack
          ? result.finished
            ? `${result.mission} · ${result.runTime.toFixed(2)}s`
            : `DNF · ${result.runTime.toFixed(2)}s`
          : result.finished
            ? `Course clear · ${result.runTime.toFixed(1)}s`
            : `Time's up · ${result.distance} m`}
      </div>
      <div className="mt-2 flex items-center justify-center gap-5">
        <div className={`bg-gradient-to-br bg-clip-text font-display text-7xl font-black text-transparent sm:text-8xl ${gradeColor[result.grade]}`}>{result.grade}</div>
        <div className="text-left">
          <div className="label">{result.attack ? 'Time' : 'Score'}</div>
          <div className="font-display text-3xl font-black tabular-nums sm:text-4xl">
            {result.attack ? `${result.runTime.toFixed(2)}s` : result.score.toLocaleString()}
          </div>
          {newBest ? (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-300/20 px-2 py-0.5 text-[10px] font-bold tracking-widest text-amber-200">
              <Trophy className="h-3 w-3" /> NEW BEST
            </div>
          ) : (
            <div className="mt-1 text-xs text-white/45">
              Best {result.attack ? (best > 0 ? `${best.toFixed(2)}s` : '—') : best.toLocaleString()}
            </div>
          )}
        </div>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-black/25 px-2 py-2">
            <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/45">{k}</div>
            <div className="font-display text-sm font-bold tabular-nums sm:text-base">{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button onClick={onRetry} className="btn-primary" autoFocus>
          <RotateCcw className="h-4 w-4" /> RUN IT AGAIN
        </button>
        <button onClick={onMenu} className="btn-ghost">
          <Home className="h-3.5 w-3.5" /> GARAGE
        </button>
        <button onClick={() => saveNewsCard(result, best)} className="btn-ghost">
          <Download className="h-3.5 w-3.5" /> NEWS CARD
        </button>
      </div>
    </div>
  );
}
