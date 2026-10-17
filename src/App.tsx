import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleHelp, Pause, Play, Settings as SettingsIcon, Volume2, VolumeX, Home, RotateCcw } from 'lucide-react';
import Hud, { Callout, Popup } from './components/Hud';
import TouchControls from './components/TouchControls';
import SettingsPanel from './components/SettingsPanel';
import HowToPlay from './components/HowToPlay';
import Results from './components/Results';
import { Game } from './game/engine';
import { InputManager } from './game/input';
import { isCoarsePointer, loadSettings, saveSettings, Settings } from './game/settings';
import { sfx, startMusic, unlockAudio } from './game/audio';
import { GameEvents, GameOverResult, GameState, GameStats, HintId, PAINTS } from './game/types';

const EMPTY_STATS: GameStats = {
  score: 0,
  timeLeft: 35,
  energy: 1,
  nitro: 0.4,
  speed: 0,
  combo: 1,
  comboTimer: 0,
  progress: 0,
  distance: 0,
  airborne: false,
  altitude: 0,
  countdown: 3,
  stage: 0,
  boosting: false,
};

const HINTS: Record<HintId, [string, string]> = {
  drive: ['W to accelerate · A / D to steer', 'Auto-throttle on · drag the left side to steer'],
  fly: ['Tap SPACE to hop — hold it to fly', 'Tap THRUST to hop — hold it to fly'],
  ramp: ['Ramp ahead — hit it fast and thread the rings', 'Ramp ahead — hit it fast and thread the rings'],
  nitro: ['SHIFT fires nitro — rings and tricks refill it', 'Hold NITRO to boost — rings and tricks refill it'],
  roll: ['Press Q or E in the air for a barrel roll', 'Tap ROLL in the air for a barrel roll'],
  barrier: ['Barriers ahead — fly over or steer around', 'Barriers ahead — fly over or steer around'],
  gantry: ['Gantries overhead — fly under or above them', 'Gantries overhead — fly under or above them'],
  stunt: ['Stunt ramp ahead — it rolls you upside down. Stay centred, keep speed', 'Stunt ramp ahead — it rolls you upside down. Stay centred, keep speed'],
  kickflip: ['Press Q or E now to kickflip upright!', 'Tap ROLL now to kickflip upright!'],
};

