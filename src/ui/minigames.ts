import { h, btn } from './dom';
import type { Game } from '../game/Game';
import type { UI } from './UI';

// ================================================================== DIGICODE

export function openKeypad(ui: UI, game: Game, code: string, known: string | null, hacker: boolean, onSuccess: () => void): void {
  let entry = '';
  let fails = 0;
  let done = false;
  const screen = h('div', { class: 'kp-screen' }, '____');
  const hint = h('div', { class: 'small muted', style: 'text-align:center;min-height:18px;margin-top:8px' });
  const pad = h('div', { class: 'keypad' });
  const refresh = () => {
    screen.textContent = (entry + '____').slice(0, 4);
  };
  const press = (d: string) => {
    if (done) return;
    game.audio.play('beep', { volume: 0.5, pitch: 0.8 + Number(d || 0) * 0.04 });
    if (entry.length < 4) entry += d;
    refresh();
    if (entry.length === 4) window.setTimeout(submit, 220);
  };
  const submit = () => {
    if (done) return;
    if (entry === code) {
      done = true;
      screen.textContent = 'OK';
      screen.classList.remove('err');
      game.audio.play('success');
      window.setTimeout(() => {
        ui.closeModal();
        onSuccess();
      }, 350);
      return;
    }
    fails++;
    game.audio.play('error');
    screen.classList.add('err');
    screen.textContent = 'ERR';
    entry = '';
    hint.textContent = fails >= 2 ? 'Les codes sont souvent notés sur des documents dans les bureaux de la gare.' : 'Code incorrect.';
    window.setTimeout(() => {
      screen.classList.remove('err');
      refresh();
    }, 600);
    if (fails >= 3) {
      done = true;
      hint.textContent = 'Trois erreurs : alarme déclenchée !';
      game.audio.play('alarm');
      const lv = game.stationLevel();
      if (lv) for (const e of lv.enemies) if (e.alive && Math.hypot(e.x - game.player.x, e.z - game.player.z) < 35) e.alert(game.player);
      window.setTimeout(() => ui.closeModal(), 900);
    }
  };
  for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) pad.append(btn(d, () => press(d)));
  pad.append(btn('C', () => { entry = ''; refresh(); }), btn('0', () => press('0')), btn('⏎', submit, 'primary'));
  const extra = h('div', { class: 'row', style: 'justify-content:center;margin-top:10px;gap:8px' });
  if (known) extra.append(btn(`Code noté : ${known}`, () => { entry = ''; for (const c of known) press(c); }, 'small primary'));
  if (hacker) extra.append(btn('Laisser l\'ingénieur pirater', () => {
    hint.textContent = 'Votre ingénieur court-circuite le boîtier…';
    let i = 0;
    const t = window.setInterval(() => {
      screen.textContent = Array.from({ length: 4 }, (_, k) => (k < i ? code[k] : String(Math.floor(Math.random() * 10)))).join('');
      if (++i > 4) {
        window.clearInterval(t);
        entry = code;
        submit();
      }
    }, 280);
  }, 'small'));
  const body = h('div', null, screen, pad, extra, hint);
  const onKey = (e: KeyboardEvent) => {
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') { entry = entry.slice(0, -1); refresh(); }
    else if (e.key === 'Enter') submit();
  };
  window.addEventListener('keydown', onKey);
  ui.openModal(body, { title: 'Digicode', className: 'narrow', onClose: () => window.removeEventListener('keydown', onKey) });
  refresh();
}

// ================================================================== CROCHETAGE

