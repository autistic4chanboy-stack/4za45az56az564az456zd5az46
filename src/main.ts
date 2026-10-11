import './ui/style.css';
import { Game } from './game/Game';

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

try {
  const game = new Game(canvas, uiRoot);
  (window as unknown as { __game: Game }).__game = game;
  game.start();
} catch (e) {
  showFatal(e);
}
