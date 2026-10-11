import { h, clear } from './dom';
import { Hud } from './hud';
import { showMainMenu, showPauseMenu, showGameOver } from './menus';
import { openDashboard, type DashTab } from './dashboard';
import { openDialogue } from './dialoguePanel';
import { openTrade } from './trade';
import { openKeypad, openLockpick, openArcade } from './minigames';
import { openContainer, openNote, openStory, eventDialog, chooseWeaponSwap, openPerkChoice, openWorkbench } from './misc';
import { openCab } from './cab';
import { buildTrainInteractables } from './trainInteract';
import type { Game } from '../game/Game';
import type { NpcActor } from '../game/npcActor';
import type { ContainerSpec } from '../world/stationBuilder';
import type { MapNode } from '../state/types';
import type { Interactable } from '../game/types';
import type { ResourceId } from '../data/items';

export type ToastKind = 'info' | 'bon' | 'mauvais' | 'quete';

interface FloatText {
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  t: number;
}

export interface ModalOpts {
  title: string;
  icon?: string;
  className?: string;
  onClose?: () => void;
  /** Pas de fermeture par Échap/clic extérieur. */
  locked?: boolean;
}

export class UI {
  readonly root: HTMLElement;
  readonly hud: Hud;
  private toastsEl: HTMLDivElement;
  private floatLayer: HTMLDivElement;
  private bubbleLayer: HTMLDivElement;
  private modalLayer: HTMLDivElement;
  private fader: HTMLDivElement;
  private bannerLayer: HTMLDivElement;
  private floats: FloatText[] = [];
  private modalStack: { el: HTMLElement; opts: ModalOpts }[] = [];
  menuOpen = false;
  private bubbleEls = new Map<string, HTMLDivElement>();
  lastDashTab: DashTab = 'train';

  constructor(readonly game: Game, root: HTMLElement) {
    this.root = root;
    this.hud = new Hud(game, this);
    root.appendChild(this.hud.el);
    this.bubbleLayer = h('div', { class: 'hud' });
    this.floatLayer = h('div', { class: 'hud' });
    this.toastsEl = h('div', { class: 'toasts' });
    this.bannerLayer = h('div', { class: 'hud' });
    this.modalLayer = h('div', { class: 'hud' });
    this.fader = h('div', { class: 'fader' });
    root.append(this.bubbleLayer, this.floatLayer, this.toastsEl, this.bannerLayer, this.modalLayer, this.fader);
    // déverrouille l'audio au premier clic
    window.addEventListener('pointerdown', () => game.audio.unlock(), { once: false });
    window.addEventListener('keydown', () => game.audio.unlock(), { once: false });
  }

  /** Une fenêtre bloque le jeu (pause tactique). */
  get blocking(): boolean {
    return this.modalStack.length > 0 || this.menuOpen;
  }

  // ------------------------------------------------------------------ fenêtres