export function openLockpick(ui: UI, game: Game, difficulty: number, cb: (ok: boolean) => void): void {
  const W = 360;
  const H = 300;
  const canvas = h('canvas', { width: W, height: H }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const info = h('div', { class: 'small', style: 'text-align:center;margin-top:8px' });
  const perk = game.player.hasPerk('crocheteur');
  const arcSize = Math.max(0.28, [0, 0.75, 0.52, 0.36][Math.min(3, difficulty)] + (perk ? 0.16 : 0));
  let pin = 0;
  let angle = 0;
  let speed = 2.4 + difficulty * 0.5;
  let target = Math.random() * Math.PI * 2;
  let raf = 0;
  let finished = false;
  let flash = 0;
  let flashColor = '';
  let last = performance.now();
  const picks = () => Math.floor(game.state.train.resources.crochets ?? 0);
  const setInfo = () => {
    info.textContent = `Goupille ${Math.min(3, pin + 1)}/3 · ${picks()} crochet(s) · Espace ou clic quand l'aiguille est dans la zone verte`;
  };
  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2;
    ctx.fillStyle = '#1a1612';
    ctx.beginPath();
    ctx.arc(cx, cy, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4a3e31';
    ctx.lineWidth = 6;
    ctx.stroke();
    // zone cible
    ctx.strokeStyle = '#3fbf5a';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.arc(cx, cy, 100, target - arcSize / 2, target + arcSize / 2);
    ctx.stroke();
    // goupilles
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < pin ? '#e3a83c' : '#3a3229';
      ctx.fillRect(cx - 40 + i * 30, cy - 10, 20, 20);
    }
    // aiguille
    ctx.strokeStyle = '#e8e2d4';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * 40, cy + Math.sin(angle) * 40);
    ctx.lineTo(cx + Math.cos(angle) * 118, cy + Math.sin(angle) * 118);
    ctx.stroke();
    if (flash > 0) {
      ctx.fillStyle = flashColor;
      ctx.globalAlpha = flash;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  };
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    angle = (angle + speed * dt) % (Math.PI * 2);
    flash = Math.max(0, flash - dt * 3);
    draw();
    if (!finished) raf = requestAnimationFrame(loop);
  };
  const end = (ok: boolean) => {
    finished = true;
    cancelAnimationFrame(raf);
    window.setTimeout(() => {
      ui.closeModal();
      cb(ok);
    }, ok ? 300 : 700);
  };
  const attempt = () => {
    if (finished) return;
    let d = Math.abs(((angle - target + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    d = Math.abs(d);
    if (d <= arcSize / 2) {
      pin++;
      game.audio.play('pick');
      flash = 0.4;
      flashColor = '#3fbf5a';
      if (pin >= 3) {
        game.audio.play('unlock');
        game.gainXp(6);
        return end(true);
      }
      target = Math.random() * Math.PI * 2;
      speed *= 1.18;
    } else {
      game.audio.play('pickFail');
      flash = 0.5;
      flashColor = '#c0302a';
      const breakChance = perk ? 0.25 : 0.5;
      if (Math.random() < breakChance) {
        game.state.train.resources.crochets = Math.max(0, picks() - 1);
        ui.toast('Le crochet casse !', 'mauvais');
        if (picks() <= 0) {
          setInfo();
          return end(false);
        }
      }
      if (pin > 0 && Math.random() < 0.5) pin--;
    }
    setInfo();
  };
  canvas.addEventListener('mousedown', attempt);
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      attempt();
    }
  };
  window.addEventListener('keydown', onKey);
  const body = h('div', { class: 'lockpick' }, canvas, info);
  ui.openModal(body, {
    title: `Crochetage — difficulté ${difficulty}`,
    className: 'narrow',
    onClose: () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
      if (!finished) cb(false);
      finished = true;
    },
  });
  setInfo();
  raf = requestAnimationFrame(loop);
}

// ================================================================== BORNE D'ARCADE « RAIL RUNNER »

