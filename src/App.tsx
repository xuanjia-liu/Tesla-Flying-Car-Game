import { useCallback, useEffect, useRef, useState } from 'react';
import Hud, { Popup } from './components/Hud';
import TouchControls from './components/TouchControls';
import NewsCard, { saveNewsCard } from './components/NewsCard';
import { Game } from './game/engine';
import { InputManager } from './game/input';
import { GameEvents, GameOverResult, GameStats, GameState } from './game/types';
import { unlockAudio, setMuted, isMuted, engineStop } from './game/audio';

const EMPTY_STATS: GameStats = {
  score: 0,
  timeLeft: 60,
  tank: 1,
  speed: 0,
  combo: 1,
  distance: 0,
  airborne: false,
  countdown: 0,
};

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const popupId = useRef(0);
  const [gameState, setGameState] = useState<GameState>('menu');
  const [paused, setPaused] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const [stats, setStats] = useState<GameStats>(EMPTY_STATS);
  const [popups, setPopups] = useState<Popup[]>([]);
  const [result, setResult] = useState<GameOverResult | null>(null);
  const [bestScore, setBestScore] = useState(() => Number(localStorage.getItem('roadster-best') ?? 0));
  const [showTutorial, setShowTutorial] = useState(() => !localStorage.getItem('roadster-tutored'));

  const pushPopup = useCallback((label: string, points: number, tone: 'good' | 'bad') => {
    const id = ++popupId.current;
    setPopups((p) => [...p.slice(-4), { id, label, points, tone }]);
    window.setTimeout(() => setPopups((p) => p.filter((x) => x.id !== id)), 2200);
  }, []);

  const pushToast = useCallback((text: string, tone: 'good' | 'bad') => {
    pushPopup(text, 0, tone);
  }, [pushPopup]);

  const startGame = useCallback(() => {
    unlockAudio();
    setShowTutorial(false);
    localStorage.setItem('roadster-tutored', '1');

    if (!containerRef.current) return;

    if (!inputRef.current) {
      const im = new InputManager();
      im.attach();
      inputRef.current = im;
    }

    if (!gameRef.current) {
      const events: GameEvents = {
        onStats: setStats,
        onGameOver: (r) => {
          setResult(r);
          setGameState('gameover');
          setPaused(false);
          setBestScore((b) => {
            const nb = Math.max(b, r.score);
            localStorage.setItem('roadster-best', String(nb));
            return nb;
          });
        },
        onToast: pushToast,
        onPopup: pushPopup,
      };
      gameRef.current = new Game(containerRef.current, inputRef.current, events);
    }

    setResult(null);
    setPopups([]);
    gameRef.current.startRun();
    setStats(EMPTY_STATS);
    setPaused(false);
    setGameState('playing');
  }, [pushPopup, pushToast]);

  // pause handling between UI and engine
  useEffect(() => {
    if (gameRef.current && gameRef.current.isPaused() !== paused) {
      gameRef.current.setPaused(paused);
    }
  }, [paused]);

  // Esc/P while playing toggles pause (the engine forwards the key event)
  useEffect(() => {
    if (gameState !== 'playing') return;
    const iv = window.setInterval(() => {
      if (inputRef.current?.consumePause()) setPaused((p) => !p);
    }, 80);
    return () => window.clearInterval(iv);
  }, [gameState]);

  useEffect(() => {
    return () => {
      gameRef.current?.dispose();
      inputRef.current?.detach();
    };
  }, []);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  }, [muted]);

  const mph = Math.round(stats.speed * 2.237);
  const gameActive = gameState === 'playing';

  return (
    <div
      className={`fixed inset-0 bg-[#1a1410] overflow-hidden font-sans ${gameActive && !paused ? 'cursor-none' : ''}`}
    >
      {/* 3D canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {gameActive && <Hud stats={stats} popups={popups} />}
      {gameActive && !paused && inputRef.current && <TouchControls input={inputRef.current} />}

      {/* mute + pause buttons */}
      {gameActive && (
        <div className="absolute top-3 left-1/2 translate-x-24 md:top-6 z-30 flex gap-2">
          <button
            onClick={toggleMute}
            className="pointer-events-auto w-9 h-9 rounded-full bg-black/40 border border-white/25 text-white/80 backdrop-blur flex items-center justify-center text-sm hover:bg-black/60"
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button
            onClick={() => setPaused(true)}
            className="pointer-events-auto w-9 h-9 rounded-full bg-black/40 border border-white/25 text-white/80 backdrop-blur flex items-center justify-center text-sm hover:bg-black/60"
            aria-label="Pause"
          >
            II
          </button>
        </div>
      )}

      {/* pause overlay */}
      {gameActive && paused && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="text-center">
            <h2 className="text-4xl font-bold text-white tracking-widest mb-6">PAUSED</h2>
            <div className="flex flex-col gap-3 items-center">
              <button
                onClick={() => setPaused(false)}
                className="px-8 py-3 rounded-full bg-sky-500 hover:bg-sky-400 text-white font-bold tracking-widest text-sm"
              >
                RESUME
              </button>
              <button
                onClick={() => {
                  setPaused(false);
                  setGameState('menu');
                  engineStop();
                }}
                className="px-8 py-3 rounded-full bg-white/10 border border-white/25 text-white/80 font-bold tracking-widest text-sm hover:bg-white/20"
              >
                QUIT TO MENU
              </button>
            </div>
          </div>
        </div>
      )}

      {/* menu / gameover overlay */}
      {!gameActive && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-gradient-to-b from-black/75 via-black/55 to-black/85 backdrop-blur-sm overflow-y-auto py-8">
          <div className="text-center px-6 max-w-lg">
            <div className="text-[11px] tracking-[0.4em] text-white/40 mb-3">
              A FAN-MADE TRIBUTE · BASED ON THE OCTOBER 2026 ROADSTER REVEAL
            </div>
            <h1 className="text-5xl md:text-7xl font-bold text-white tracking-tight leading-[1.05]">
              ROADSTER
              <span className="block text-sky-400">THRUSTER TRIAL</span>
            </h1>

            {gameState === 'gameover' && result && (
              <>
                <NewsCard result={result} bestScore={bestScore} />
                <button
                  onClick={() => saveNewsCard(result, bestScore)}
                  className="mt-3 px-5 py-2 rounded-full bg-white/10 border border-white/25 text-white/80 text-xs font-bold tracking-widest hover:bg-white/20 transition"
                >
                  SAVE CARD AS IMAGE
                </button>
              </>
            )}

            {gameState === 'menu' && (
              <p className="mt-5 text-white/60 text-sm md:text-base leading-relaxed">
                Ten nozzles. Ultra high-pressure air tanks. Sub-one-second 0-60.
                <br />
                Hop, flip, and stick the landings before the clock hits zero.
              </p>
            )}
            {gameState === 'menu' && bestScore > 0 && (
              <div className="mt-4 text-white/50 text-sm">
                Personal best: <span className="text-sky-300 font-bold tabular-nums">{bestScore}</span>
              </div>
            )}

            <button
              onClick={startGame}
              className="mt-7 px-10 py-4 rounded-full bg-sky-500 hover:bg-sky-400 active:scale-95 transition text-white font-bold tracking-[0.2em] text-sm shadow-lg shadow-sky-500/30"
            >
              {gameState === 'gameover' ? 'RUN IT AGAIN' : 'START RUN'}
            </button>

            <div className="mt-6 text-[11px] text-white/35 leading-relaxed hidden md:block">
              W/↑ drive · A/D steer · SPACE hop · SPACE again mid-air: cushion jets · hold SPACE: hover · J flip · SHIFT boost ·
              ESC pause
            </div>
            <div className="mt-6 text-[11px] text-white/35 leading-relaxed md:hidden">
              On-screen buttons appear during the run.
            </div>
          </div>
        </div>
      )}

      {/* first-play tutorial */}
      {showTutorial && gameState === 'menu' && (
        <div className="absolute bottom-6 inset-x-0 z-50 flex justify-center px-4">
          <div className="pointer-events-auto max-w-md w-full rounded-xl bg-white/10 border border-white/20 backdrop-blur p-4 text-left">
            <div className="text-[10px] tracking-[0.3em] text-sky-300 mb-2">HOW TO FLY A ROADSTER</div>
            <ul className="text-xs text-white/70 space-y-1.5 leading-relaxed">
              <li>• SPACE to thruster-hop over the striped car rows. Hold it to hover.</li>
              <li>• Tap SPACE again just before landing — the cushion jets save you.</li>
              <li>• J mid-air to flip. Clean flip landings trigger slow-mo and big points.</li>
              <li>• Blue rings and striped pads add time. Crashes cost 8 seconds.</li>
              <li>• The dark green bar zone is your landing reserve — hovering never eats it.</li>
            </ul>
            <button
              onClick={() => setShowTutorial(false)}
              className="mt-3 text-[11px] tracking-widest text-white/50 hover:text-white transition"
            >
              GOT IT
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
