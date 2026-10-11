import { h } from './dom';
import type { Game } from '../game/Game';

const STICK_R = 56;

/**
 * Commandes tactiles (téléphone, tablette) : joystick virtuel à gauche, visée et tir
 * au doigt sur le reste de l'écran, boutons d'action. Elles alimentent l'entrée
 * clavier/souris existante via des touches virtuelles.
 */
export class TouchControls {
  readonly el: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private stickId: number | null = null;
  private aimId: number | null = null;
  private ox = 0;
  private oy = 0;

  constructor(private game: Game, canvas: HTMLCanvasElement) {
    this.knob = h('div', { class: 'stick-knob' });
    this.base = h('div', { class: 'stick-base' }, this.knob);
    const actions = h('div', { class: 'tbtns' },
      this.button('E', 'Interagir (maintenir pour réparer)', 'KeyE', 'e', 'big'),
      this.button('⇆', 'Esquive', 'Space', ' '),
      this.button('R', 'Recharger', 'KeyR', 'r'),
      this.weaponButton(),
    );
    const menus = h('div', { class: 'tmenu' },
      this.button('☰', 'Tableau de bord', 'Tab', 'Tab'),
      this.button('+', 'Accélérer le train', 'Equal', '+'),
      this.button('−', 'Ralentir le train', 'Minus', '-'),
      this.button('II', 'Pause', 'Escape', 'Escape'),
    );
    const rotate = h('div', { class: 'rotate-hint' },
      h('div', { class: 'rotate-box' },
        h('div', { class: 'rotate-ico' }, '⟲'),
        h('div', null, 'Tournez votre appareil en mode paysage pour jouer confortablement.'),
      ),
    );
    const keep = h('button', { class: 'btn small', type: 'button' }, 'Jouer quand même') as HTMLButtonElement;
    keep.addEventListener('click', () => document.documentElement.classList.add('portrait-ok'));
    rotate.firstElementChild?.append(keep);
    this.el = h('div', { class: 'touch-ui' }, this.base, actions, menus, rotate);
    const opts = { passive: false } as AddEventListenerOptions;
    canvas.addEventListener('touchstart', this.onStart, opts);
    canvas.addEventListener('touchmove', this.onMove, opts);
    canvas.addEventListener('touchend', this.onEnd, opts);
    canvas.addEventListener('touchcancel', this.onEnd, opts);
  }

  private get input() {
    return this.game.input;
  }

  /** Active l'interface tactile à la première pression sur l'écran. */
  private activate(): void {
    if (this.input.touchMode) return;
    this.input.touchMode = true;
    document.documentElement.classList.add('touch');
  }

  private button(label: string, title: string, code: string, key: string, cls = ''): HTMLButtonElement {
    const b = h('button', { class: `tbtn ${cls}`, title, 'aria-label': title, type: 'button' }, label) as HTMLButtonElement;
    const press = (e: PointerEvent) => {
      e.preventDefault();
      this.activate();
      this.game.audio.unlock();
      b.classList.add('on');
      b.setPointerCapture?.(e.pointerId);
      this.input.virtualKey(code, key, true);
    };
    const release = () => {
      if (!b.classList.contains('on')) return;
      b.classList.remove('on');
      this.input.virtualKey(code, key, false);
    };
    b.addEventListener('pointerdown', press);
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
    return b;
  }

  /** Passe à l'arme suivante disponible. */
  private weaponButton(): HTMLButtonElement {
    const b = h('button', { class: 'tbtn', title: 'Arme suivante', 'aria-label': 'Arme suivante', type: 'button' }, '⟳') as HTMLButtonElement;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const st = this.game.state?.player;
      if (!st) return;
      for (let k = 1; k <= st.weapons.length; k++) {
        const i = (st.active + k) % st.weapons.length;
        if (st.weapons[i]) {
          this.input.virtualKey(`Digit${i + 1}`, String(i + 1), true);
          this.input.virtualKey(`Digit${i + 1}`, String(i + 1), false);
          break;
        }
      }
    });
    return b;
  }

  private onStart = (e: TouchEvent): void => {
    e.preventDefault();
    this.activate();
    this.game.audio.unlock();
    const w = window.innerWidth;
    for (const t of Array.from(e.changedTouches)) {
      if (this.stickId === null && t.clientX < w * 0.42) {
        this.stickId = t.identifier;
        this.ox = t.clientX;
        this.oy = t.clientY;
        this.base.style.left = `${t.clientX}px`;
        this.base.style.top = `${t.clientY}px`;
        this.base.classList.add('on');
        this.knob.style.transform = 'translate(-50%, -50%)';
      } else if (this.aimId === null) {
        this.aimId = t.identifier;
        this.input.virtualPointer(t.clientX, t.clientY, true);
      }
    }
  };

  private onMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        let dx = t.clientX - this.ox;
        let dy = t.clientY - this.oy;
        const d = Math.hypot(dx, dy);
        if (d > STICK_R) {
          dx = (dx / d) * STICK_R;
          dy = (dy / d) * STICK_R;
        }
        this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        const m = Math.min(1, d / STICK_R);
        // zone morte, puis vitesse proportionnelle à l'inclinaison (écran haut = nord)
        this.input.touchMove = m < 0.18 ? null : { x: (dx / STICK_R) * (m > 0.85 ? 1 / m : 1), z: (dy / STICK_R) * (m > 0.85 ? 1 / m : 1) };
      } else if (t.identifier === this.aimId) {
        this.input.virtualPointer(t.clientX, t.clientY, true);
      }
    }
  };

  private onEnd = (e: TouchEvent): void => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.input.touchMove = null;
        this.base.classList.remove('on');
      } else if (t.identifier === this.aimId) {
        this.aimId = null;
        this.input.virtualPointer(t.clientX, t.clientY, false);
      }
    }
  };
}