export function openArcade(ui: UI, game: Game): void {
  const W = 520;
  const H = 260;
  const canvas = h('canvas', { width: W, height: H }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const info = h('div', { class: 'small muted', style: 'text-align:center;margin-top:8px' }, 'Espace / clic : sauter. Évitez rochers et chauves-souris, ramassez les jetons dorés.');
  let best = 0;
  try {
    best = Number(localStorage.getItem('rdc_arcade_best') ?? 0);
  } catch {
    /* ignore */
  }
  let y = 0;
  let vy = 0;
  let speed = 220;
  let dist = 0;
  let score = 0;
  let over = false;
  let started = false;
  let obstacles: { x: number; kind: 'rock' | 'bat' | 'coin'; y: number }[] = [];
  let spawn = 1;
  let raf = 0;
  let last = performance.now();
  const ground = H - 50;
  const jump = () => {
    if (!started) started = true;
    if (over) {
      obstacles = [];
      over = false;
      dist = 0;
      score = 0;
      speed = 220;
      y = 0;
      vy = 0;
      return;
    }
    if (y <= 0.01) {
      vy = 420;
      game.audio.play('arcade');
    }
  };
  const draw = () => {
    ctx.fillStyle = '#100a1a';
    ctx.fillRect(0, 0, W, H);
    // étoiles et montagnes
    ctx.fillStyle = '#2a1a40';
    for (let i = 0; i < 6; i++) {
      const mx = ((i * 140 - dist * 0.2) % (W + 140) + W + 140) % (W + 140) - 70;
      ctx.beginPath();
      ctx.moveTo(mx - 80, ground);
      ctx.lineTo(mx, ground - 70 - (i % 3) * 20);
      ctx.lineTo(mx + 80, ground);
      ctx.fill();
    }
    ctx.fillStyle = '#ff4ad0';
    ctx.fillRect(0, ground, W, 3);
    ctx.fillStyle = '#4af0ff';
    for (let x = -((dist * 1) % 24); x < W; x += 24) ctx.fillRect(x, ground + 8, 14, 3);
    // train
    const ty = ground - 26 - y;
    ctx.fillStyle = '#e3a83c';
    ctx.fillRect(60, ty, 44, 22);
    ctx.fillStyle = '#c4562f';
    ctx.fillRect(96, ty - 10, 10, 12);
    ctx.fillStyle = '#4af0ff';
    ctx.fillRect(66, ty + 4, 10, 8);
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(70, ty + 24, 5, 0, Math.PI * 2);
    ctx.arc(94, ty + 24, 5, 0, Math.PI * 2);
    ctx.fill();
    for (const o of obstacles) {
      if (o.kind === 'rock') {
        ctx.fillStyle = '#8a7a6a';
        ctx.beginPath();
        ctx.moveTo(o.x, ground);
        ctx.lineTo(o.x + 12, ground - 24);
        ctx.lineTo(o.x + 26, ground);
        ctx.fill();
      } else if (o.kind === 'bat') {
        ctx.fillStyle = '#d04040';
        ctx.fillRect(o.x, ground - o.y, 22, 8);
        ctx.fillRect(o.x - 6, ground - o.y - 4 + Math.sin(dist / 10) * 3, 8, 4);
        ctx.fillRect(o.x + 20, ground - o.y - 4 + Math.sin(dist / 10) * 3, 8, 4);
      } else {
        ctx.fillStyle = '#ffd040';
        ctx.beginPath();
        ctx.arc(o.x + 6, ground - o.y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`SCORE ${Math.floor(score)}`, 14, 24);
    ctx.fillText(`RECORD ${best}`, W - 150, 24);
    if (!started || over) {
      ctx.fillStyle = over ? '#ff4ad0' : '#4af0ff';
      ctx.font = 'bold 26px monospace';
      ctx.fillText(over ? 'GAME OVER' : 'RAIL RUNNER', W / 2 - 90, H / 2 - 20);
      ctx.font = '14px monospace';
      ctx.fillText('ESPACE POUR ' + (over ? 'REJOUER' : 'COMMENCER'), W / 2 - 100, H / 2 + 6);
    }
  };
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.04, (now - last) / 1000);
    last = now;
    if (started && !over) {
      dist += speed * dt;
      score += speed * dt / 10;
      speed += dt * 8;
      vy -= 1100 * dt;
      y = Math.max(0, y + vy * dt);
      if (y <= 0) vy = 0;
      spawn -= dt;
      if (spawn <= 0) {
        spawn = 0.7 + Math.random() * 1.1;
        const r = Math.random();
        obstacles.push({ x: W + 20, kind: r < 0.55 ? 'rock' : r < 0.8 ? 'bat' : 'coin', y: r < 0.55 ? 0 : r < 0.8 ? 46 + Math.random() * 20 : 30 + Math.random() * 50 });
      }
      for (const o of obstacles) o.x -= speed * dt;
      obstacles = obstacles.filter((o) => o.x > -40);
      const ty = y;
      for (const o of obstacles) {
        if (o.x < 104 && o.x + 22 > 60) {
          if (o.kind === 'rock' && ty < 22) over = true;
          if (o.kind === 'bat' && ty + 26 > o.y - 4 && ty < o.y + 8) over = true;
          if (o.kind === 'coin' && Math.abs(ty + 12 - o.y) < 22) {
            score += 25;
            o.x = -100;
            game.audio.play('coin', { volume: 0.4 });
          }
        }
      }
      if (over) {
        game.audio.play('error');
        if (score > best) {
          best = Math.floor(score);
          try {
            localStorage.setItem('rdc_arcade_best', String(best));
          } catch {
            /* ignore */
          }
        }
      }
    }
    draw();
    raf = requestAnimationFrame(loop);
  };
  canvas.addEventListener('mousedown', jump);
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      jump();
    }
  };
  window.addEventListener('keydown', onKey);
  ui.openModal(h('div', { class: 'arcade' }, canvas, info), {
    title: 'Borne d\'arcade — Rail Runner',
    className: 'medium',
    onClose: () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
      const key = `arcade_jour_${Math.floor(game.state.time / 1440)}`;
      if (!game.state.flags[key] && score > 50) {
        game.state.flags[key] = true;
        game.crewSystem.party();
        ui.toast('L\'équipage s\'est pressé autour de la borne : le moral remonte !', 'bon');
      }
    },
  });
  raf = requestAnimationFrame(loop);
}
