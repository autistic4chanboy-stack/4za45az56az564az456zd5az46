import './ui/style.css';
import { Game } from './game/Game';
import { resumeGame } from './ui/menus';
import type { GameState } from './state/types';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

function showFatal(err: unknown): void {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  console.error(err);
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:12px;bottom:12px;max-width:70vw;max-height:40vh;overflow:auto;background:#2a0d0a;color:#ffb0a2;padding:10px;border:1px solid #7a3424;border-radius:6px;font-size:11px;z-index:9999;pointer-events:auto;white-space:pre-wrap';
  box.textContent = `Erreur : ${msg}`;
  document.body.appendChild(box);
  window.setTimeout(() => box.remove(), 15000);
}

window.addEventListener('error', (e) => showFatal(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason));

/** Rechargement à chaud fourni par certains hébergeurs : la partie en cours survit à une mise à jour de la page. */
interface HotApi {
  data?: unknown;
  snapshot?: (fn: () => unknown) => void;
  ready?: (start: (data: unknown) => void) => void;
}
const hot = (window as unknown as { claude?: { hot?: HotApi } }).claude?.hot;

function boot(data: unknown): void {
  try {
    const game = new Game(canvas, uiRoot);
    (window as unknown as { __game: Game }).__game = game;
    game.start();
    const saved = (data as { state?: GameState } | null | undefined)?.state;
    if (saved && !saved.over) resumeGame(game.ui, game, saved);
    hot?.snapshot?.(() => (game.state && !game.state.over ? { state: game.state } : {}));
  } catch (e) {
    showFatal(e);
  }
}

if (hot?.ready) hot.ready(boot);
else boot(hot?.data ?? {});