const BEST_KEY = 'roadster-best-v2';

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const idRef = useRef(0);
  const stateRef = useRef<GameState>('loading');
  const [state, setState] = useState<GameState>('loading');
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [panel, setPanel] = useState<'settings' | 'help' | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [stats, setStats] = useState<GameStats>(EMPTY_STATS);
  const [popups, setPopups] = useState<Popup[]>([]);
  const [callouts, setCallouts] = useState<Callout[]>([]);
  const [hint, setHint] = useState<HintId | null>(null);
  const [result, setResult] = useState<GameOverResult | null>(null);
  const [best, setBest] = useState(() => Number(localStorage.getItem(BEST_KEY) ?? 0));
  const [newBest, setNewBest] = useState(false);
  const [touch, setTouch] = useState(isCoarsePointer);

  stateRef.current = state;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const input = new InputManager();
    input.attach();
    input.touchActive = isCoarsePointer();
    inputRef.current = input;

    const events: GameEvents = {
      onStats: setStats,
      onGameOver: (r) => {
        setResult(r);
        setState('gameover');
        setPaused(false);
        setHint(null);
        setBest((b) => {
          const isBest = r.score > b;
          setNewBest(isBest);
          if (isBest) localStorage.setItem(BEST_KEY, String(r.score));
          return Math.max(b, r.score);
        });
      },
      onPopup: (label, points, tone) => {
        const id = ++idRef.current;
        setPopups((p) => [...p.slice(-4), { id, label, points, tone }]);
        window.setTimeout(() => setPopups((p) => p.filter((x) => x.id !== id)), 1600);
      },
      onCallout: (text, tone) => {
        const id = ++idRef.current;
        setCallouts([{ id, text, tone }]);
        window.setTimeout(() => setCallouts((c) => c.filter((x) => x.id !== id)), 1400);
      },
      onStage: () => {},
      onHint: setHint,
    };
    const game = new Game(container, input, events, loadSettings());
    gameRef.current = game;
    game
      .init(setLoadProgress)
      .then(() => {
        if (gameRef.current === game) setState('menu');
      })
      .catch((e: unknown) => {
        console.error(e);
        setLoadError('Could not load the 3D assets. Check your connection and reload.');
      });

    input.onPause = () => {
      if (stateRef.current === 'playing') setPaused((p) => !p);
    };
    const onTouch = () => setTouch(true);
    window.addEventListener('touchstart', onTouch, { passive: true, once: true });
    return () => {
      window.removeEventListener('touchstart', onTouch);
      game.dispose();
      input.detach();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    gameRef.current?.setPaused(paused);
  }, [paused]);

  useEffect(() => {
    saveSettings(settings);
    gameRef.current?.applySettings(settings);
  }, [settings]);

  const start = useCallback(() => {
    unlockAudio();
    sfx.click();
    setResult(null);
    setPopups([]);
    setCallouts([]);
    setHint(null);
    setPanel(null);
    setPaused(false);
    setStats(EMPTY_STATS);
    if (inputRef.current) inputRef.current.touchActive = touch;
    gameRef.current?.startRun();
    setState('playing');
  }, [touch]);

  const toMenu = useCallback(() => {
    setPaused(false);
    setPanel(null);
    gameRef.current?.toShowroom();
    setState('menu');
  }, []);

  // keyboard shortcut to start from the menu / results
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((state === 'menu' || state === 'gameover') && !panel && e.code === 'Enter') start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, panel, start]);

  const firstInteraction = useCallback(() => {
    unlockAudio();
    startMusic(0);
  }, []);

  const toggleMute = () => setSettings((s) => ({ ...s, muted: !s.muted }));
  const playing = state === 'playing';
  const hintText = hint ? HINTS[hint][touch ? 1 : 0] : null;

  return (
    <div className="fixed inset-0 overflow-hidden bg-ink" onPointerDown={firstInteraction}>
      <div ref={containerRef} className="absolute inset-0" />

      {/* loading */}
      {state === 'loading' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-ink">
          <div className="font-title text-2xl font-black tracking-[0.2em] text-white sm:text-3xl">
            ROADSTER <span className="text-cyan-300">THRUSTER</span> TRIAL
          </div>
          {loadError ? (
            <div className="mt-6 max-w-xs text-center text-sm text-rose-300">{loadError}</div>
          ) : (
            <div className="mt-6 h-1 w-56 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-fuchsia-400 transition-[width]" style={{ width: `${Math.max(8, loadProgress * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {/* in-race UI */}
      {playing && <Hud stats={stats} popups={popups} callouts={callouts} hint={paused ? null : hintText} touch={touch} />}
      {playing && !paused && touch && inputRef.current && <TouchControls input={inputRef.current} />}
      {playing && (
        <div className="absolute right-4 top-3 z-30 flex gap-2 sm:right-6 sm:top-5">
          <button onClick={toggleMute} className="icon-btn" aria-label={settings.muted ? 'Unmute' : 'Mute'}>
            {settings.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button onClick={() => setPaused(true)} className="icon-btn" aria-label="Pause">
            <Pause className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* pause */}
      {playing && paused && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm">
          {panel === 'settings' ? (
            <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setPanel(null)} />
          ) : panel === 'help' ? (
            <HowToPlay touch={touch} onClose={() => setPanel(null)} />
          ) : (
            <div className="flex animate-fadeup flex-col items-center gap-3">
              <h2 className="mb-2 font-display text-4xl font-black tracking-[0.25em]">PAUSED</h2>
              <button onClick={() => setPaused(false)} className="btn-primary w-56" autoFocus>
                <Play className="h-4 w-4" /> RESUME
              </button>
              <button onClick={start} className="btn-ghost w-56">
                <RotateCcw className="h-3.5 w-3.5" /> RESTART
              </button>
              <div className="flex w-56 gap-2">
                <button onClick={() => setPanel('settings')} className="btn-ghost flex-1 px-2">
                  <SettingsIcon className="h-3.5 w-3.5" /> SETTINGS
                </button>
                <button onClick={() => setPanel('help')} className="btn-ghost flex-1 px-2">
                  <CircleHelp className="h-3.5 w-3.5" /> HELP
                </button>
              </div>
              <button onClick={toMenu} className="btn-ghost w-56">
                <Home className="h-3.5 w-3.5" /> QUIT TO GARAGE
              </button>
            </div>
          )}
        </div>
      )}

      {/* garage / title */}
      {state === 'menu' && (
        <div className="absolute inset-0 z-40 flex flex-col justify-between bg-gradient-to-r from-ink/85 via-ink/30 to-transparent p-5 sm:p-10 lg:p-14">
          <div className="max-w-md animate-fadeup">
            <div className="label text-cyan-200/70">Fan-made · Oct 2026 Roadster reveal tribute</div>
            <h1 className="mt-2 font-title text-4xl font-black leading-[0.95] tracking-tight sm:text-6xl">
              ROADSTER
              <span className="block bg-gradient-to-r from-cyan-200 via-cyan-300 to-fuchsia-400 bg-clip-text text-transparent">THRUSTER TRIAL</span>
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/65 sm:text-base">
              Drive it, then fly it. Three stages from desert dawn to a neon city. Thread rings, chain tricks and stick the landings before the clock runs out.
            </p>
          </div>

          <div className="max-w-md animate-fadeup space-y-5" style={{ animationDelay: '120ms' }}>
            <div>
              <div className="label mb-2">Paint</div>
              <div className="flex gap-2.5">
                {PAINTS.map((p) => (
                  <button
                    key={p.id}
                    title={p.name}
                    aria-label={p.name}
                    onClick={() => {
                      sfx.click();
                      setSettings((s) => ({ ...s, paint: p.id }));
                    }}
                    className={`h-8 w-8 rounded-full border-2 transition hover:scale-110 ${settings.paint === p.id ? 'scale-110 border-cyan-200 shadow-[0_0_16px_rgba(56,216,255,.7)]' : 'border-white/25'}`}
                    style={{ background: `radial-gradient(circle at 35% 30%, #ffffff55, #${p.hex.toString(16).padStart(6, '0')} 55%)` }}
                  />
                ))}
              </div>
              <div className="mt-1.5 text-xs text-white/45">{PAINTS.find((p) => p.id === settings.paint)?.name}</div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={start} className="btn-primary px-10">
                <Play className="h-4 w-4 fill-current" /> START RUN
              </button>
              <button onClick={() => setPanel(panel === 'help' ? null : 'help')} className="icon-btn h-11 w-11" aria-label="How to play">
                <CircleHelp className="h-5 w-5" />
              </button>
              <button onClick={() => setPanel(panel === 'settings' ? null : 'settings')} className="icon-btn h-11 w-11" aria-label="Settings">
                <SettingsIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="flex items-center gap-4 text-xs text-white/45">
              {best > 0 && (
                <span>
                  Best <span className="font-display font-bold text-cyan-200">{best.toLocaleString()}</span>
                </span>
              )}
              {!touch && <span>Press ENTER to start</span>}
            </div>
          </div>
          {panel && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm" onClick={() => setPanel(null)}>
              <div onClick={(e) => e.stopPropagation()} className="flex w-full justify-center">
                {panel === 'settings' ? (
                  <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setPanel(null)} />
                ) : (
                  <HowToPlay touch={touch} onClose={() => setPanel(null)} />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* results */}
      {state === 'gameover' && result && (
        <div className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-ink/60 p-4 backdrop-blur-sm">
          <Results result={result} best={best} newBest={newBest} onRetry={start} onMenu={toMenu} />
        </div>
      )}
    </div>
  );
}

export default App;
