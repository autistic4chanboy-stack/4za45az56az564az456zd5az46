import type { GameMode, GameState } from './types';
import { SAVE_VERSION } from './newGame';

/** Sauvegardes locales (localStorage) — aucun serveur requis. */

const KEY = (mode: GameMode) => `rdc_save_${mode}_v${SAVE_VERSION}`;

export interface SaveSummary {
  mode: GameMode;
  station: string;
  day: number;
  time: number;
  savedAt: number;
  difficulty: string;
}

function storage(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = '__rdc_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function saveGame(state: GameState, stationName: string): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const payload = { state, summary: { mode: state.mode, station: stationName, day: Math.floor(state.time / 1440) + 1, time: state.time, savedAt: Date.now(), difficulty: state.difficulty } satisfies SaveSummary };
    s.setItem(KEY(state.mode), JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(mode: GameMode): GameState | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY(mode));
    if (!raw) return null;
    const data = JSON.parse(raw) as { state: GameState };
    if (data.state.version !== SAVE_VERSION) return null;
    return data.state;
  } catch {
    return null;
  }
}

export function saveSummary(mode: GameMode): SaveSummary | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY(mode));
    if (!raw) return null;
    return (JSON.parse(raw) as { summary: SaveSummary }).summary;
  } catch {
    return null;
  }
}

export function deleteSave(mode: GameMode): void {
  storage()?.removeItem(KEY(mode));
}

export function hasStorage(): boolean {
  return storage() !== null;
}

/** Export/import manuel (fichier JSON) pour sauvegarder hors du navigateur. */
export function exportSave(state: GameState): string {
  return JSON.stringify({ rdc: SAVE_VERSION, state });
}

export function importSave(text: string): GameState | null {
  try {
    const data = JSON.parse(text) as { rdc: number; state: GameState };
    if (data.rdc !== SAVE_VERSION || !data.state?.train) return null;
    return data.state;
  } catch {
    return null;
  }
}

export interface Settings {
  master: number;
  sfx: number;
  music: number;
  ambient: number;
  quality: 'basse' | 'moyenne' | 'haute';
  shadows: boolean;
  showFps: boolean;
  tutorial: boolean;
  screenShake: boolean;
  /** Style graphique : haute définition lissée ou pixel art. */
  style: 'hd' | 'pixel';
  /** Haute définition : fraction de la résolution de l'écran (1 = pleine). */
  resolution: number;
  /** Pixel art : taille d'un pixel artistique (0 = automatique). */
  pixelSize: number;
  /** Rendu des couleurs : paliers (DA), palette stricte tramée, ou couleurs libres. */
  palette: 'paliers' | 'stricte' | 'aucune';
  outlines: boolean;
  bloom: boolean;
}

const SETTINGS_KEY = 'rdc_settings_v1';

export function loadSettings(): Settings {
  const def: Settings = { master: 0.8, sfx: 0.9, music: 0.4, ambient: 0.6, quality: 'haute', shadows: true, showFps: false, tutorial: true, screenShake: true, style: 'hd', resolution: 1, pixelSize: 0, palette: 'paliers', outlines: true, bloom: true };
  try {
    const raw = storage()?.getItem(SETTINGS_KEY);
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return def;
}

export function saveSettings(s: Settings): void {
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
