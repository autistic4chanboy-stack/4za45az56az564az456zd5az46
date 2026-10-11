import { h } from './dom';
import type { Game } from '../game/Game';
import type { NpcActor } from '../game/npcActor';

const MAX_ARROWS = 14;
const MAX_BARS = 24;
const EDGE = 34;

/**
 * Repères projetés à l'écran : flèches vers les ennemis hors champ, barres de vie
 * des ennemis blessés et icônes au-dessus des PNJ (quête « ! », marchand).
 */
export class WorldMarkers {
  readonly el: HTMLDivElement;
  private arrows: HTMLDivElement[] = [];
  private bars: { el: HTMLDivElement; fill: HTMLDivElement }[] = [];
  private npcEls = new Map<string, HTMLDivElement>();
  private npcKinds = new Map<string, string | null>();
  private npcT = 0;

  constructor(private game: Game) {
    this.el = h('div', { class: 'hud markers' });
  }

  update(dt: number): void {
    const g = this.game;
    const lv = g.level;
    const eng = g.engine;
    const W = eng.width;
    const H = eng.height;
    const p = g.player;
    let na = 0;
    let nb = 0;
    if (lv && p) {
      const travel = !!g.travelLevel();
      for (const e of lv.enemies) {
        if (!e.alive || (e.hiddenFromTurrets && e.ai === 'burrowed')) continue;
        if (!travel && !e.alerted && e.def.id !== 'sentinelle') continue;
        const d = Math.hypot(e.x - p.x, e.z - p.z);
        if (d > (travel ? 130 : 60)) continue;
        const s = eng.rig.project(e.x, e.height + 0.6, e.z, W, H);
        const onScreen = s.visible && s.x > EDGE && s.x < W - EDGE && s.y > EDGE && s.y < H - EDGE;
        const boss = e.maxHp >= 900;
        if (onScreen) {
          if ((e.hp < e.maxHp || boss) && nb < MAX_BARS) {
            const b = this.bar(nb++);
            b.el.style.display = 'block';
            b.el.style.left = `${s.x}px`;
            b.el.style.top = `${s.y}px`;
            b.el.classList.toggle('boss', boss);
            b.fill.style.width = `${Math.max(0, (e.hp / e.maxHp) * 100)}%`;
          }
          continue;
        }
        if (na >= MAX_ARROWS) continue;
        const dx = s.x - W / 2;
        const dy = s.y - H / 2;
        const k = Math.min((W / 2 - EDGE) / Math.max(1e-3, Math.abs(dx)), (H / 2 - EDGE) / Math.max(1e-3, Math.abs(dy)));
        const a = this.arrow(na++);
        a.style.display = 'block';
        a.style.left = `${W / 2 + dx * k}px`;
        a.style.top = `${H / 2 + dy * k}px`;
        a.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(dy, dx)}rad)`;
        a.style.opacity = String(Math.max(0.35, 1 - d / 140));
        a.classList.toggle('boss', boss);
      }
    }
    for (let i = na; i < this.arrows.length; i++) this.arrows[i].style.display = 'none';
    for (let i = nb; i < this.bars.length; i++) this.bars[i].el.style.display = 'none';
    this.updateNpcs(dt, W, H);
  }

  private arrow(i: number): HTMLDivElement {
    while (this.arrows.length <= i) {
      const a = h('div', { class: 'enemy-arrow' });
      this.el.appendChild(a);
      this.arrows.push(a);
    }
    return this.arrows[i];
  }

  private bar(i: number): { el: HTMLDivElement; fill: HTMLDivElement } {
    while (this.bars.length <= i) {
      const fill = h('div', { class: 'fill' });
      const el = h('div', { class: 'enemy-bar' }, fill);
      this.el.appendChild(el);
      this.bars.push({ el, fill });
    }
    return this.bars[i];
  }

  /** Type de repère d'un PNJ : quête principale/secondaire, recrutement possible, marchand. */
  private npcKind(a: NpcActor): string | null {
    const g = this.game;
    const n = a.data;
    if (n.status === 'mort' || n.status === 'prisonnier') return null;
    if (n.dialogue && g.story.wantsTalk(n)) return 'quete';
    if (n.status === 'resident') {
      if (g.quests.hasOffer(n)) return 'quete';
      if (n.trader) return 'marchand';
    }
    return null;
  }

  private updateNpcs(dt: number, W: number, H: number): void {
    const g = this.game;
    const p = g.player;
    const actors: NpcActor[] = [...(g.level?.residents ?? []), ...g.crew.values()];
    this.npcT -= dt;
    if (this.npcT <= 0) {
      this.npcT = 0.5;
      this.npcKinds.clear();
      if (p) for (const a of actors) if (a.alive && Math.hypot(a.x - p.x, a.z - p.z) < 40) this.npcKinds.set(a.id, this.npcKind(a));
    }
    const seen = new Set<string>();
    if (p) {
      for (const a of actors) {
        const kind = this.npcKinds.get(a.id);
        if (!kind || !a.alive || a.bubble) continue;
        const s = g.engine.rig.project(a.x, a.y + 2.35, a.z, W, H);
        if (!s.visible) continue;
        seen.add(a.id);
        let el = this.npcEls.get(a.id);
        if (!el) {
          el = h('div', { class: 'npc-mark' });
          this.el.appendChild(el);
          this.npcEls.set(a.id, el);
        }
        if (el.dataset.kind !== kind) {
          el.dataset.kind = kind;
          el.className = `npc-mark ${kind}`;
          el.textContent = kind === 'quete' ? '!' : '¤';
          el.title = kind === 'quete' ? 'Quête disponible' : 'Marchand';
        }
        el.style.left = `${s.x}px`;
        el.style.top = `${s.y}px`;
      }
    }
    for (const [id, el] of this.npcEls) {
      if (!seen.has(id)) {
        el.remove();
        this.npcEls.delete(id);
      }
    }
  }

  clear(): void {
    for (const a of this.arrows) a.style.display = 'none';
    for (const b of this.bars) b.el.style.display = 'none';
    for (const el of this.npcEls.values()) el.remove();
    this.npcEls.clear();
    this.npcKinds.clear();
  }
}
