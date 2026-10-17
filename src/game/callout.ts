let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes rtc-callout-pop {
      0% { transform: translate(-50%, -50%) scale(1.7); opacity: 0; }
      18% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
      75% { opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(0.92); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

/** Big centered trick callout, e.g. "360° FLIP ×3". Auto-removes after ~1.2s. */
export function injectCallout(text: string, tone: 'good' | 'bad' = 'good') {
  injectStyles();
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `
    position: fixed;
    left: 50%;
    top: 34%;
    transform: translate(-50%, -50%);
    z-index: 60;
    pointer-events: none;
    font-family: inherit;
    font-size: clamp(28px, 6vw, 64px);
    font-weight: 800;
    letter-spacing: 0.08em;
    white-space: nowrap;
    color: ${tone === 'good' ? '#ffffff' : '#ff5560'};
    text-shadow: 0 0 24px ${tone === 'good' ? 'rgba(150,210,255,0.9)' : 'rgba(255,60,60,0.9)'}, 0 2px 10px rgba(0,0,0,0.6);
    animation: rtc-callout-pop 1.15s ease-out forwards;
  `;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 1250);
}
