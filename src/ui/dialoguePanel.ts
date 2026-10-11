import { h, clear, bar } from './dom';
import { portraitSpec, baseMood } from './portrait';
import { portraitSvg, type Mood } from './portraitArt';
import { PERSONALITIES, SKILLS, JOBS, SECRETS, type JobId } from '../data/npcs';
import { WAGON_TYPES } from '../data/train';
import { ARCHETYPES } from '../data/stations';
import { diseaseName, type InterroApproach } from '../game/crewSystem';
import { clamp } from '../core/math';
import type { Game } from '../game/Game';
import type { UI } from './UI';
import type { NpcActor } from '../game/npcActor';
import type { DialogueNode, DialogueTree } from '../story/dialogue';

interface Opt {
  text: string;
  tone?: 'normal' | 'quete' | 'danger';
  go: () => void;
}

/** Fenêtre de dialogue avec un PNJ (histoire, résident, équipage). */
export function openDialogue(ui: UI, game: Game, actor: NpcActor): void {
  const n = actor.data;
  actor.talking = true;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- cadre du personnage qui parle
  const art = h('div', { class: 'portrait-art' });
  const frame = h('div', { class: 'speaker-frame' }, art, ...['tl', 'tr', 'bl', 'br'].map((k) => h('i', { class: `rivet ${k}` })));
  const role = h('div', { class: 'speaker-role' });
  const tags = h('div', { class: 'tags' });
  const moral = h('div', { class: 'moral' });
  const speaker = h('div', { class: 'speaker' }, frame, h('div', { class: `speaker-name${n.name.length > 17 ? ' long' : ''}` }, n.name), role, tags, moral);
  const textNode = document.createTextNode('');
  const text = h('div', { class: 'dlg-text', title: 'Cliquer pour tout afficher' }, textNode, h('span', { class: 'caret' }));
  const opts = h('div', { class: 'dlg-opts' });
  const body = h('div', { class: 'dlg' }, speaker, h('div', { class: 'dlg-main' }, text, opts));
  const lv0 = game.stationLevel();
  const title = n.status === 'equipage' ? 'Équipage' : n.status === 'passager' ? 'Passager' : n.status === 'prisonnier' ? 'Prisonnier' : lv0 ? lv0.node.name : 'Rencontre';
  ui.openModal(body, { title, className: 'medium dialogue', onClose: () => { actor.talking = false; stopAll(); } });

  const renderInfo = () => {
    role.textContent = `${SKILLS[n.skill].name} ${'★'.repeat(n.skillLevel)}${n.known.personality ? ` · ${PERSONALITIES[n.personality].name}` : ''}`;
    clear(tags);
    if (n.status === 'equipage') tags.append(h('div', { class: 'pill' }, JOBS[n.job].name));
    if (n.known.secret && n.secret) tags.append(h('div', { class: `pill ${n.secret === 'veteran' ? 'good' : 'bad'}` }, SECRETS[n.secret].name));
    if (n.disease && (n.disease.known || n.disease.incubation <= 0)) tags.append(h('div', { class: 'pill bad' }, diseaseName(n.disease)));
    clear(moral);
    if (n.status !== 'resident' && n.status !== 'parti') moral.append(bar(n.morale, 100, 'morale thin'), h('div', { class: 'small muted', style: 'text-align:center;margin-top:3px' }, `Moral ${Math.round(n.morale)}`));
  };

  // ---------------------------------------------------------------- portrait animé
  let svg: SVGSVGElement | null = null;
  let sig = '';
  const setMood = (m: Mood) => {
    const spec = portraitSpec(n, m);
    const key = `${m}|${spec.sick}|${spec.hurt}`;
    if (key === sig && svg) return;
    sig = key;
    art.innerHTML = portraitSvg(spec, { anim: !reduced });
    svg = art.querySelector('svg');
    mouth = 0;
  };
  let mouth = 0;
  const setMouth = (m: number) => {
    if (!svg || m === mouth) return;
    mouth = m;
    svg.classList.toggle('pt-talk-1', m === 1);
    svg.classList.toggle('pt-talk-2', m === 2);
  };
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(() => {
      timers.delete(t);
      if (body.isConnected) fn();
    }, ms);
    timers.add(t);
  };
  const flick = (cls: string, ms: number) => {
    svg?.classList.add(cls);
    const el = svg;
    later(() => el?.classList.remove(cls), ms);
  };
  const blink = () => later(() => {
    flick('pt-blink', 120);
    if (Math.random() < 0.18) later(() => flick('pt-blink', 110), 260);
    blink();
  }, 2200 + Math.random() * 3600);
  const glance = () => later(() => {
    flick(Math.random() < 0.5 ? 'pt-look-l' : 'pt-look-r', 700 + Math.random() * 900);
    glance();
  }, 3500 + Math.random() * 5000);
  if (!reduced) {
    blink();
    glance();
  }

  // ---------------------------------------------------------------- texte qui s'écrit, bouche synchronisée
  let full = '';
  let shown = 0;
  let pause = 0;
  let typing = 0;
  let mouthAt = 0;
  const finishTyping = () => {
    if (typing) window.clearInterval(typing);
    typing = 0;
    shown = full.length;
    textNode.data = full;
    text.classList.remove('typing');
    frame.classList.remove('talking');
    setMouth(0);
  };
  const say = (t: string) => {
    full = t;
    shown = 0;
    pause = 0;
    textNode.data = '';
    if (typing) window.clearInterval(typing);
    typing = 0;
    if (reduced || !t) return finishTyping();
    text.classList.add('typing');
    frame.classList.add('talking');
    const step = t.length > 260 ? 3 : 2;
    typing = window.setInterval(() => {
      if (!body.isConnected) return stopAll();
      if (pause > 0) {
        pause--;
        setMouth(0);
        return;
      }
      shown = Math.min(full.length, shown + step);
      textNode.data = full.slice(0, shown);
      const ch = full[shown - 1] ?? '';
      if (/[.!?…]/.test(ch)) pause = 7;
      else if (/[,;:]/.test(ch)) pause = 3;
      const now = performance.now();
      if (now - mouthAt > 90) {
        mouthAt = now;
        let m = /[\s.,;:!?…«»"'()\-—]/.test(ch) ? 0 : /[aeiouyàâäéèêëîïôöùûüœ]/i.test(ch) ? 2 : 1;
        if (m && m === mouth) m = m === 2 ? 1 : 2;
        setMouth(m);
      }
      if (shown >= full.length) finishTyping();
    }, 30);
  };
  text.addEventListener('click', () => {
    if (typing) finishTyping();
  });

  const show = (t: string, options: Opt[], m?: Mood) => {
    renderInfo();
    setMood(m ?? baseMood(n));
    say(t);
    clear(opts);
    options.forEach((o, i) => {
      const el = h('button', { class: `dlg-opt ${o.tone ?? ''}`, style: `--i:${i}` }, h('span', { class: 'num' }, `${i + 1}.`), o.text);
      el.addEventListener('click', () => {
        game.audio.play('ui');
        o.go();
      });
      opts.append(el);
    });
    keyHandler = (e: KeyboardEvent) => {
      if ((e.key === ' ' || e.key === 'Enter') && typing) {
        e.preventDefault();
        finishTyping();
        return;
      }
      const k = Number(e.key);
      if (k >= 1 && k <= options.length) {
        e.preventDefault();
        options[k - 1].go();
      }
    };
  };
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;
  const onKey = (e: KeyboardEvent) => keyHandler?.(e);
  window.addEventListener('keydown', onKey);
  const stopAll = () => {
    if (typing) window.clearInterval(typing);
    typing = 0;
    for (const t of timers) window.clearTimeout(t);
    timers.clear();
    window.removeEventListener('keydown', onKey);
    obs.disconnect();
  };
  const close = () => {
    stopAll();
    ui.closeModal();
  };
  // nettoyage si fermé autrement
  const obs = new MutationObserver(() => {
    if (!body.isConnected) stopAll();
  });
  obs.observe(ui.root, { childList: true, subtree: true });

  // ---------------------------------------------------------------- arbre scénarisé
  const tree = game.story.dialogueFor(n);
  const runTree = (t: DialogueTree, nodeId: string) => {
    const node: DialogueNode | undefined = t[nodeId];
    if (!node) return generic();
    const txt = typeof node.text === 'function' ? node.text() : node.text;
    const options: Opt[] = node.options
      .filter((o) => !o.cond || o.cond())
      .map((o) => ({
        text: o.text,
        tone: o.tone,
        go: () => {
          o.action?.();
          if (o.next === null || o.next === undefined) {
            if (o.next === null) return close();
            return close();
          }
          runTree(t, o.next);
        },
      }));
    if (nodeId === 'start') options.splice(options.length - 1, 0, { text: 'Autres sujets…', go: () => generic() });
    show(txt, options);
  };

  // ---------------------------------------------------------------- dialogue générique
  const generic = () => {
    const isCrew = n.status === 'equipage' || n.status === 'passager' || n.status === 'prisonnier';
    if (isCrew) crewMenu();
    else residentMenu();
  };

  const greet = () => {
    const p = PERSONALITIES[n.personality];
    return p.greet[Math.floor(Math.random() * p.greet.length)];
  };

  const fearful = n.personality === 'peureux' || n.personality === 'paranoiaque';
  const residentMenu = (msg?: string, mood?: Mood) => {
    const lv = game.stationLevel();
    const options: Opt[] = [];
    options.push({ text: 'Qui êtes-vous ?', go: () => residentMenu(`${n.bio} ${SKILLS[n.skill].pitch[n.id.length % SKILLS[n.skill].pitch.length]}`) });
    options.push({ text: 'Des nouvelles du Réseau ?', go: () => residentMenu(`« ${game.crewSystem.rumor()} »`) });
    if (!n.trader && !n.storyRole) {
      const q = game.quests.offerFor(n);
      if (q && q.status === 'active' && game.state.quests.includes(q)) options.push({ text: `À propos de « ${q.title} »…`, go: () => residentMenu(`${q.desc} ${q.objectives.map((o) => (o.done ? '✔ ' : '◆ ') + o.text).join(' ')}`) });
      else if (q && !game.state.quests.includes(q)) options.push({ text: 'Avez-vous du travail pour moi ?', tone: 'quete', go: () => questOffer(q) });
      else options.push({ text: 'Avez-vous du travail pour moi ?', go: () => residentMenu('Non, rien pour l\'instant. Merci quand même.') });
    }
    if (n.recruitable && (n.status === 'resident' || n.status === 'parti')) {
      options.push({
        text: n.fee > 0 ? `Rejoindre l'équipage (${n.fee} jetons)` : 'Rejoindre l\'équipage',
        tone: 'quete',
        go: () => {
          const p = PERSONALITIES[n.personality];
          const err = game.crewSystem.recruit(n);
          if (err) residentMenu(err, 'renfrogne');
          else {
            say(p.accept[0]);
            close();
          }
        },
      });
    }
    if (n.trader && lv) options.push({ text: 'Commercer', tone: 'quete', go: () => { close(); ui.openTrade(lv.node); } });
    if (lv && !n.trader && lv.node.hostility !== 'hostile' && ARCHETYPES[lv.node.archetype].services.some((s) => s === 'soins' || s === 'repos' || s === 'informations' || s === 'atelier')) {
      options.push({ text: 'Services de la gare', go: () => { close(); ui.openTrade(lv.node, null); } });
    }
    options.push({ text: 'Au revoir.', go: close });
    show(msg ?? greet(), options, mood);
  };

  const questOffer = (q: NonNullable<ReturnType<typeof game.quests.offerFor>>) => {
    show(q.desc + (q.reward?.jetons ? ` (Récompense : ${q.reward.jetons} jetons)` : ''), [
      { text: 'J\'accepte.', tone: 'quete', go: () => { game.quests.accept(q); residentMenu('Merci ! Je compte sur vous.', 'joie'); } },
      { text: 'Pas maintenant.', go: () => residentMenu('Comme vous voudrez.') },
    ]);
  };

  const statusText = (): string => {
    const parts: string[] = [];
    const wagon = game.state.train.wagons.find((w) => w.uid === n.wagon);
    if (n.morale > 75) parts.push('Je me sens bien à bord, vraiment.');
    else if (n.morale < 25) parts.push('Franchement ? Je n\'en peux plus de ce voyage.');
    else parts.push('Ça va, on fait aller.');
    if (wagon && wagon.temp < 12) parts.push(`Il fait ${Math.round(wagon.temp)} °C dans ce wagon, on gèle !`);
    if (n.hunger > 1) parts.push('Et j\'ai faim. Il reste des vivres ?');
    if (n.disease && n.disease.incubation <= 0) parts.push('Je tousse… je ne me sens pas bien.');
    if (n.hp < n.maxHp * 0.5) parts.push('Mes blessures me font souffrir.');
    if (n.status === 'passager' && n.fare) parts.push(`J'ai hâte d'arriver à ${game.state.map.nodes[n.fare.destination]?.name}.`);
    return parts.join(' ');
  };

  const moraleMood = (): Mood | undefined => (n.morale > 75 ? 'joie' : n.morale < 25 ? 'triste' : undefined);
  const crewMenu = (msg?: string, mood?: Mood) => {
    const options: Opt[] = [];
    options.push({ text: 'Comment ça va ?', go: () => crewMenu(statusText(), moraleMood()) });
    options.push({ text: 'Parle-moi de toi.', go: () => interro('amical') });
    if (n.status === 'equipage') options.push({ text: 'Ordres…', go: () => ordersMenu() });
    options.push({ text: 'Interroger…', go: () => interroMenu() });
    if (n.hp < n.maxHp && (game.state.train.resources.trousses ?? 0) > 0) {
      options.push({
        text: 'Le soigner (1 trousse)',
        go: () => {
          game.state.train.resources.trousses--;
          n.hp = Math.min(n.maxHp, n.hp + 40);
          if (n.disease?.id === 'infection') n.disease = null;
          n.affinity += 4;
          game.engine.fx.heal(actor.x, actor.y + 1, actor.z);
          crewMenu('Merci… ça va mieux.', 'joie');
        },
      });
    }
    options.push({
      text: 'Donner une prime (20 jetons)',
      go: () => {
        if (!game.economy.pay(20)) return crewMenu('Vous n\'avez pas de quoi.', 'renfrogne');
        n.morale = clamp(n.morale + (n.personality === 'cupide' ? 18 : 10), 0, 100);
        n.affinity += n.personality === 'cupide' ? 10 : 5;
        crewMenu(n.personality === 'cupide' ? 'Ah ! Voilà qui parle ma langue.' : 'C\'est gentil, merci.', n.personality === 'cupide' ? 'malice' : 'joie');
      },
    });
    const lv = game.stationLevel();
    if (n.status === 'prisonnier') options.push({ text: 'Le libérer de sa cellule', go: () => { game.crewSystem.release(n); crewMenu('Enfin… merci.', 'joie'); } });
    else if (game.state.train.wagons.some((w) => w.type === 'cellule')) options.push({ text: 'L\'enfermer en cellule', tone: 'danger', go: () => { const err = game.crewSystem.imprison(n); crewMenu(err ?? 'Vous n\'avez pas le droit !', fearful ? 'peur' : 'colere'); } });
    if (lv) options.push({ text: 'Débarquer ici', tone: 'danger', go: () => confirm(`${n.name} descendra à ${lv.node.name}.`, () => { game.crewSystem.dismiss(n); close(); }) });
    else options.push({ text: 'L\'expulser du train', tone: 'danger', go: () => confirm(`Jeter ${n.name} du train en pleine voie ? L'équipage risque d'être choqué si sa culpabilité n'est pas établie.`, () => { game.crewSystem.expel(n); close(); }) });
    options.push({ text: 'Au revoir.', go: close });
    show(msg ?? greet(), options, mood);
  };

  const confirm = (t: string, yes: () => void) => {
    show(t, [
      { text: 'Confirmer', tone: 'danger', go: yes },
      { text: 'Annuler', go: () => crewMenu() },
    ], 'inquiet');
  };

  const ordersMenu = () => {
    const options: Opt[] = [];
    const jobs: JobId[] = ['repos', 'chauffeur', 'mecanicien', 'medecin', 'cuisinier', 'garde', 'jardinier', 'suivre'];
    for (const j of jobs) {
      if (j === n.job) continue;
      if (j === 'cuisinier' && !game.state.train.wagons.some((w) => w.type === 'restaurant')) continue;
      if (j === 'jardinier' && !game.state.train.wagons.some((w) => w.type === 'serre')) continue;
      const fit = JOBS[j].skill?.includes(n.skill);
      options.push({
        text: `${j === 'suivre' ? 'Viens avec moi (escorte en exploration)' : `Poste : ${JOBS[j].name}`}${fit ? ' ★' : ''}`,
        go: () => {
          const ok = game.crewSystem.assignJob(n, j);
          crewMenu(ok ? PERSONALITIES[n.personality].accept[0] : actor.bubble ?? 'Non.', ok ? undefined : 'renfrogne');
        },
      });
    }
    options.push({ text: 'Changer de wagon…', go: () => wagonMenu() });
    options.push({ text: 'Retour', go: () => crewMenu() });
    show(`Poste actuel : ${JOBS[n.job].name}. ${JOBS[n.job].desc}`, options);
  };

  const wagonMenu = () => {
    const options: Opt[] = game.state.train.wagons.map((w, i) => ({
      text: `${i + 1}. ${WAGON_TYPES[w.type].name}${w.uid === n.wagon ? ' (actuel)' : ''}`,
      go: () => {
        const ok = game.crewSystem.moveToWagon(n, w.uid);
        crewMenu(ok ? PERSONALITIES[n.personality].accept[0] : actor.bubble ?? 'Non.', ok ? undefined : 'renfrogne');
      },
    }));
    options.push({ text: 'Retour', go: () => ordersMenu() });
    show('Dans quel wagon dois-je m\'installer ?', options);
  };

  const interroMenu = () => {
    const unresolved = game.state.journal.incidents.filter((i) => !i.resolved).length;
    show(unresolved ? `Il y a ${unresolved} incident(s) non élucidé(s) à bord.` : 'Que voulez-vous savoir ?', [
      { text: 'Avez-vous remarqué quelque chose de suspect ?', go: () => interro('soupcons') },
      { text: 'Où étiez-vous pendant les incidents ? (direct)', go: () => interro('direct') },
      { text: 'Je sais ce que vous avez fait. Avouez ! (menace)', tone: 'danger', go: () => interro('menace') },
      { text: 'Fouiller ses affaires', tone: 'danger', go: () => interro('fouille') },
      { text: 'Retour', go: () => crewMenu() },
    ]);
  };

  const interro = (a: InterroApproach) => {
    const r = game.crewSystem.interrogate(n, a);
    const extra: string[] = [];
    if (r.revealed.includes('personnalite')) extra.push(`[Caractère découvert : ${PERSONALITIES[n.personality].name}]`);
    if (r.revealed.includes('secret') && n.secret) extra.push(`[Secret révélé : ${SECRETS[n.secret].name}]`);
    if (r.revealed.includes('indice')) extra.push('[Indice noté dans le journal]');
    if (r.revealed.includes('preuve')) extra.push('[Preuve trouvée : émetteur radio]');
    const options: Opt[] = [];
    if (r.confession && (n.secret === 'voleur' || n.secret === 'traitre')) {
      const tree2 = game.story.dialogueFor(n);
      if (tree2 && tree2.sort) options.push({ text: 'Décider de son sort…', tone: 'danger', go: () => runTree(tree2, 'sort') });
    }
    options.push({ text: 'Autre question…', go: () => interroMenu() });
    options.push({ text: 'Retour', go: () => crewMenu() });
    const mood: Mood | undefined = r.confession ? 'triste' : a === 'menace' || a === 'fouille' ? (fearful ? 'peur' : 'colere') : a === 'soupcons' ? 'inquiet' : undefined;
    show(`${r.text} ${extra.join(' ')}`.trim(), options, mood);
  };

  if (tree) runTree(tree, 'start');
  else generic();
}
