import { GameOverResult } from '@/game/types';

const CARD_W = 640;
const CARD_H = 360;

/** Draws a "breaking news" result card to an offscreen canvas and downloads it as PNG. */
export function saveNewsCard(result: GameOverResult, bestScore: number) {
  const c = document.createElement('canvas');
  c.width = CARD_W * 2;
  c.height = CARD_H * 2;
  const ctx = c.getContext('2d')!;
  ctx.scale(2, 2);

  const grad = ctx.createLinearGradient(0, 0, 0, CARD_H);
  grad.addColorStop(0, '#120c2a');
  grad.addColorStop(1, '#1d1236');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let x = 0; x < CARD_W; ) {
    const w = 40 + rand() * 70;
    const h = 60 + rand() * 140;
    ctx.fillStyle = '#0d0a1e';
    ctx.fillRect(x, CARD_H - 120 - h, w, h + 120);
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,63,176,0.5)' : 'rgba(56,216,255,0.5)';
    ctx.fillRect(x + 4, CARD_H - 120 - h + 10, 3, h * 0.6);
    x += w + 8;
  }

  ctx.fillStyle = '#e01020';
  ctx.beginPath();
  ctx.roundRect(30, 30, 96, 40, 8);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('LIVE', 52, 51);
  ctx.font = 'bold 16px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('AIR-1 NEWS  ·  ROADSTER THRUSTER TRIAL', 145, 51);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(30, 200, CARD_W - 60, 78);
  ctx.fillStyle = '#e01020';
  ctx.fillRect(30, 200, 10, 78);
  ctx.fillStyle = '#0a0d14';
  ctx.font = 'bold 26px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'top';
  const headline = result.finished
    ? `FLYING ROADSTER CLEARS THE COURSE — GRADE ${result.grade}`
    : `FLYING ROADSTER STOPPED AFTER ${result.distance.toLocaleString()} m`;
  ctx.fillText(headline, 56, 214, CARD_W - 100);
  ctx.font = '600 14px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#444a55';
  ctx.fillText('FAN-MADE GAME  ·  NOT AFFILIATED WITH TESLA OR SPACEX', 56, 248);

  const stats: [string, string][] = [
    ['SCORE', result.score.toLocaleString()],
    ['BEST', bestScore.toLocaleString()],
    ['RINGS', `${result.breakdown.rings}/${result.breakdown.ringsTotal}`],
    ['TRICKS', String(result.breakdown.tricks)],
    ['TOP MPH', String(result.breakdown.topSpeed)],
  ];
  let sx = 30;
  for (const [label, value] of stats) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(sx, 292, 96, 48, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 10px Inter, system-ui, sans-serif';
    ctx.fillText(label, sx + 12, 300);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px Inter, system-ui, sans-serif';
    ctx.fillText(value, sx + 12, 314);
    sx += 116;
  }

  const a = document.createElement('a');
  a.href = c.toDataURL('image/png');
  a.download = `roadster-run-${result.score}.png`;
  a.click();
}
