/**
 * Entrées clavier/souris.
 * - Les déplacements utilisent la position physique des touches (event.code) :
 *   WASD sur QWERTY = ZQSD sur AZERTY automatiquement.
 * - Les raccourcis (inventaire, carte…) utilisent le caractère (event.key).
 */

type KeyboardLayoutMap = { get(code: string): string | undefined };

export class Input {
  private down = new Set<string>();
  private pressedCodes = new Set<string>();
  private releasedCodes = new Set<string>();
  private pressedKeys = new Set<string>();
  private mouseDown = new Set<number>();
  private mousePressed = new Set<number>();
  private mouseReleased = new Set<number>();
  private layout: KeyboardLayoutMap | null = null;

  mouseX = 0;
  mouseY = 0;
  wheel = 0;
  /** Vrai quand la souris survole un élément d'interface (pas le canvas). */
  overUI = false;
  enabled = true;
  /** Déplacement analogique fourni par le joystick tactile (prioritaire sur le clavier). */
  touchMove: { x: number; z: number } | null = null;
  /** Vrai dès qu'une commande tactile a été utilisée. */
  touchMode = false;

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.clearAll());
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.overUI = e.target !== this.canvas;
    });
    window.addEventListener('mousedown', (e) => {
      if (e.target !== this.canvas) return;
      this.mouseDown.add(e.button);
      this.mousePressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      if (this.mouseDown.has(e.button)) this.mouseReleased.add(e.button);
      this.mouseDown.delete(e.button);
    });
    canvas.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    const nav = navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<KeyboardLayoutMap> } };
    nav.keyboard?.getLayoutMap?.().then((m) => (this.layout = m)).catch(() => undefined);
  }

  private isTyping(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.isTyping(e)) return;
    if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1'].includes(e.code)) e.preventDefault();
    if (!this.down.has(e.code)) this.pressedCodes.add(e.code);
    this.down.add(e.code);
    if (!e.repeat) this.pressedKeys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
    this.releasedCodes.add(e.code);
  };

  clearAll(): void {
    this.down.clear();
    this.mouseDown.clear();
    this.touchMove = null;
    this.pressedCodes.clear();
    this.pressedKeys.clear();
  }

  /** À appeler en fin de frame. */
  endFrame(): void {
    this.pressedCodes.clear();
    this.releasedCodes.clear();
    this.pressedKeys.clear();
    this.mousePressed.clear();
    this.mouseReleased.clear();
    this.wheel = 0;
  }

  isDown(code: string): boolean {
    return this.enabled && this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.enabled && this.pressedCodes.has(code);
  }

  /** Touche par caractère (insensible à la casse), ex: 'm', 'i', 'Escape'. */
  keyPressed(...keys: string[]): boolean {
    if (!this.enabled) return false;
    return keys.some((k) => this.pressedKeys.has(k.length === 1 ? k.toLowerCase() : k));
  }

  mouseIsDown(button = 0): boolean {
    return this.enabled && this.mouseDown.has(button);
  }

  mouseWasPressed(button = 0): boolean {
    return this.enabled && this.mousePressed.has(button);
  }

  /** Touche virtuelle (commandes tactiles) : se comporte comme une vraie touche. */
  virtualKey(code: string, key: string, down: boolean): void {
    if (down) {
      if (!this.down.has(code)) this.pressedCodes.add(code);
      this.down.add(code);
      this.pressedKeys.add(key.length === 1 ? key.toLowerCase() : key);
    } else {
      this.down.delete(code);
      this.releasedCodes.add(code);
    }
  }

  /** Visée/tir au doigt : déplace le pointeur et presse le bouton principal. */
  virtualPointer(x: number, y: number, down: boolean): void {
    this.mouseX = x;
    this.mouseY = y;
    this.overUI = false;
    if (down && !this.mouseDown.has(0)) {
      this.mouseDown.add(0);
      this.mousePressed.add(0);
    } else if (!down && this.mouseDown.has(0)) {
      this.mouseDown.delete(0);
      this.mouseReleased.add(0);
    }
  }

  /** Axe de déplacement (-1..1) selon les positions physiques WASD/ZQSD + flèches. */
  moveAxis(): { x: number; z: number } {
    if (this.enabled && this.touchMove) return { ...this.touchMove };
    let x = 0;
    let z = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) z -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) z += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    return { x, z };
  }

  /** Libellé lisible d'une touche physique selon la disposition du clavier (AZERTY → « Z » pour KeyW). */
  label(code: string): string {
    const fromLayout = this.layout?.get(code);
    if (fromLayout) return fromLayout.toUpperCase();
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    const names: Record<string, string> = { Space: 'Espace', ShiftLeft: 'Maj', Escape: 'Échap', Tab: 'Tab' };
    return names[code] ?? code;
  }

  moveKeysLabel(): string {
    return ['KeyW', 'KeyA', 'KeyS', 'KeyD'].map((c) => this.label(c)).join('');
  }
}
