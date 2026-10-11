import { h, clear, bar } from './dom';
import { portrait } from './portrait';
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
  const header = h('div', { class: 'stack', style: 'align-items:center;text-align:center' });
  const text = h('div', { class: 'dlg-text' });
  const opts = h('div', { class: 'dlg-opts' });
  const body = h('div', { class: 'dlg' }, header, h('div', null, text, opts));
  ui.openModal(body, { title: n.name, className: 'medium', onClose: () => { actor.talking = false; } });

  const renderHeader = () => {
    clear(header);
    header.append(portrait(n, true));
    header.append(h('div', { class: 'pill' }, `${SKILLS[n.skill].name} ${'★'.repeat(n.skillLevel)}`));
    header.append(h('div', { class: 'pill' }, n.known.personality ? PERSONALITIES[n.personality].name : 'Caractère ?'));
    if (n.known.secret && n.secret) header.append(h('div', { class: `pill ${n.secret === 'veteran' ? 'good' : 'bad'}` }, SECRETS[n.secret].name));
    if (n.status !== 'resident' && n.status !== 'parti') {
      header.append(h('div', { style: 'width:100%' }, bar(n.morale, 100, 'morale thin')));
      header.append(h('div', { class: 'small muted' }, `Moral ${Math.round(n.morale)}`));
    }
    if (n.disease && (n.disease.known || n.disease.incubation <= 0)) header.append(h('div', { class: 'pill bad' }, diseaseName(n.disease)));
  };

  const show = (t: string, options: Opt[]) => {
    renderHeader();
    text.textContent = t;
    clear(opts);
    options.forEach((o, i) => {
      const el = h('button', { class: `dlg-opt ${o.tone ?? ''}` }, h('span', { class: 'num' }, `${i + 1}.`), o.text);
      el.addEventListener('click', () => {
        game.audio.play('ui');
        o.go();
      });
      opts.append(el);
    });
    keyHandler = (e: KeyboardEvent) => {
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
  const close = () => {
    window.removeEventListener('keydown', onKey);
    ui.closeModal();
  };
  // nettoyage si fermé autrement
  const obs = new MutationObserver(() => {
    if (!body.isConnected) {
      window.removeEventListener('keydown', onKey);
      obs.disconnect();
    }
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

  const residentMenu = (msg?: string) => {
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
          if (err) residentMenu(err);
          else {
            text.textContent = p.accept[0];
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
    show(msg ?? greet(), options);
  };

  const questOffer = (q: NonNullable<ReturnType<typeof game.quests.offerFor>>) => {
    show(q.desc + (q.reward?.jetons ? ` (Récompense : ${q.reward.jetons} jetons)` : ''), [
      { text: 'J\'accepte.', tone: 'quete', go: () => { game.quests.accept(q); residentMenu('Merci ! Je compte sur vous.'); } },
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

  const crewMenu = (msg?: string) => {
    const options: Opt[] = [];
    options.push({ text: 'Comment ça va ?', go: () => crewMenu(statusText()) });
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
          crewMenu('Merci… ça va mieux.');
        },
      });
    }
    options.push({
      text: 'Donner une prime (20 jetons)',
      go: () => {
        if (!game.economy.pay(20)) return crewMenu('Vous n\'avez pas de quoi.');
        n.morale = clamp(n.morale + (n.personality === 'cupide' ? 18 : 10), 0, 100);
        n.affinity += n.personality === 'cupide' ? 10 : 5;
        crewMenu(n.personality === 'cupide' ? 'Ah ! Voilà qui parle ma langue.' : 'C\'est gentil, merci.');
      },
    });
    const lv = game.stationLevel();
    if (n.status === 'prisonnier') options.push({ text: 'Le libérer de sa cellule', go: () => { game.crewSystem.release(n); crewMenu('Enfin… merci.'); } });
    else if (game.state.train.wagons.some((w) => w.type === 'cellule')) options.push({ text: 'L\'enfermer en cellule', tone: 'danger', go: () => { const err = game.crewSystem.imprison(n); crewMenu(err ?? 'Vous n\'avez pas le droit !'); } });
    if (lv) options.push({ text: 'Débarquer ici', tone: 'danger', go: () => confirm(`${n.name} descendra à ${lv.node.name}.`, () => { game.crewSystem.dismiss(n); close(); }) });
    else options.push({ text: 'L\'expulser du train', tone: 'danger', go: () => confirm(`Jeter ${n.name} du train en pleine voie ? L'équipage risque d'être choqué si sa culpabilité n'est pas établie.`, () => { game.crewSystem.expel(n); close(); }) });
    options.push({ text: 'Au revoir.', go: close });
    show(msg ?? greet(), options);
  };

  const confirm = (t: string, yes: () => void) => {
    show(t, [
      { text: 'Confirmer', tone: 'danger', go: yes },
      { text: 'Annuler', go: () => crewMenu() },
    ]);
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
          crewMenu(ok ? PERSONALITIES[n.personality].accept[0] : actor.bubble ?? 'Non.');
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
        crewMenu(ok ? PERSONALITIES[n.personality].accept[0] : actor.bubble ?? 'Non.');
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
    show(`${r.text} ${extra.join(' ')}`.trim(), options);
  };

  if (tree) runTree(tree, 'start');
  else generic();
}
