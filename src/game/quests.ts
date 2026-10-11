import { Rng } from '../core/rng';
import { QUEST_ITEMS, RESOURCES, type ResourceId } from '../data/items';
import { ARCHETYPES } from '../data/stations';
import { addResource, crewOnBoard } from '../state/trainState';
import { generateNpc } from '../world/npcgen';
import type { Game, GameEvent } from './Game';
import type { QuestState, NpcState, MapNode } from '../state/types';
import type { StationLevel } from './stationLevel';
import type { StationBuilder } from '../world/stationBuilder';
import type { GenCtx } from '../world/archetypes';
import type { TravelEvent } from './travelLevel';

type SideKind = 'livraison' | 'recuperation' | 'sauvetage' | 'nettoyage' | 'ravitaillement';

/** Quêtes secondaires générées procéduralement (histoire et infini). */
export class QuestManager {
  constructor(private game: Game) {}

  private get st() {
    return this.game.state;
  }

  onLoad(): void {
    /* rien */
  }

  active(): QuestState[] {
    return this.st.quests.filter((q) => q.status === 'active');
  }

  /** Gares atteignables plus loin sur le réseau (1 à `depth` sauts). */
  private reachable(from: string, depth: number): MapNode[] {
    const map = this.st.map;
    const out = new Set<string>();
    let frontier = [from];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const id of frontier) for (const l of map.nodes[id]?.links ?? []) if (!out.has(l) && !map.nodes[l]?.hidden) {
        out.add(l);
        next.push(l);
      }
      frontier = next;
    }
    return [...out].map((id) => map.nodes[id]).filter(Boolean);
  }

  /** Propose (ou rappelle) une quête pour ce PNJ résident. */
  offerFor(npc: NpcState): QuestState | null {
    const existing = this.st.quests.find((q) => q.giver === npc.id);
    if (existing) return existing;
    if (npc.storyRole || npc.trader) return null;
    const station = npc.stationId;
    if (!station) return null;
    const rng = new Rng(`${this.st.seed}:${npc.id}:quete`);
    if (!rng.chance(0.65)) return null;
    const targets = this.reachable(station, 3);
    if (!targets.length) return null;
    const kinds: SideKind[] = ['livraison', 'recuperation', 'sauvetage', 'nettoyage', 'ravitaillement'];
    const kind = rng.pick(kinds);
    const hostileTargets = targets.filter((t) => t.hostility !== 'sure');
    const safeTargets = targets.filter((t) => t.hostility !== 'hostile');
    const id = `sq${this.st.nextId++}`;
    const reward = 35 + rng.int(0, 40) + Math.round((this.st.map.nodes[station]?.threat ?? 1) * 15);
    let q: QuestState | null = null;
    switch (kind) {
      case 'livraison': {
        const t = rng.pick(safeTargets.length ? safeTargets : targets);
        q = {
          id, kind: 'secondaire', giver: npc.id, status: 'active', stage: 0, title: `Colis pour ${t.name}`,
          desc: `${npc.name} vous confie un colis scellé à remettre à ${t.name}. « Ne l'ouvrez pas, et ne traînez pas. »`,
          objectives: [{ id: 'arriver', text: `Livrer le colis à ${t.name}`, done: false, station: t.id }],
          reward: { jetons: reward, xp: 25 }, data: { kind, target: t.id },
        };
        break;
      }
      case 'recuperation': {
        const t = rng.pick(hostileTargets.length ? hostileTargets : targets);
        const item = rng.pick(['medaillon', 'photo', 'journal_bord', 'graines']);
        q = {
          id, kind: 'secondaire', giver: npc.id, status: 'active', stage: 0, title: `${QUEST_ITEMS[item].name} perdu`,
          desc: `${npc.name} a perdu ${QUEST_ITEMS[item].name.toLowerCase()} à ${t.name}. « Il est dans un des bâtiments, j'en suis sûr. Le Réseau vous paiera à la récupération. »`,
          objectives: [{ id: 'trouver', text: `Trouver : ${QUEST_ITEMS[item].name} (${t.name})`, done: false, station: t.id }],
          reward: { jetons: reward + 20, xp: 35 }, data: { kind, target: t.id, item },
        };
        break;
      }
      case 'sauvetage': {
        const t = rng.pick(targets);
        const rescued = generateNpc(rng.fork('sauve'), `${id}:pnj`, { level: 2 });
        rescued.stationId = t.id;
        rescued.status = 'resident';
        rescued.recruitable = true;
        rescued.fee = 0;
        rescued.questId = id;
        this.st.npcs[rescued.id] = rescued;
        q = {
          id, kind: 'secondaire', giver: npc.id, status: 'active', stage: 0, title: `Retrouver ${rescued.name.split(' ')[0]}`,
          desc: `${npc.name} cherche ${rescued.name}, parti${rescued.female ? 'e' : ''} vers ${t.name} et sans nouvelles depuis. « Ramenez-le à bord de votre train, il saura se rendre utile. »`,
          objectives: [{ id: 'trouver', text: `Retrouver ${rescued.name} à ${t.name} et l'embarquer`, done: false, station: t.id }],
          reward: { jetons: reward, xp: 40 }, data: { kind, target: t.id, npc: rescued.id },
        };
        break;
      }
      case 'nettoyage': {
        const t = rng.pick(hostileTargets.length ? hostileTargets : targets);
        q = {
          id, kind: 'secondaire', giver: npc.id, status: 'active', stage: 0, title: `Nettoyer ${t.name}`,
          desc: `${npc.name} : « ${t.name} est infestée. Tuez-en au moins 8, et le Réseau vous versera une prime. »`,
          objectives: [{ id: 'tuer', text: `Éliminer 8 ennemis à ${t.name}`, done: false, station: t.id, count: 8, progress: 0 }],
          reward: { jetons: reward + 30, xp: 45 }, data: { kind, target: t.id },
        };
        break;
      }
      case 'ravitaillement': {
        const t = rng.pick(safeTargets.length ? safeTargets : targets);
        const res: ResourceId = rng.pick(['nourriture', 'medicaments', 'charbon', 'ferraille']);
        const qty = res === 'medicaments' ? 4 : res === 'charbon' ? 30 : 15;
        q = {
          id, kind: 'secondaire', giver: npc.id, status: 'active', stage: 0, title: `Ravitailler ${t.name}`,
          desc: `${npc.name} : « ${t.name} manque de ${RESOURCES[res].name.toLowerCase()}. Apportez-leur ${qty} unités, ils paieront bien. »`,
          objectives: [{ id: 'livrer', text: `Apporter ${qty} ${RESOURCES[res].short} à ${t.name}`, done: false, station: t.id }],
          reward: { jetons: Math.round(reward + RESOURCES[res].price * qty * 1.4), xp: 30 }, data: { kind, target: t.id, res, qty },
        };
        break;
      }
    }
    return q;
  }

  accept(q: QuestState): void {
    if (this.st.quests.some((x) => x.id === q.id)) return;
    this.st.quests.push(q);
    if (q.data.kind === 'livraison') this.game.giveItem('colis', 1, true);
    this.game.log(`Nouvelle quête : ${q.title}.`, 'quete');
    this.game.ui.toast(`Quête acceptée : ${q.title}`, 'bon');
    this.game.audio.play('success');
  }

  complete(q: QuestState): void {
    if (q.status !== 'active') return;
    q.status = 'terminee';
    for (const o of q.objectives) o.done = true;
    const r = q.reward;
    if (r?.jetons) addResource(this.st, 'jetons', r.jetons);
    if (r?.xp) this.game.gainXp(r.xp);
    if (r?.resources) for (const [k, v] of Object.entries(r.resources) as [ResourceId, number][]) addResource(this.st, k, v);
    this.game.log(`Quête terminée : ${q.title}${r?.jetons ? ` (+${r.jetons} jetons)` : ''}.`, 'quete');
    this.game.ui.toast(`Quête terminée : ${q.title}${r?.jetons ? ` — +${r.jetons} jetons` : ''}`, 'bon');
    this.game.audio.play('success');
  }

  /** Place les éléments des quêtes actives dans la gare générée. */
  decorateStation(lv: StationLevel, b: StationBuilder, ctx: GenCtx): void {
    for (const q of this.active()) {
      if (q.data.target !== lv.node.id) continue;
      if (q.data.kind === 'recuperation') {
        const item = String(q.data.item);
        const handles = Object.values(ctx.named).filter(Boolean);
        const h = handles.length ? b.rng.pick(handles) : b.handles[0];
        if (!h) continue;
        b.container((h.inner.x0 + h.inner.x1) / 2 + b.rng.range(-1, 1), h.inner.z0 + 1.2, 'coffre', [{ kind: 'item', id: item, qty: 1 }], { id: `${q.id}:coffre` });
      }
      if (q.data.kind === 'sauvetage') {
        const id = String(q.data.npc);
        const p = b.findSpot(2, 2, { x0: -60, z0: 12, x1: 40, z1: 40 }, 30, 0.3) ?? { x: -10, z: 14 };
        b.npc({ npcId: id, x: p.x, z: p.z, yaw: 0, role: 'quete' });
      }
    }
    void lv;
  }

  onEvent(e: GameEvent): void {
    for (const q of this.active()) {
      if (q.kind !== 'secondaire') continue;
      const kind = q.data.kind as SideKind;
      if (e.type === 'arrive' && q.data.target === e.station) {
        if (kind === 'livraison' && this.game.hasItem('colis')) {
          this.game.removeItem('colis');
          this.complete(q);
        }
        if (kind === 'ravitaillement') {
          const res = q.data.res as ResourceId;
          const qty = Number(q.data.qty);
          if ((this.st.train.resources[res] ?? 0) >= qty) {
            this.game.ui.eventDialog('Ravitaillement', `Les habitants de ${this.st.map.nodes[e.station].name} attendent ${qty} ${RESOURCES[res].short}. Les leur donner ?`, [
              { text: 'Livrer', action: () => { this.st.train.resources[res] -= qty; this.complete(q); } },
              { text: 'Plus tard', action: () => undefined },
            ]);
          } else this.game.ui.toast(`Il vous manque des ${RESOURCES[res].short} pour la quête « ${q.title} ».`, 'info');
        }
      }
      if (e.type === 'item' && kind === 'recuperation' && e.id === q.data.item) {
        this.game.removeItem(String(q.data.item));
        this.complete(q);
      }
      if (e.type === 'recruit' && kind === 'sauvetage' && e.npc === q.data.npc) this.complete(q);
      if (e.type === 'kill' && kind === 'nettoyage' && e.station === q.data.target) {
        const o = q.objectives[0];
        o.progress = (o.progress ?? 0) + 1;
        if ((o.progress ?? 0) >= (o.count ?? 8)) this.complete(q);
      }
    }
  }

  plannedEvents(_from: string, _to: string): TravelEvent[] | null {
    return null;
  }

  canDepart(_to: string): string | null {
    return null;
  }

  tick(_dt: number): void {
    // quêtes devenues impossibles (gare dépassée)
    const map = this.st.map;
    const cur = map.nodes[map.current];
    if (!cur) return;
    for (const q of this.active()) {
      if (q.kind !== 'secondaire') continue;
      const t = map.nodes[String(q.data.target)];
      if (t && t.layer < cur.layer) {
        q.status = 'echouee';
        this.game.log(`Quête échouée : ${q.title} (gare dépassée).`, 'mauvais');
      }
    }
    void crewOnBoard;
    void ARCHETYPES;
  }
}
