import { GameOverResult } from '@/game/types';

interface NewsCardProps {
  result: GameOverResult;
  bestScore: number;
}

const CARD_W = 640;
const CARD_H = 360;

/** Draw the breaking-news result card to an offscreen canvas and download it as PNG. */
export function saveNewsCard(result: GameOverResult, bestScore: number) {
  const c = document.createElement('canvas');
  c.width = CARD_W * 2;
  c.height = CARD_H * 2;
  const ctx = c.getContext('2d')!;
  ctx.scale(2, 2);

  // night backdrop
  const grad = ctx.createLinearGradient(0, 0, 0, CARD_H);
  grad.addColorStop(0, '#0a0d14');
  grad.addColorStop(1, '#1a2028');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // skyline silhouettes
  ctx.fillStyle = '#12161e';
  let x = 0;
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  while (x < CARD_W) {
    const w = 40 + rand() * 70;
    const h = 60 + rand() * 140;
    ctx.fillRect(x, CARD_H - 120 - h, w, h + 120);
    x += w + 8;
  }

  // LIVE badge
  ctx.fillStyle = '#e01020';
  ctx.beginPath();
  ctx.roundRect(30, 30, 96, 40, 8);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('LIVE', 52, 51);

  // channel label
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText('AIR-1 NEWS  ·  ROADSTER TRIAL', 145, 51);

  // lower-third banner
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(30, 200, CARD_W - 60, 78);
  ctx.fillStyle = '#e01020';
  ctx.fillRect(30, 200, 10, 78);

  const distance = result.distance.toLocaleString();
  ctx.fillStyle = '#0a0d14';
  ctx.font = 'bold 27px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(`SUSPECT CAR CLEARS ${distance} m BEFORE TIME RUNS OUT`, 56, 214, CARD_W - 100);
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillStyle = '#444a55';
  ctx.fillText('FAN-MADE GAME  ·  NOT AFFILIATED WITH TESLA OR SPACEX', 56, 248);

  // stats row
  const stats: [string, string][] = [
    ['SCORE', result.score.toLocaleString()],
    ['BEST', bestScore.toLocaleString()],
    ['FLIPS', String(result.breakdown.flips)],
    ['RINGS', String(result.breakdown.rings)],
    ['CRASHES', String(result.breakdown.crashes)],
  ];
  let sx = 30;
  ctx.textBaseline = 'top';
  for (const [label, value] of stats) {
    const w = 104;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(sx, 292, w - 8, 48, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillText(label, sx + 12, 300);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText(value, sx + 12, 314);
    sx += w;
  }

  const url = c.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `roadster-run-${result.distance}m.png`;
  a.click();
}

/** React version of the card shown on the game-over screen. */
export default function NewsCard({ result, bestScore }: NewsCardProps) {
  return (
    <div className="relative w-full max-w-[560px] mx-auto rounded-xl overflow-hidden border border-white/15 shadow-2xl bg-[#0a0d14] text-left">
      {/* skyline strip */}
      <div className="relative h-40 overflow-hidden">
        <div className="absolute inset-x-0 bottom-0 h-full flex items-end gap-1 px-2 opacity-70">
          {[62, 110, 84, 150, 96, 130, 74, 118, 90, 140].map((h, i) => (
            <div key={i} className="flex-1 bg-[#12161e] rounded-t-sm" style={{ height: `${h}px` }} />
          ))}
        </div>
        <div className="absolute top-4 left-4 flex items-center gap-3">
          <span className="px-3 py-1.5 rounded bg-red-600 text-white text-sm font-bold tracking-widest">LIVE</span>
          <span className="text-white/70 text-xs font-bold tracking-widest">AIR-1 NEWS · ROADSTER TRIAL</span>
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0d14] to-transparent" />
      </div>

      {/* lower third */}
      <div className="relative bg-white px-5 py-3.5">
        <div className="absolute left-0 top-0 bottom-0 w-2.5 bg-red-600" />
        <div className="text-[#0a0d14] font-bold text-base md:text-lg leading-snug">
          SUSPECT CAR CLEARS {result.distance.toLocaleString()} m BEFORE TIME RUNS OUT
        </div>
        <div className="text-[#5a6070] text-[10px] font-semibold tracking-wide mt-1">
          FAN-MADE GAME · NOT AFFILIATED WITH TESLA OR SPACEX
        </div>
      </div>

      {/* stats row */}
      <div className="flex gap-1.5 px-3 py-3">
        {(
          [
            ['SCORE', result.score.toLocaleString()],
            ['BEST', bestScore.toLocaleString()],
            ['FLIPS', String(result.breakdown.flips)],
            ['RINGS', String(result.breakdown.rings)],
            ['CRASHES', String(result.breakdown.crashes)],
          ] as [string, string][]
        ).map(([label, value]) => (
          <div key={label} className="flex-1 rounded-lg bg-white/8 border border-white/10 px-2 py-1.5 text-center">
            <div className="text-[8px] tracking-widest text-white/45 font-bold">{label}</div>
            <div className="text-sm md:text-base font-bold text-white tabular-nums">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