  openModal(content: HTMLElement | HTMLElement[], opts: ModalOpts, foot?: HTMLElement[]): HTMLElement {
    const head = h('div', { class: 'modal-head' }, h('h2', null, opts.title), opts.locked ? null : h('button', { class: 'btn small ghost', onclick: () => this.closeModal() }, '✕'));
    const body = h('div', { class: 'modal-body' }, content);
    const modal = h('div', { class: `modal interactive ${opts.className ?? ''}` }, head, body, foot && foot.length ? h('div', { class: 'modal-foot' }, foot) : null);
    const backdrop = h('div', { class: 'modal-backdrop' }, modal);
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop && !opts.locked) this.closeModal();
    });
    this.modalLayer.appendChild(backdrop);
    this.modalStack.push({ el: backdrop, opts });
    this.game.audio.play('uiOpen', { volume: 0.6 });
    this.game.input.clearAll();
    return body;
  }

  closeModal(): void {
    const m = this.modalStack.pop();
    if (!m) return;
    m.el.remove();
    m.opts.onClose?.();
    this.game.input.clearAll();
  }

  closeAll(): void {
    while (this.modalStack.length) this.closeModal();
  }

  /** Remplace le contenu de la fenêtre du dessus. */
  topBody(): HTMLElement | null {
    const m = this.modalStack[this.modalStack.length - 1];
    return (m?.el.querySelector('.modal-body') as HTMLElement) ?? null;
  }

  // ------------------------------------------------------------------ raccourcis

  handleHotkeys(): void {
    const g = this.game;
    const input = g.input;
    if (!g.state || g.state.over) return;
    if (input.keyPressed('Escape')) {
      if (this.modalStack.length) {
        const top = this.modalStack[this.modalStack.length - 1];
        if (!top.opts.locked) this.closeModal();
      } else if (!g.player.mounted) showPauseMenu(this, g);
      return;
    }
    if (this.modalStack.length) {
      if (input.keyPressed('Tab')) this.closeModal();
      return;
    }
    if (input.keyPressed('Tab')) return openDashboard(this, g, this.lastDashTab);
    if (input.keyPressed('i')) return openDashboard(this, g, 'inventaire');
    if (input.keyPressed('j')) return openDashboard(this, g, 'journal');
    if (input.keyPressed('m')) return openDashboard(this, g, 'carte');
    if (input.keyPressed('c')) return openDashboard(this, g, 'equipage');
    if (input.keyPressed('t')) return openDashboard(this, g, 'train');
    if (input.keyPressed('k')) return openDashboard(this, g, 'energie');
    if (input.keyPressed('p')) return g.state.player.pendingPerks > 0 ? openPerkChoice(this, g) : openDashboard(this, g, 'personnage');
    if (input.keyPressed('v')) this.cycleTimeScale();
    if (input.keyPressed('+', '=', 'Add')) this.throttle(1);
    if (input.keyPressed('-', 'Subtract', '6')) this.throttle(-1);
  }

  cycleTimeScale(): void {
    const g = this.game;
    if (g.inCombat) {
      g.timeScale = 1;
      this.toast('Impossible d\'accélérer le temps en plein combat.', 'mauvais');
      return;
    }
    g.timeScale = g.timeScale >= 3 ? 1 : g.timeScale + 1;
    this.toast(`Vitesse du temps : ×${g.timeScale}`, 'info');
  }

  /** Commande de vitesse : depuis la cabine ou via l'interphone si un chauffeur est à son poste. */
  throttle(delta: number, absolute?: number): void {
    const g = this.game;
    if (!g.isTravelling()) {
      this.toast('Le train est à quai : partez depuis le poste de conduite (locomotive).', 'info');
      return;
    }
    const inCab = g.player.onTrain && g.train.wagonAt(g.player.x) === 0;
    if (!inCab && !g.crewSystem.hasStoker()) {
      this.toast('Sans chauffeur à la locomotive, vous devez être en cabine pour régler la vitesse.', 'mauvais');
      return;
    }
    const block = g.events.canRestart();
    const st = g.state.train;
    const next = Math.max(0, Math.min(4, absolute ?? st.throttle + delta));
    if (next > 0 && block) {
      this.toast(block, 'mauvais');
      return;
    }
    if (next > 0 && !g.player.onTrain) {
      this.toast('Remontez à bord avant de repartir !', 'mauvais');
      return;
    }
    if (next > 0 && st.throttle === 0) g.audio.play('whistle', { volume: 0.5 });
    st.throttle = next;
    g.audio.play('ui');
  }

  // ------------------------------------------------------------------ notifications

  toast(text: string, kind: ToastKind = 'info'): void {
    const dur = Math.min(9000, 3200 + text.length * 35);
    // message identique déjà affiché : on le prolonge avec un compteur plutôt que de l'empiler
    const same = [...this.toastsEl.children].find((c) => (c as HTMLElement).dataset.text === text && !c.classList.contains('out')) as HTMLElement | undefined;
    if (same) {
      const n = Number(same.dataset.count ?? '1') + 1;
      same.dataset.count = String(n);
      same.textContent = `${text} ×${n}`;
      same.dataset.until = String(performance.now() + dur);
      return;
    }
    const el = h('div', { class: `toast ${kind}` }, text);
    el.dataset.text = text;
    el.dataset.until = String(performance.now() + dur);
    this.toastsEl.appendChild(el);
    while (this.toastsEl.children.length > 6) this.toastsEl.firstElementChild?.remove();
    const tick = () => {
      if (!el.isConnected) return;
      const left = Number(el.dataset.until) - performance.now();
      if (left > 0) {
        window.setTimeout(tick, Math.min(left, 1000));
        return;
      }
      el.classList.add('out');
      window.setTimeout(() => el.remove(), 450);
    };
    window.setTimeout(tick, dur);
  }

  floatText(x: number, y: number, z: number, text: string, color: string): void {
    if (this.floats.length > 40) {
      this.floats[0].el.remove();
      this.floats.shift();
    }
    const el = h('div', { class: 'float', style: `color:${color}` }, text);
    this.floatLayer.appendChild(el);
    this.floats.push({ el, x: x + (Math.random() - 0.5) * 0.5, y, z, t: 0 });
  }

  stationBanner(node: MapNode): void {
    const hostile = node.hostility === 'hostile' ? 'Zone hostile' : node.hostility === 'neutre' ? 'Zone neutre' : 'Gare sûre';
    const b = h('div', { class: 'banner' }, h('h1', null, node.name), h('div', { class: 'sub' }, hostile));
    this.bannerLayer.appendChild(b);
    window.setTimeout(() => b.remove(), 4600);
  }

  questBanner(title: string, desc: string): void {
    const b = h('div', { class: 'banner' }, h('div', { class: 'sub' }, 'Quête principale'), h('h1', { style: 'font-size:34px' }, title), h('p', null, desc));
    this.bannerLayer.appendChild(b);
    window.setTimeout(() => b.remove(), 4600);
  }

  fade(toBlack: boolean, done?: () => void): void {
    this.fader.classList.toggle('on', toBlack);
    if (done) window.setTimeout(done, 650);
  }

  // ------------------------------------------------------------------ mise à jour par frame

  update(dt: number): void {
    const g = this.game;
    this.hud.update(dt);
    const eng = g.engine;
    const W = eng.width;
    const H = eng.height;
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt;
      const p = eng.rig.project(f.x, f.y + f.t * 1.2, f.z, W, H);
      f.el.style.left = `${p.x}px`;
      f.el.style.top = `${p.y}px`;
      f.el.style.opacity = String(Math.max(0, 1 - f.t / 1.1));
      if (f.t > 1.1 || !p.visible) {
        f.el.remove();
        this.floats.splice(i, 1);
      }
    }
    // bulles de dialogue des PNJ
    const seen = new Set<string>();
    const actors: NpcActor[] = [...g.crew.values(), ...(g.level?.residents ?? [])];
    for (const a of actors) {
      if (!a.bubble || !a.alive) continue;
      if (Math.hypot(a.x - g.player.x, a.z - g.player.z) > 30) continue;
      seen.add(a.id);
      let el = this.bubbleEls.get(a.id);
      if (!el) {
        el = h('div', { class: 'bubble' });
        this.bubbleLayer.appendChild(el);
        this.bubbleEls.set(a.id, el);
      }
      if (el.textContent !== a.bubble) el.textContent = a.bubble;
      const p = eng.rig.project(a.x, a.y + 2.3, a.z, W, H);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.display = p.visible ? 'block' : 'none';
    }
    for (const [id, el] of this.bubbleEls) {
      if (!seen.has(id)) {
        el.remove();
        this.bubbleEls.delete(id);
      }
    }
  }

  clearOverlays(): void {
    for (const f of this.floats) f.el.remove();
    this.floats = [];
    for (const el of this.bubbleEls.values()) el.remove();
    this.bubbleEls.clear();
    clear(this.bannerLayer);
    this.hud.markers.clear();
  }

  // ------------------------------------------------------------------ délégations

  showMainMenu(): void {
    this.closeAll();
    this.clearOverlays();
    this.hud.setVisible(false);
    showMainMenu(this, this.game);
  }

  showGameOver(victory: boolean, reason: string, heritage: number): void {
    this.closeAll();
    showGameOver(this, this.game, victory, reason, heritage);
  }

  openDialogue(a: NpcActor): void {
    openDialogue(this, this.game, a);
  }

  openContainer(c: ContainerSpec, onClose: () => void): void {
    openContainer(this, this.game, c, onClose);
  }

  openTrade(node: MapNode, focus: ResourceId | null = null, onClose?: () => void): void {
    openTrade(this, this.game, node, focus, onClose);
  }

  openKeypad(code: string, known: string | null, hacker: boolean, onSuccess: () => void): void {
    openKeypad(this, this.game, code, known, hacker, onSuccess);
  }

  openLockpick(difficulty: number, cb: (ok: boolean) => void): void {
    openLockpick(this, this.game, difficulty, cb);
  }

  openArcade(): void {
    openArcade(this, this.game);
  }

  openNote(title: string, text: string): void {
    openNote(this, title, text);
  }

  openStory(title: string, paragraphs: string[], onClose?: () => void): void {
    openStory(this, title, paragraphs, onClose);
  }

  eventDialog(title: string, text: string, options: { text: string; action: () => void }[]): void {
    eventDialog(this, title, text, options);
  }

  chooseWeaponSwap(id: string, level: number): void {
    chooseWeaponSwap(this, this.game, id, level);
  }

  openCab(): void {
    openCab(this, this.game);
  }

  openWorkbench(): void {
    openWorkbench(this, this.game);
  }

  openDashboard(tab: DashTab): void {
    openDashboard(this, this.game, tab);
  }

  buildTrainInteractables(): Interactable[] {
    return buildTrainInteractables(this.game);
  }
}
