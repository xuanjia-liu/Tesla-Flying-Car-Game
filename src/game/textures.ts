import * as THREE from 'three';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function finish(c: HTMLCanvasElement, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, light: number, dark: number) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() < 0.5 ? light : dark;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.05 + Math.random() * 0.08})`;
    const s = 1 + Math.random() * 2.5;
    ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

/**
 * Road texture covering the full deck between the rails (64 m wide, 32 m per repeat).
 * Returns colour + emissive line mask so lane lines glow at night.
 */
export function roadTextures() {
  const W = 512;
  const H = 256;
  const pxPerM = W / 64;
  const [c, ctx] = canvas(W, H);
  const [e, ectx] = canvas(W, H);
  ctx.fillStyle = '#2b2d33';
  ctx.fillRect(0, 0, W, H);
  // shoulders
  ctx.fillStyle = '#3a3a3e';
  ctx.fillRect(0, 0, (32 - 15.5) * pxPerM, H);
  ctx.fillRect(W - (32 - 15.5) * pxPerM, 0, (32 - 15.5) * pxPerM, H);
  speckle(ctx, W, H, 9000, 200, 0);
  // tyre wear in each lane
  for (const lane of [-11.25, -3.75, 3.75, 11.25]) {
    const x = (32 + lane) * pxPerM;
    const g = ctx.createLinearGradient(x - 20, 0, x + 20, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 20, 0, 40, H);
  }
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, H);

  const line = (xm: number, width: number, color: string, glow: string, dash?: [number, number]) => {
    const x = (32 + xm) * pxPerM - (width * pxPerM) / 2;
    const w = width * pxPerM;
    const draw = (g: CanvasRenderingContext2D, col: string) => {
      g.fillStyle = col;
      if (!dash) g.fillRect(x, 0, w, H);
      else for (let y = 0; y < H; y += (dash[0] + dash[1]) * pxPerM) g.fillRect(x, y, w, dash[0] * pxPerM);
    };
    draw(ctx, color);
    draw(ectx, glow);
  };
  line(-15, 0.35, '#e8e8e8', '#9aa0a8');
  line(15, 0.35, '#e8e8e8', '#9aa0a8');
  line(-7.5, 0.25, '#d8d8d8', '#6a7078', [6, 10]);
  line(7.5, 0.25, '#d8d8d8', '#6a7078', [6, 10]);
  line(-0.25, 0.18, '#59d8ff', '#59d8ff');
  line(0.25, 0.18, '#59d8ff', '#59d8ff');
  // hatched shoulders near the rails
  ctx.fillStyle = 'rgba(240,190,40,0.55)';
  for (let y = -H; y < H * 2; y += 4 * pxPerM) {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.beginPath();
      const x0 = side < 0 ? 0 : W - 1.5 * pxPerM;
      ctx.rect(x0, 0, 1.5 * pxPerM, H);
      ctx.clip();
      ctx.translate(x0, y);
      ctx.rotate(-0.6 * side);
      ctx.fillRect(-20, 0, 60, 0.6 * pxPerM);
      ctx.restore();
    }
  }
  const map = finish(c);
  const emissive = finish(e);
  return { map, emissive };
}

export function groundTexture(base: string, light: number, dark: number, n = 14000) {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 20 + Math.random() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const v = Math.random() < 0.5 ? 255 : 0;
    g.addColorStop(0, `rgba(${v},${v},${v},0.05)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  speckle(ctx, 256, 256, n, light, dark);
  return finish(c);
}

export function hazardTexture() {
  const [c, ctx] = canvas(128, 32);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, 128, 32);
  ctx.fillStyle = '#f5c400';
  for (let x = -32; x < 160; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 32);
    ctx.lineTo(x + 16, 32);
    ctx.lineTo(x + 32, 0);
    ctx.lineTo(x + 16, 0);
    ctx.fill();
  }
  return finish(c);
}

export function bannerTexture(text: string, sub: string, accent: string) {
  const [c, ctx] = canvas(1024, 128);
  ctx.fillStyle = '#07080c';
  ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 1024, 6);
  ctx.fillRect(0, 122, 1024, 6);
  ctx.font = '900 64px Orbitron, "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 512, sub ? 54 : 66);
  if (sub) {
    ctx.font = '700 26px Orbitron, "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = accent;
    ctx.fillText(sub, 512, 102);
  }
  return finish(c, true, false);
}

export function checkerTexture() {
  const [c, ctx] = canvas(256, 32);
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  return finish(c);
}
