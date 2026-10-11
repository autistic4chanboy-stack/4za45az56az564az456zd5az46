import { Rng } from '../core/rng';
import { addResource, crewOnBoard } from '../state/trainState';
import { generateNpc } from '../world/npcgen';
import { WAGON_TYPES } from '../data/train';
import type { Game, GameEvent } from '../game/Game';
import type { StationLevel } from '../game/stationLevel';
import type { StationBuilder, SpecialSpec } from '../world/stationBuilder';
import type { GenCtx } from '../world/archetypes';
import type { TravelEvent } from '../game/travelLevel';
import type { MapNode, NpcState, QuestState, TraderStock, Objective } from '../state/types';
import type { DialogueTree } from './dialogue';

/** Les huit actes de la quête principale « Le Remède ». */
const STAGES: { title: string; desc: string; objectives: Objective[] }[] = [
  {
    title: 'La Fièvre Grise',
    desc: 'La Fièvre Grise ronge Cendrebourg. Le Dr Élise Varga affirme qu\'un remède peut être synthétisé à la Station Polaris, tout au nord, à partir de trois composants dispersés sur le Réseau. Le maire vous confie la vieille locomotive L\'Espérance.',
    objectives: [
      { id: 'maire', text: 'Parler au maire Augustin Delorme', done: false, station: 'cendrebourg' },
      { id: 'equipe', text: 'Embarquer le Dr Élise Varga et Bastien « Boulon »', done: false, station: 'cendrebourg' },
      { id: 'charbon', text: 'Remplir le tender à la tour à charbon', done: false, station: 'cendrebourg' },
      { id: 'depart', text: 'Au poste de conduite (locomotive), partir vers la Mine de Creux-Noir', done: false },
    ],
  },
  {
    title: 'Les Spores de Lumen',
    desc: 'Le premier composant pousse dans l\'obscurité des galeries profondes de Creux-Noir : des champignons bioluminescents. Mais les mineurs ont fui quelque chose…',
    objectives: [
      { id: 'arriver', text: 'Atteindre la Mine de Creux-Noir', done: false, station: 'creux_noir' },
      { id: 'spores', text: 'Trouver les Spores de Lumen au fond des galeries', done: false, station: 'creux_noir' },
      { id: 'mila', text: '(Optionnel) Retrouver la survivante cachée dans la mine', done: false, optional: true, station: 'creux_noir' },
    ],
  },
  {
    title: 'Le Carrefour des Vents',
    desc: 'Le deuxième composant, un isotope stabilisé, dort au cœur de la centrale irradiée de Valpierre. Au grand marché de Carrefour-des-Vents, un informateur pourrait vous guider… et il vous faudra de quoi survivre aux radiations.',
    objectives: [
      { id: 'arriver', text: 'Rejoindre Carrefour-des-Vents', done: false, station: 'carrefour' },
      { id: 'silas', text: 'Rencontrer l\'informateur Silas Vex', done: false, station: 'carrefour' },
      { id: 'combinaison', text: 'Obtenir une combinaison anti-radiations (Mama Jo, ou la milice de Garde-Fer)', done: false },
      { id: 'geiger', text: '(Conseillé) Obtenir un compteur Geiger', done: false, optional: true },
    ],
  },
  {
    title: 'Le cœur de Valpierre',
    desc: 'La centrale de Valpierre irradie toute la vallée. Le train ne pourra pas y stationner longtemps : entrez dans le bâtiment réacteur, prenez l\'isotope et repartez.',
    objectives: [
      { id: 'arriver', text: 'Atteindre la Centrale de Valpierre', done: false, station: 'valpierre' },
      { id: 'isotope', text: 'Récupérer l\'isotope stabilisé dans le bâtiment réacteur', done: false, station: 'valpierre' },
    ],
  },
  {
    title: 'La Brume de Morne',
    desc: 'Le catalyseur et les notes du Pr Hallström se trouvent dans le laboratoire de l\'usine de Morne-Brume, noyée sous les gaz. Masque obligatoire.',
    objectives: [
      { id: 'arriver', text: 'Atteindre l\'Usine de Morne-Brume', done: false, station: 'morne_brume' },
      { id: 'catalyseur', text: 'Récupérer le Catalyseur K-9 (laboratoire chimique)', done: false, station: 'morne_brume' },
      { id: 'formule', text: 'Récupérer le carnet du Pr Hallström (bureaux)', done: false, station: 'morne_brume' },
    ],
  },
  {
    title: 'Vers le Nord',
    desc: 'L\'hiver tombe sur le Réseau. Au Hameau-de-Givre vit Ingrid Solberg, ancienne ingénieure de Polaris : elle seule connaît la combinaison d\'aiguillages du Col.',
    objectives: [
      { id: 'arriver', text: 'Atteindre le Hameau-de-Givre', done: false, station: 'givre' },
      { id: 'ingrid', text: 'Convaincre Ingrid Solberg de vous aider', done: false, station: 'givre' },
      { id: 'plan', text: 'Obtenir le plan des aiguillages du Col', done: false },
    ],
  },
  {
    title: 'Le Col',
    desc: 'Au Triage du Col, trois aiguillages décident de la destination. Une seule combinaison mène à Polaris ; les autres finissent au fond d\'un ravin.',
    objectives: [
      { id: 'arriver', text: 'Atteindre le Triage du Col', done: false, station: 'col' },
      { id: 'aiguillages', text: 'Régler les aiguillages A, B et C selon le plan', done: false, station: 'col' },
      { id: 'depart', text: 'Partir vers la Station Polaris', done: false },
    ],
  },
  {
    title: 'Polaris',
    desc: 'Le terminus. Rétablissez le courant, trouvez le badge d\'accès, lancez la synthèse… et tenez bon pendant qu\'elle s\'achève.',
    objectives: [
      { id: 'arriver', text: 'Atteindre la Station Polaris', done: false, station: 'polaris' },
      { id: 'courant', text: 'Rétablir le courant (salle des générateurs)', done: false, station: 'polaris' },
      { id: 'badge', text: 'Trouver le badge Polaris niveau 3', done: false, station: 'polaris' },
      { id: 'synthese', text: 'Lancer la synthèse du remède', done: false, station: 'polaris' },
      { id: 'defendre', text: 'Défendre le laboratoire pendant la synthèse', done: false, station: 'polaris' },
    ],
  },
];

const SYNTH_DURATION = 180;

export class Story {
  private synthT = 0;
  private synthWave = 0;

  constructor(private game: Game) {}

  private get st() {
    return this.game.state;
  }

  get active(): boolean {
    return this.game.state?.mode === 'histoire';
  }

  main(): QuestState | null {
    return this.st.quests.find((q) => q.id === 'remede') ?? null;
  }

  flag(k: string): boolean {
    return !!this.st.flags[k];
  }

  setFlag(k: string, v: number | boolean | string = true): void {
    this.st.flags[k] = v;
  }

  // ------------------------------------------------------------------ cycle

  onLoad(fresh: boolean): void {
    if (!this.active) return;
    if (fresh && !this.main()) {
      this.st.quests.push(this.makeStage(0));
      // combinaison d'aiguillages du Col, propre à chaque partie
      const rng = new Rng(this.st.seed).fork('col');
      this.setFlag('combi', ['A', 'B', 'C'].map(() => (rng.chance(0.5) ? 'G' : 'D')).join(''));
      this.setFlag('code_polaris', String(rng.int(1000, 9999)));
      this.setFlag('code_k7', String(rng.int(1000, 9999)));
    }
  }

  private makeStage(i: number): QuestState {
    const s = STAGES[i];
    return {
      id: 'remede',
      title: `Acte ${i + 1} — ${s.title}`,
      kind: 'principale',
      giver: null,
      status: 'active',
      stage: i,
      desc: s.desc,
      objectives: s.objectives.map((o) => ({ ...o })),
      reward: null,
      data: {},
    };
  }

  private advance(to: number): void {
    const q = this.main();
    if (!q || q.stage >= to) return;
    q.stage = to;
    const s = STAGES[to];
    q.title = `Acte ${to + 1} — ${s.title}`;
    q.desc = s.desc;
    q.objectives = s.objectives.map((o) => ({ ...o }));
    this.game.gainXp(40);
    this.game.log(`Quête principale : ${q.title}`, 'quete');
    this.game.ui.questBanner(q.title, s.desc);
    this.game.audio.play('success');
    // les objectifs déjà remplis le restent
    this.recheck();
  }

  private done(id: string): void {
    const q = this.main();
    if (!q) return;
    const o = q.objectives.find((x) => x.id === id);
    if (!o || o.done) return;
    o.done = true;
    this.game.ui.toast(`Objectif accompli : ${o.text}`, 'bon');
    this.game.log(`Objectif : ${o.text}`, 'quete');
    this.recheck();
  }

  private isDone(id: string): boolean {
    return !!this.main()?.objectives.find((o) => o.id === id)?.done;
  }

  /** Vérifie les conditions de passage à l'acte suivant. */
  private recheck(): void {
    const q = this.main();
    if (!q || q.status !== 'active') return;
    const g = this.game;
    const all = (ids: string[]) => ids.every((i) => this.isDone(i));
    switch (q.stage) {
      case 1:
        if (g.hasItem('spores_lumen')) {
          this.markSilently('spores');
          this.advance(2);
        }
        break;
      case 3:
        if (g.hasItem('isotope')) {
          this.markSilently('arriver');
          this.markSilently('isotope');
          this.advance(4);
        }
        break;
      case 2:
        if (g.hasItem('combinaison') || g.state.player.gear.corps === 'combinaison') this.markSilently('combinaison');
        if (g.hasItem('geiger')) this.markSilently('geiger');
        if (all(['arriver', 'silas', 'combinaison'])) this.advance(3);
        break;
      case 4:
        if (g.hasItem('catalyseur')) this.markSilently('catalyseur');
        if (g.hasItem('formule')) this.markSilently('formule');
        if (all(['catalyseur', 'formule']) && (g.hasItem('isotope') || !this.flag('isotope_vole'))) this.advance(5);
        break;
      case 5:
        if (g.hasItem('plan_col')) this.markSilently('plan');
        if (all(['arriver', 'ingrid', 'plan'])) this.advance(6);
        break;
    }
  }

  private markSilently(id: string): void {
    const o = this.main()?.objectives.find((x) => x.id === id);
    if (o && !o.done) {
      o.done = true;
      this.game.ui.toast(`Objectif accompli : ${o.text}`, 'bon');
    }
  }

  intro(): void {
    if (!this.active) return;
    this.game.ui.openStory(
      'Rails de Cendres',
      [
        'Quarante ans après la Grande Brûlure, le monde ne tient plus que par ses rails. Les convoyeurs relient les dernières communautés, à travers les plaines cendrées, les zones mortes et la Brume.',
        'À Cendrebourg, la Fièvre Grise frappe. Les malades grisonnent, toussent, puis s\'éteignent. Le Dr Élise Varga affirme qu\'un remède peut être synthétisé à la Station Polaris, dans le Grand Nord, à partir de trois composants : les Spores de Lumen, un isotope stabilisé et le catalyseur K-9.',
        'Le maire vous a fait appeler. Vous êtes le dernier conducteur de la ville, et la vieille L\'Espérance attend sous la verrière du dépôt.',
        'ZQSD / WASD : se déplacer · Souris : viser · Clic gauche : tirer · Clic droit : coup de clé · E : interagir · Tab : tableau de bord · Échap : pause.',
      ],
    );
  }

  // ------------------------------------------------------------------ événements

  onEvent(e: GameEvent): void {
    if (!this.active) return;
    const q = this.main();
    if (!q) return;
    const g = this.game;
    switch (e.type) {
      case 'arrive':
        for (const o of q.objectives) if (o.id === 'arriver' && o.station === e.station) this.done('arriver');
        if (e.station === 'valpierre' && !this.flag('valpierre_vu')) {
          this.setFlag('valpierre_vu');
          g.ui.toast(`Radiations intenses ! Le train ne peut rester que ${Math.round((g.stationRadTimer('valpierre') ?? 300) / 60)} min à quai.`, 'mauvais');
        }
        if (e.station === 'polaris') g.ui.toast('Station Polaris. Un silence de glace règne sur le complexe.', 'info');
        break;
      case 'depart':
        if (q.stage === 0 && e.from === 'cendrebourg') {
          this.done('depart');
          this.advance(1);
        }
        if (e.from === 'morne_brume' && this.st.season !== 'hiver') {
          g.changeSeason('hiver');
          g.ui.questBanner('Les premières neiges', 'L\'hiver s\'abat sur le Réseau. Pensez au chauffage, aux manteaux… et au charbon.');
        }
        if (q.stage === 6 && e.to === 'polaris') {
          this.done('depart');
          this.advance(7);
        }
        break;
      case 'talk':
        if (e.npc === 'delorme') this.done('maire');
        break;
      case 'recruit':
        if (q.stage === 0 && ['elise', 'bastien'].includes(e.npc)) {
          if (this.st.npcs.elise.status === 'equipage' && this.st.npcs.bastien.status === 'equipage') this.done('equipe');
        }
        if (e.npc === 'mila') this.done('mila');
        if (e.npc === 'silas') this.setFlag('silas_aboard');
        break;
      case 'special':
        if (e.action === 'tour_charbon' && q.stage === 0) this.done('charbon');
        break;
      case 'item':
        if (e.id === 'spores_lumen' && q.stage === 1) {
          this.done('spores');
          this.advance(2);
        }
        if (e.id === 'isotope') {
          if (q.stage === 3) {
            this.done('isotope');
            this.advance(4);
          } else if (this.flag('isotope_vole')) {
            this.setFlag('isotope_vole', false);
            g.ui.toast('L\'isotope est de nouveau entre vos mains !', 'bon');
            this.recheck();
          }
        }
        if (e.id === 'combinaison' || e.id === 'geiger' || e.id === 'catalyseur' || e.id === 'formule' || e.id === 'plan_col') this.recheck();
        if (e.id === 'carte_polaris' && q.stage === 7) this.done('badge');
        break;
      case 'lever':
        if (q.stage === 6 && e.id.startsWith('col:aiguillage')) {
          if (this.colLeversOk()) {
            this.done('aiguillages');
            g.ui.toast('Le signal du Col passe au vert : la voie de Polaris est ouverte !', 'bon');
          }
        }
        break;
      case 'kill':
        if (e.enemy === 'baron') {
          this.setFlag('baron_mort');
          g.log('Le Baron Rouille est tombé. Le Syndicat est décapité.', 'quete');
          g.ui.questBanner('Le Baron est tombé', 'Sans son chef, le Syndicat de la Rouille ne fera plus la loi sur les rails du Nord.');
        }
        if (e.enemy === 'behemoth') this.setFlag('behemoth_mort');
        if (e.enemy === 'reine' && e.station === 'creux_noir') this.setFlag('reine_creux');
        if (e.station === 'garde_fer') this.countKill('garde_fer');
        break;
      case 'npcDeath':
        if (e.npc === 'elise') g.ui.toast('Élise est morte… Ses notes vous permettront peut-être encore de finir son œuvre.', 'mauvais');
        break;
    }
  }

  tick(dt: number): void {
    if (!this.active) return;
    const g = this.game;
    // synthèse en cours : défense finale
    if (this.flag('synthese') && !this.flag('synthese_ok')) {
      this.synthT += dt;
      const lv = g.stationLevel();
      if (lv && lv.node.id === 'polaris') {
        const progress = this.synthT / SYNTH_DURATION;
        const waves = [0.02, 0.25, 0.5, 0.62, 0.8];
        if (this.synthWave < waves.length && progress >= waves[this.synthWave]) {
          this.synthWave++;
          this.spawnPolarisWave(lv, this.synthWave);
        }
        if (this.synthT >= SYNTH_DURATION) {
          const alive = lv.enemies.filter((e) => e.alive && Math.hypot(e.x - lv.ctx.spots.synth.x, e.z - lv.ctx.spots.synth.z) < 20).length;
          if (alive === 0 || this.synthT > SYNTH_DURATION + 60) this.finishSynthesis();
        }
      }
    }
  }

  private spawnPolarisWave(lv: StationLevel, n: number): void {
    const g = this.game;
    const s = lv.ctx.spots.synth;
    const types: ('givreur' | 'rodeur' | 'mastodonte' | 'behemoth' | 'rampant')[] =
      n === 1 ? ['givreur', 'givreur', 'rodeur', 'rodeur'] :
      n === 2 ? ['givreur', 'givreur', 'givreur', 'rampant', 'rampant'] :
      n === 3 ? ['behemoth', 'givreur', 'givreur'] :
      n === 4 ? ['mastodonte', 'givreur', 'givreur', 'rodeur', 'rodeur'] :
      ['givreur', 'givreur', 'givreur', 'givreur', 'rampant', 'rampant'];
    for (const t of types) {
      const a = Math.random() * Math.PI * 2;
      const r = t === 'behemoth' ? 40 : 28 + Math.random() * 10;
      const e = g.spawnEnemy(t, s.x + Math.cos(a) * r, Math.max(14, s.z + Math.abs(Math.sin(a)) * r), lv.node.threat, 'station');
      e.alerted = true;
      e.ai = 'chase';
      e.target = g.player;
    }
    g.ui.toast(n === 3 ? 'Le sol tremble… LE BÉHÉMOTH DES GLACES approche !' : `Vague ${n} : les créatures convergent vers le laboratoire !`, 'mauvais');
    g.audio.play('alarm');
  }

  private finishSynthesis(): void {
    const g = this.game;
    this.setFlag('synthese_ok');
    this.done('defendre');
    g.giveItem('remede', 1);
    const q = this.main();
    if (q) q.status = 'terminee';
    g.gainXp(200);
    const crew = crewOnBoard(this.st);
    const parts: string[] = [];
    parts.push('Le synthétiseur s\'arrête dans un long soupir. Dans la cuve, un liquide nacré scintille : le remède contre la Fièvre Grise.');
    parts.push(this.st.npcs.elise?.status === 'equipage' ? 'Élise prend le premier flacon entre ses mains tremblantes. « Hallström avait raison. On l\'a fait. »' : 'Grâce aux notes d\'Élise, vous avez achevé son œuvre. Elle aurait été fière.');
    if (this.flag('baron_mort')) parts.push('Sans le Baron, le Syndicat de la Rouille se disloque. Les rails du Nord redeviennent sûrs.');
    else if (this.flag('silas_demasque')) parts.push('Le Syndicat a perdu son espion. Il faudra encore compter avec lui, mais il ne touchera jamais au remède.');
    parts.push(`L'Espérance repart vers le sud avec ${crew.length} compagnon${crew.length > 1 ? 's' : ''} à son bord. Dans chaque gare, on la regarde passer comme on regarde revenir le printemps.`);
    parts.push('FIN. Merci d\'avoir joué à Rails de Cendres. Le mode Infini vous attend pour de nouveaux voyages.');
    g.ui.openStory('Épilogue', parts, () => g.gameOver(true, 'Le remède est synthétisé. Le Réseau est sauvé.'));
  }

  // ------------------------------------------------------------------ voyage

  plannedEvents(from: string, to: string): TravelEvent[] | null {
    if (!this.active) return null;
    const edgeLen = this.st.map.edges.find((e) => e.from === from && e.to === to)?.length ?? 2000;
    if (from === 'cendrebourg') {
      // premier trajet : une attaque de Rôdeurs pour apprendre les tourelles
      return [{ at: edgeLen * 0.4, kind: 'attaque', done: false, data: { faction: 'monstre', strength: 0.45 } }];
    }
    if (from === 'valpierre' && this.silasCanSteal()) {
      return [{ at: edgeLen * 0.5, kind: 'vol_isotope', done: false }, { at: edgeLen * 0.52, kind: 'attaque', done: false, data: { faction: 'bandit', strength: 1 } }];
    }
    return null;
  }

  private silasCanSteal(): boolean {
    const silas = this.st.npcs.silas;
    return !!silas && silas.status === 'equipage' && !this.flag('silas_demasque') && !this.flag('silas_surveille') && this.game.hasItem('isotope');
  }

  /** Événements de voyage propres à l'histoire (appelés par le système d'événements). */
  triggerTravelEvent(kind: string): boolean {
    if (kind !== 'vol_isotope') return false;
    const g = this.game;
    const silas = this.st.npcs.silas;
    if (!this.silasCanSteal()) return true;
    g.removeItem('isotope');
    this.setFlag('isotope_vole');
    silas.known.secret = true;
    silas.status = 'parti';
    silas.stationId = 'fort_rouille';
    silas.wagon = null;
    const a = g.crew.get('silas');
    if (a) {
      a.dispose();
      g.crew.delete('silas');
    }
    const fort = this.st.map.nodes.fort_rouille;
    fort.known = true;
    fort.scouted = true;
    g.ui.questBanner('Trahison !', 'Silas Vex a dérobé l\'isotope et sauté du train ! Le Syndicat de la Rouille attaque. Il faudra reprendre l\'isotope à Fort-Rouille.');
    g.log('Silas Vex a volé l\'isotope et rejoint le Syndicat à Fort-Rouille.', 'quete');
    const q = this.main();
    if (q && !q.objectives.some((o) => o.id === 'reprendre')) q.objectives.push({ id: 'reprendre', text: 'Reprendre l\'isotope volé à Fort-Rouille', done: false, station: 'fort_rouille' });
    return true;
  }

  canDepart(to: string): string | null {
    if (!this.active) return null;
    const q = this.main();
    const cur = this.st.map.current;
    if (q?.stage === 0 && cur === 'cendrebourg') {
      if (!this.isDone('equipe')) return 'Embarquez d\'abord Élise et Bastien : sans eux, inutile de partir.';
      if ((this.st.train.resources.charbon ?? 0) < 60) return 'Remplissez le tender à la tour à charbon avant le départ.';
    }
    if (cur === 'col' && to === 'polaris' && !this.colLeversOk()) {
      return this.game.hasItem('plan_col') ? 'Les aiguillages ne sont pas réglés selon le plan d\'Ingrid !' : 'Sans le plan des aiguillages, impossible de savoir quelle voie mène à Polaris.';
    }
    // le réseau ne permet pas de revenir en arrière : on ne quitte pas une gare clé sans ce qu'on est venu y chercher
    const g = this.game;
    const has = (id: string) => g.hasItem(id);
    switch (cur) {
      case 'creux_noir':
        if (!has('spores_lumen')) return 'Vous n\'avez pas encore les Spores de Lumen : fouillez le fond des galeries avant de repartir.';
        break;
      case 'carrefour':
        if (q?.stage === 2 && !this.isDone('silas')) return 'L\'informateur Silas Vex vous attend au marché : parlez-lui avant de repartir.';
        if (to === 'cimetiere_locos' && !has('combinaison') && this.st.player.gear.corps !== 'combinaison') return 'Sans combinaison anti-radiations, Valpierre vous tuera. Achetez-en une à Mama Jo, ou passez par Garde-Fer où la milice en fournit.';
        break;
      case 'garde_fer':
        if (!has('combinaison') && this.st.player.gear.corps !== 'combinaison') return 'Sans combinaison anti-radiations, inutile d\'aller à Valpierre : accomplissez la mission du lieutenant Lambert.';
        break;
      case 'valpierre':
        if (!has('isotope') && !this.flag('isotope_vole')) return 'L\'isotope est encore dans le bâtiment réacteur !';
        break;
      case 'morne_brume':
        if (!has('catalyseur') || !has('formule')) return 'Il vous manque encore le catalyseur K-9 ou le carnet du Pr Hallström.';
        if (to === 'radio_echo' && this.flag('isotope_vole')) return 'Silas a emporté l\'isotope à Fort-Rouille : c\'est là qu\'il faut aller le reprendre.';
        break;
      case 'fort_rouille':
        if (this.flag('isotope_vole')) return 'L\'isotope volé est encore ici, dans le coffre du Baron !';
        break;
      case 'givre':
        if (!has('plan_col')) return 'Ingrid ne vous a pas encore confié le plan des aiguillages du Col.';
        break;
    }
    return null;
  }

  colLeversOk(): boolean {
    const d = this.st.stations.col;
    const combi = String(this.st.flags.combi ?? 'GDG');
    if (!d) return false;
    return ['A', 'B', 'C'].every((k, i) => {
      const state = d.levers[`col:aiguillage:${k}`];
      const want = combi[i] === 'G' ? 0 : 1;
      return state === want;
    });
  }

  // ------------------------------------------------------------------ génération des gares scénarisées

  decorateStation(lv: StationLevel, b: StationBuilder, ctx: GenCtx): void {
    const node = lv.node;
    if (!this.active) {
      this.decorateGeneric(lv, b, ctx);
      return;
    }
    const place = (npcId: string, x: number, z: number, yaw = 0) => {
      const n = this.st.npcs[npcId];
      if (n && n.status === 'resident' && n.stationId === node.id) b.npc({ npcId, x, z, yaw, role: 'quete' });
    };
    switch (node.id) {
      case 'cendrebourg':
        place('delorme', -2, 18.8, 0);
        place('elise', -14, 15, 0.4);
        place('bastien', -20, 12, -0.5);
        b.note(-6, 12.5, 'Avis à la population', 'Par ordre du maire : quarantaine du quartier des Saules. Toute personne présentant une toux grise doit se signaler au dispensaire du Dr Varga. Que le Rail nous garde.', { y: 0.85 });
        break;
      case 'fourche':
        place('rosalie', -6, 30, 0);
        place('gaspard', 18, 30, 0);
        break;
      case 'saint_aubin':
        place('anselme', -20, 46, 0);
        b.note(40, 60, 'Carnet du frère archiviste', 'La Fièvre Grise n\'est pas née de la Brûlure. Les premiers cas furent décrits à Sainte-Claire, chez des ouvriers de Morne-Brume. Le professeur Hallström cherchait un antidote à Polaris quand les communications se sont tues.', { y: 0.85 });
        break;
      case 'creux_noir': {
        const gal = ctx.named.galeries;
        if (gal) {
          const fx = gal.inner.x0 + 2.2;
          const fz = gal.inner.z0 + 2.2;
          b.container(fx, fz, 'coffre', [{ kind: 'item', id: 'spores_lumen', qty: 1 }, { kind: 'resource', id: 'charbon', qty: 15 }], { id: 'creux_noir:spores', name: 'Cache des Lumen' });
          b.g.layer('glow');
          for (let i = 0; i < 7; i++) b.g.sphere(0.25, fx + Math.cos(i) * 1.4, 0.3, fz + Math.sin(i) * 1.4 + 0.5, 0x7affd0);
          b.g.layer('base');
          if (!this.flag('reine_creux')) b.enemyGroup(['reine'], fx + 6, fz + 5, 0, 'reine');
          b.lights.push({ x: fx, y: 1, z: fz, color: 0x7affd0, intensity: 3, distance: 8 });
          const mx = gal.inner.x1 - 2.5;
          const mz = gal.inner.z0 + 2.5;
          if (this.st.npcs.mila?.status === 'resident') b.npc({ npcId: 'mila', x: mx, z: mz, yaw: 0, role: 'quete' });
          b.note(gal.inner.x1 - 6, gal.inner.z1 - 2, 'Carnet de mineur', 'Jour 3. Les champignons qui brillent ont tout envahi au fond de la galerie 7. Et cette chose qui pond… Mila s\'est cachée dans le puits latéral. Que quelqu\'un la trouve.', { y: 0.05 });
        }
        break;
      }
      case 'carrefour':
        place('silas', -4, 22, 0);
        place('mamajo', ctx.spots.stalls?.x ?? 0, (ctx.spots.stalls?.z ?? 25) + 0.2, 0);
        break;
      case 'garde_fer':
        place('lambert', 10, 38, Math.PI);
        place('nadia', -32, 41, 0);
        break;
      case 'valpierre': {
        const r = ctx.named.reacteur;
        if (r) {
          b.container((r.inner.x0 + r.inner.x1) / 2 + 4, r.inner.z0 + 1.5, 'coffre', [{ kind: 'item', id: 'isotope', qty: 1 }], { id: 'valpierre:isotope', name: 'Conteneur plombé' });
        }
        break;
      }
      case 'port_gris':
        place('oscar', 4, 22, 0);
        break;
      case 'sainte_claire': {
        const h = ctx.named.morgue ?? ctx.named.hopital;
        if (h) b.note((h.inner.x0 + h.inner.x1) / 2, h.inner.z0 + 1, 'Dossier du patient zéro', 'Patient zéro : ouvrier de l\'usine de Morne-Brume, exposé au solvant K. Le catalyseur K-9 inhibe la réplication. Ralentir la progression : repos au chaud, hydratation, isolement des malades.', { y: 0.85, id: 'sainte_claire:dossier' });
        break;
      }
      case 'morne_brume': {
        const labo = ctx.named.labo;
        const bur = ctx.named.bureaux;
        if (labo) b.container((labo.inner.x0 + labo.inner.x1) / 2, labo.inner.z0 + 1.2, 'armoire', [{ kind: 'item', id: 'catalyseur', qty: 1 }, { kind: 'resource', id: 'medicaments', qty: 4 }], { id: 'morne_brume:catalyseur', name: 'Armoire réfrigérée' });
        if (bur) {
          b.container(bur.inner.x0 + 1.5, bur.inner.z0 + 1.5, 'bureau', [{ kind: 'item', id: 'formule', qty: 1 }], { id: 'morne_brume:formule', name: 'Bureau du Pr Hallström' });
          b.note(bur.inner.x1 - 1.5, bur.inner.z0 + 1.5, 'Lettre de Hallström', `Si vous lisez ceci, j'ai échoué. La synthèse doit être faite à Polaris : le synthétiseur y est intact. Le bureau de direction de Polaris est protégé par le code ${this.st.flags.code_polaris}. Le badge niveau 3 y est rangé.`, { y: 0.85, reveals: { door: 'polaris:direction', code: String(this.st.flags.code_polaris) } });
        }
        break;
      }
      case 'fort_rouille': {
        const qg = ctx.named.qg;
        if (qg) {
          if (!this.flag('baron_mort')) b.enemyGroup(['baron'], (qg.inner.x0 + qg.inner.x1) / 2, (qg.inner.z0 + qg.inner.z1) / 2, 1, 'baron');
          if (this.flag('isotope_vole')) b.container(qg.inner.x1 - 1.5, qg.inner.z0 + 1.2, 'coffre', [{ kind: 'item', id: 'isotope', qty: 1 }, { kind: 'resource', id: 'jetons', qty: 60 }], { id: 'fort_rouille:isotope', name: 'Coffre du Baron', lock: { kind: 'crochet', difficulty: 2 } });
        }
        if (this.st.npcs.silas?.status === 'parti' && this.st.npcs.silas.stationId === 'fort_rouille') {
          b.enemyGroup(['pillard', 'pillard', 'brute'], -20, 45, 3);
        }
        break;
      }
      case 'radio_echo':
        b.note(-40, 30, 'Journal de l\'opérateur', `Dernier message reçu du Bunker K-7 avant le silence : « porte blindée, code ${this.st.flags.code_k7} ». Je le note avant d'oublier.`, { y: 0.05, reveals: { door: 'bunker_k7:porte_blindee', code: String(this.st.flags.code_k7) } });
        break;
      case 'givre':
        place('ingrid', -10, 34, 0);
        break;
      case 'bunker_k7': {
        const code = String(this.st.flags.code_k7);
        const door = b.doors.find((d) => d.id === 'bunker_k7:porte_blindee');
        if (door?.lock) door.lock.code = code;
        for (const n of b.notes) {
          if (n.reveals?.door === 'bunker_k7:porte_blindee') {
            n.reveals.code = code;
            n.text = n.text.replace(/\d{4}/, code);
          }
        }
        const bk = ctx.named.bunker;
        if (bk) {
          b.container(bk.inner.x1 - 2, bk.inner.z1 - 2, 'coffre', [{ kind: 'weapon', id: 'lance_grenades', level: 1 }, { kind: 'resource', id: 'obus', qty: 8 }], { id: 'bunker_k7:arsenal', name: 'Râtelier blindé' });
          b.container(bk.inner.x0 + 2, bk.inner.z1 - 2, 'casier', [{ kind: 'gear', id: 'combinaison_polaire' }, { kind: 'item', id: 'piece_moteur', qty: 1 }], { id: 'bunker_k7:polaire' });
        }
        break;
      }
      case 'col': {
        const p = ctx.named.poste;
        if (p) b.note((p.inner.x0 + p.inner.x1) / 2, p.inner.z0 + 1, 'Registre d\'aiguillage', 'Ligne Polaris fermée par ordre de la direction. Les leviers A, B et C du faisceau nord commandent la bifurcation. Sans le plan, n\'y touchez pas.', { y: 0.85 });
        break;
      }
      case 'polaris':
        this.decoratePolaris(lv, b, ctx);
        break;
    }
  }

  private decoratePolaris(_lv: StationLevel, b: StationBuilder, ctx: GenCtx): void {
    // le laboratoire principal héberge le synthétiseur ; un bâtiment de générateurs et une direction à code
    // emplacements réservés par le générateur du laboratoire (sinon, une place libre)
    const gp = ctx.spots.annexeA ?? b.findSpot(14, 11, { x0: -110, z0: 12, x1: 60, z1: 76 }) ?? { x: -95, z: 60 };
    const dp = ctx.spots.annexeB ?? b.findSpot(12, 10, { x0: -110, z0: 12, x1: 60, z1: 76 }) ?? { x: 50, z: 70 };
    const gen = b.building({ x: gp.x, z: gp.z, w: 12, d: 9, name: 'Salle des générateurs', wall: 0xc8c8c4, roof: 0x5a6068, interior: 'atelier', loot: 'industriel', dark: true, doors: [{ side: 'e', offset: 0 }] });
    b.special((gen.inner.x0 + gen.inner.x1) / 2, (gen.inner.z0 + gen.inner.z1) / 2, 'polaris_courant', 'Rétablir le courant', 1.8);
    const dir = b.building({ x: dp.x, z: dp.z, w: 10, d: 8, name: 'Direction', wall: 0xd0d0cc, roof: 0x5a6068, interior: 'bureau', loot: 'tech', doors: [{ side: 'w', offset: 0, lock: { kind: 'code', code: String(this.st.flags.code_polaris) }, id: 'polaris:direction' }] });
    b.container((dir.inner.x0 + dir.inner.x1) / 2, dir.inner.z0 + 1.2, 'coffre', [{ kind: 'item', id: 'carte_polaris', qty: 1 }], { id: 'polaris:badge', name: 'Coffre du directeur' });
    const main = ctx.named.principal;
    const sx = main ? (main.inner.x0 + main.inner.x1) / 2 : -20;
    const sz = main ? (main.inner.z0 + main.inner.z1) / 2 : 48;
    b.g.cyl(1.4, 1.6, 2.4, sx, 1.2, sz, 0x8a9aa8, { seg: 12 });
    b.g.layer('glow').cyl(1.1, 1.1, 2.6, sx, 1.3, sz, 0x9affff, { seg: 12 });
    b.g.layer('base');
    b.colliders.addCircle(sx, sz, 1.7);
    b.special(sx, sz + 2.4, 'synthetiseur', 'Synthétiseur', 1.8);
    ctx.spots.synth = { x: sx, z: sz };
  }

  /** Infini : bonus génériques (prisonniers, etc.). */
  private decorateGeneric(_lv: StationLevel, _b: StationBuilder, _ctx: GenCtx): void {
    /* rien de spécifique */
  }

  // ------------------------------------------------------------------ interactifs spéciaux

  specialLabel(s: SpecialSpec, lv: StationLevel): string | null {
    if (!this.active) return null;
    switch (s.action) {
      case 'polaris_courant':
        return this.flag('polaris_courant') ? 'Générateurs en marche' : 'Rétablir le courant (fusible ou 30 ferraille)';
      case 'synthetiseur':
        if (this.flag('synthese_ok')) return 'Synthèse terminée';
        if (this.flag('synthese')) return `Synthèse en cours… ${Math.min(100, Math.round((this.synthT / SYNTH_DURATION) * 100))} %`;
        return 'Lancer la synthèse du remède';
      case 'tour_charbon':
        if (lv.node.id === 'cendrebourg' && !this.flag('charbon_offert')) return 'Tour à charbon : remplir le tender (offert par la ville)';
        return null;
    }
    return null;
  }

  handleSpecial(s: SpecialSpec, lv: StationLevel): boolean {
    if (!this.active) return false;
    const g = this.game;
    switch (s.action) {
      case 'tour_charbon':
        if (lv.node.id === 'cendrebourg' && !this.flag('charbon_offert')) {
          this.setFlag('charbon_offert');
          const q = addResource(this.st, 'charbon', 200);
          g.ui.toast(`Le tender se remplit : +${q} charbon. Cadeau de la ville.`, 'bon');
          g.audio.play('shovel');
          g.emit({ type: 'special', action: 'tour_charbon', station: lv.node.id });
          return true;
        }
        if (lv.node.id === 'cendrebourg') g.emit({ type: 'special', action: 'tour_charbon', station: lv.node.id });
        return false;
      case 'polaris_courant':
        if (this.flag('polaris_courant')) return true;
        if (g.hasItem('fusible')) g.removeItem('fusible');
        else if ((this.st.train.resources.ferraille ?? 0) >= 30) this.st.train.resources.ferraille -= 30;
        else {
          g.ui.toast('Il faut un fusible industriel ou 30 ferraille pour réparer les générateurs.', 'mauvais');
          return true;
        }
        this.setFlag('polaris_courant');
        this.done('courant');
        g.audio.play('success');
        g.ui.toast('Les générateurs ronronnent. Les lumières de Polaris se rallument une à une.', 'bon');
        return true;
      case 'synthetiseur': {
        if (this.flag('synthese')) return true;
        const missing: string[] = [];
        if (!this.flag('polaris_courant')) missing.push('le courant');
        if (!g.hasItem('carte_polaris')) missing.push('le badge niveau 3');
        for (const [id, name] of [['spores_lumen', 'les Spores de Lumen'], ['isotope', 'l\'isotope'], ['catalyseur', 'le catalyseur'], ['formule', 'le carnet de Hallström']]) if (!g.hasItem(id)) missing.push(name);
        if (missing.length) {
          g.ui.toast(`Impossible : il manque ${missing.join(', ')}.`, 'mauvais');
          return true;
        }
        g.ui.eventDialog('Le Synthétiseur', 'Tous les composants sont réunis. La synthèse prendra trois minutes, et le vacarme des machines attirera tout ce qui vit dans la glace. Préparez vos défenses : postez l\'équipage, rechargez, réparez.', [
          {
            text: 'Lancer la synthèse',
            action: () => {
              this.setFlag('synthese');
              this.synthT = 0;
              this.synthWave = 0;
              this.done('synthese');
              for (const id of ['spores_lumen', 'isotope', 'catalyseur']) g.removeItem(id);
              g.audio.play('alarm');
              g.ui.toast('Synthèse lancée ! Tenez trois minutes !', 'mauvais');
            },
          },
          { text: 'Pas encore', action: () => undefined },
        ]);
        return true;
      }
    }
    return false;
  }

  adjustStock(node: MapNode, stock: TraderStock): void {
    if (!this.active) return;
    if (node.id === 'carrefour') {
      for (const id of ['combinaison', 'geiger', 'masque']) if (!stock.gear.includes(id) && !this.game.hasItem(id)) stock.gear.push(id);
      stock.resources.filtres = Math.max(stock.resources.filtres ?? 0, 10);
      stock.resources.antirad = Math.max(stock.resources.antirad ?? 0, 4);
    }
    if (node.id === 'givre') {
      if (!stock.gear.includes('manteau')) stock.gear.push('manteau');
      stock.resources.charbon = Math.max(stock.resources.charbon ?? 0, 120);
    }
    if (node.id === 'port_gris') stock.resources.filtres = Math.max(stock.resources.filtres ?? 0, 8);
  }

  onPrisonersFreed(lv: StationLevel): void {
    const g = this.game;
    const rng = new Rng(lv.node.seed).fork('prisonniers');
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const id = `${lv.node.id}:prisonnier:${i}`;
      if (this.st.npcs[id]) continue;
      const npc = generateNpc(rng.fork(id), id, { shady: 0.5 });
      npc.stationId = lv.node.id;
      npc.status = 'resident';
      npc.recruitable = true;
      npc.fee = 0;
      npc.affinity = 35;
      this.st.npcs[id] = npc;
      lv.delta.residents.push(id);
      const c = lv.ctx.spots.cage ?? { x: g.player.x, z: g.player.z };
      lv.addResident(npc, c.x + (i - 1) * 1.2, c.z + 3, 0);
    }
    g.gainXp(20);
    g.ui.toast('Les prisonniers sont libres ! Parlez-leur : ils veulent rejoindre le convoi.', 'bon');
  }

  onConfession(n: NpcState): void {
    if (n.id === 'silas') this.unmaskSilas();
  }

  onEvidence(n: NpcState): void {
    if (n.id === 'silas') this.game.ui.toast('Une preuve contre Silas ! Confrontez-le (Interroger → menace ou direct).', 'info');
  }

  private unmaskSilas(): void {
    const g = this.game;
    this.setFlag('silas_demasque');
    this.st.npcs.silas.known.secret = true;
    g.events.ambushBonus = 0;
    g.log('Silas Vex démasqué : un espion du Syndicat de la Rouille.', 'quete');
    g.ui.questBanner('Silas démasqué', 'L\'informateur travaillait pour le Syndicat de la Rouille. Décidez de son sort : cellule, expulsion… ou surveillance.');
  }

  // ------------------------------------------------------------------ dialogues scénarisés

  /** Vrai si un objectif en cours demande de parler à ce PNJ (marqueur « ! »). */
  wantsTalk(npc: NpcState): boolean {
    if (!this.active || !npc.dialogue || npc.status === 'mort') return false;
    const q = this.main();
    if (!q) return false;
    const open = (id: string) => q.objectives.some((o) => o.id === id && !o.done);
    switch (npc.dialogue) {
      case 'delorme': return open('maire');
      case 'silas': return open('silas');
      case 'ingrid': return open('ingrid') || open('plan');
      case 'mila': return open('mila');
      case 'elise':
      case 'bastien': return open('equipe') && npc.status === 'resident';
      default: break;
    }
    const start = this.dialogueFor(npc)?.start;
    return !!start && start.options.some((o) => o.tone === 'quete' && (!o.cond || o.cond()));
  }

  dialogueFor(npc: NpcState): DialogueTree | null {
    if (!this.active || !npc.dialogue) return null;
    const g = this.game;
    const st = this.st;
    const q = this.main();
    const stage = q?.stage ?? 0;
    const close = { text: 'Au revoir.', next: null };
    switch (npc.dialogue) {
      case 'delorme':
        return {
          start: {
            text: () => stage === 0
              ? 'Ah, vous voilà. Regardez cette ville… La moitié du quartier des Saules tousse du gris. Le Dr Varga dit qu\'un remède existe, là-haut, à Polaris. Je n\'ai qu\'une locomotive et qu\'un conducteur. Vous.'
              : 'Revenez-nous vivant, conducteur. Avec le remède.',
            options: [
              { text: 'Polaris ? C\'est à l\'autre bout du Réseau.', next: 'polaris', cond: () => stage === 0 },
              { text: 'Que puis-je emporter ?', next: 'aide', cond: () => stage === 0 },
              close,
            ],
          },
          polaris: {
            text: 'Je sais. Bandits, monstres, radiations, et l\'hiver qui arrive. Mais si on ne fait rien, Cendrebourg sera une ville fantôme avant le printemps. Élise vous expliquera pour les composants. Bastien a remis L\'Espérance en état, il vous accompagnera.',
            options: [{ text: 'Je pars.', next: 'aide' }],
          },
          aide: {
            text: 'La tour à charbon est à vous, remplissez le tender. Prenez aussi ces jetons : c\'est tout ce que la ville peut donner. Et passez par l\'atelier si vous voulez équiper le train.',
            options: [
              {
                text: 'Merci, monsieur le maire.',
                next: null,
                action: () => {
                  if (!this.flag('don_maire')) {
                    this.setFlag('don_maire');
                    addResource(st, 'jetons', 60);
                    g.ui.toast('+60 jetons', 'bon');
                  }
                },
              },
            ],
          },
        };
      case 'elise':
        return {
          start: {
            text: () => npc.status === 'resident'
              ? 'Conducteur. J\'ai étudié la Fièvre avec le Pr Hallström avant qu\'il ne parte pour Polaris. Trois composants : les Spores de Lumen de Creux-Noir, l\'isotope de Valpierre, le catalyseur K-9 de Morne-Brume. Et le synthétiseur de Polaris pour les assembler.'
              : stage < 2 ? 'Les Lumen ne poussent que dans le noir complet. Prenez une lampe, et méfiez-vous de ce qui les garde.' : stage < 4 ? 'Avec les radiations de Valpierre, chaque minute compte. Gardez des pilules anti-rad sur vous.' : 'Nous y sommes presque. Hallström serait fier.',
            options: [
              { text: 'Montez à bord, docteur.', next: 'embarque', cond: () => npc.status === 'resident', tone: 'quete' },
              { text: 'Comment se soigner en route ?', next: 'soins' },
              close,
            ],
          },
          embarque: {
            text: 'J\'ai préparé ma trousse depuis des jours. Installez-moi près des malades : si vous ajoutez une infirmerie au train, je pourrai faire des miracles.',
            options: [{ text: 'En route.', next: null, action: () => { const err = g.crewSystem.recruit(npc); if (err) g.ui.toast(err, 'mauvais'); else { npc.job = 'medecin'; } } }],
          },
          soins: {
            text: 'Affectez-moi au poste de médecin : je soignerai les blessés et je repérerai la Fièvre avant qu\'elle ne se voie. Il me faudra des médicaments. Une infirmerie isole les contagieux, et un wagon chauffé évite la grippe. N\'entassez pas les malades.',
            options: [{ text: 'Compris.', next: 'start' }],
          },
        };
      case 'bastien':
        return {
          start: {
            text: () => npc.status === 'resident'
              ? 'Hé, le patron ! Elle est belle, hein, ma vieille Espérance ? Chaudière refaite, dynamo graissée. Il ne lui manque qu\'un bon chauffeur… et ce sera moi !'
              : 'Elle tient le coup, la vieille ! Si un wagon prend cher, je m\'en occupe. Gardez juste de la ferraille en soute.',
            options: [
              { text: 'Bienvenue à bord, Boulon.', next: 'embarque', cond: () => npc.status === 'resident', tone: 'quete' },
              { text: 'Des conseils pour le train ?', next: 'conseils' },
              close,
            ],
          },
          embarque: {
            text: 'Je prends la pelle. Avec moi au charbon, on économise et vous pourrez régler la vitesse depuis n\'importe où avec l\'interphone. Et quand ça casse, je répare !',
            options: [{ text: 'Parfait.', next: null, action: () => { const err = g.crewSystem.recruit(npc); if (err) g.ui.toast(err, 'mauvais'); else { npc.job = 'chauffeur'; npc.wagon = st.train.wagons[0].uid; g.crew.get(npc.id)?.resetSpot(); } } }],
          },
          conseils: {
            text: 'Trois choses. Un : le charbon, c\'est la vie — à pleine vapeur on bouffe tout et la chaudière surchauffe. Deux : l\'énergie se partage entre lumière, chauffage, armes et boucliers, réglez ça au tableau (Tab). Trois : un wagon trop abîmé lâche son attelage et emporte tout ce qui suit. Faites passer les gens vers l\'avant avant que ça casse !',
            options: [{ text: 'Merci, Bastien.', next: 'start' }],
          },
        };
      case 'mila':
        return {
          start: {
            text: () => npc.status === 'resident' ? '… Vous n\'êtes pas une de ces choses ? Oh, merci, merci ! Ça fait trois jours que je suis cachée ici. La reine… elle pond au fond de la galerie 7, près des champignons qui brillent.' : 'Je connais chaque recoin du Réseau entre ici et le Carrefour. Comptez sur moi pour repérer les embuscades.',
            options: [
              { text: 'Viens, on t\'emmène.', next: null, cond: () => npc.status === 'resident', tone: 'quete', action: () => { const err = g.crewSystem.recruit(npc); if (err) g.ui.toast(err, 'mauvais'); } },
              close,
            ],
          },
        };
      case 'silas':
        return {
          start: {
            text: () => npc.status === 'resident'
              ? 'Le fameux conducteur de Cendrebourg ! Tout le Carrefour parle de vous. Silas Vex, informateur, pour vous servir. Vous cherchez la route de Valpierre ? Je la connais par cœur… et quelques raccourcis que les cartes ignorent.'
              : this.flag('silas_demasque') ? 'Vous avez gagné cette manche, conducteur. Mais le Syndicat n\'oublie jamais.' : 'Le Réseau est un grand marché. Il suffit de savoir qui achète quoi.',
            options: [
              { text: 'Parlez-moi de Valpierre.', next: 'valpierre', cond: () => npc.status === 'resident' },
              { text: 'Venez avec nous comme guide.', next: 'rejoindre', cond: () => npc.status === 'resident', tone: 'quete' },
              { text: 'Je préfère me passer de vos services.', next: 'refus', cond: () => npc.status === 'resident' },
              { text: 'Que faire de lui ? (sort de Silas)', next: 'sort', cond: () => this.flag('silas_demasque') && npc.status === 'equipage', tone: 'danger' },
              close,
            ],
          },
          valpierre: {
            text: 'La centrale est un four à radiations. Le réacteur est fermé par une carte rouge — le casier du chef d\'équipe, salle de contrôle. Le code de la salle traîne dans les bureaux de l\'administration. Sans combinaison, vous fondez en dix minutes. Mama Jo en vend, hors de prix. La milice de Garde-Fer en distribue à ceux qui leur rendent service.',
            options: [{ text: 'Merci pour l\'information.', next: 'start', action: () => this.done('silas') }],
          },
          rejoindre: {
            text: 'Avec plaisir ! Un guide, un négociateur, un charmeur… je vous ferai économiser plus de jetons que je n\'en coûte. Et je ne demande même pas de salaire. Juste une couchette et une part de l\'aventure.',
            options: [{ text: 'Marché conclu.', next: null, action: () => { this.done('silas'); const err = g.crewSystem.recruit(npc); if (err) g.ui.toast(err, 'mauvais'); } }],
          },
          refus: {
            text: 'Dommage. Le Réseau est dangereux pour ceux qui voyagent seuls… Bonne route, conducteur.',
            options: [{ text: '(Partir)', next: null, action: () => { this.done('silas'); this.setFlag('silas_refuse'); g.events.ambushBonus += 0.3; } }],
          },
          sort: {
            text: 'Silas vous regarde, un sourire en coin. « Alors, conducteur ? La cellule, la voie ferrée… ou vous me gardez sous la main ? Je pourrais encore vous être utile. »',
            options: [
              { text: 'Le garder sous surveillance', next: null, action: () => { this.setFlag('silas_surveille'); npc.affinity = -20; g.ui.toast('Silas reste à bord, sous surveillance. Il ne pourra plus rien tenter.', 'info'); } },
              { text: 'L\'enfermer (wagon cellulaire)', next: null, action: () => { const err = g.crewSystem.imprison(npc); if (err) g.ui.toast(err, 'mauvais'); else this.setFlag('silas_surveille'); } },
              { text: 'Le jeter du train', next: null, tone: 'danger', action: () => { if (g.isTravelling()) g.crewSystem.expel(npc); else g.crewSystem.dismiss(npc); this.setFlag('silas_parti'); } },
            ],
          },
        };
      case 'mamajo':
        return {
          start: {
            text: 'Approche, approche ! Combinaisons anti-radiations, compteurs Geiger, masques à gaz, filtres… Mama Jo a tout ce qu\'il faut pour aller mourir un peu moins vite.',
            options: [
              { text: 'Voyons la marchandise.', next: null, action: () => g.ui.openTrade(st.map.nodes.carrefour) },
              { text: 'Un conseil pour Valpierre ?', next: 'conseil' },
              close,
            ],
          },
          conseil: {
            text: 'Combinaison sur le dos, Geiger à la ceinture, et des pilules anti-rad dans la poche. Le réacteur crache fort. Et ne traîne pas : même ton train finira par cracher du vert.',
            options: [{ text: 'Merci.', next: 'start' }],
          },
        };
      case 'lambert':
        return {
          start: {
            text: () => this.flag('lambert_mission') && !this.flag('lambert_ok')
              ? `Alors, ces pillards ? Il m'en faut huit au tapis. (${this.st.flags.lambert_kills ?? 0}/8)`
              : this.flag('lambert_ok') ? 'Garde-Fer n\'oublie pas ses amis. Bonne route vers la Zone.' : 'Halte ! Garde-Fer contrôle la route de la Zone. Si vous voulez passer avec du matériel de la milice, il faudra le mériter.',
            options: [
              { text: 'Que faut-il faire ?', next: 'mission', cond: () => !this.flag('lambert_mission') },
              { text: 'C\'est fait.', next: 'recompense', cond: () => this.flag('lambert_mission') && !this.flag('lambert_ok') && Number(this.st.flags.lambert_kills ?? 0) >= 8, tone: 'quete' },
              close,
            ],
          },
          mission: {
            text: 'Une bande du Syndicat tient les hangars au nord de l\'avant-poste. Abattez-en huit. En échange : une combinaison anti-radiations et la carte rouge du réacteur de Valpierre, récupérée sur un déserteur.',
            options: [{ text: 'J\'accepte.', next: null, tone: 'quete', action: () => { this.setFlag('lambert_mission'); this.spawnLambertBandits(); } }],
          },
          recompense: {
            text: 'Beau travail. Voici votre paiement. Et un conseil : à Valpierre, ne restez pas à quai plus de quelques minutes.',
            options: [{
              text: 'Merci, commandant.', next: null, action: () => {
                this.setFlag('lambert_ok');
                g.giveItem('combinaison');
                g.giveItem('carte:valpierre:rouge');
                addResource(st, 'balles', 60);
                g.gainXp(40);
                this.recheck();
              },
            }],
          },
        };
      case 'ingrid':
        return {
          start: {
            text: () => npc.status === 'resident'
              ? 'Polaris ? Personne n\'y va plus. J\'y étais ingénieure, avant que la direction ne ferme la ligne et que le froid ne prenne tout. Et vous croyez à ce remède ? Prouvez-le-moi.'
              : 'Le Col est traître. Suivez le plan, levier par levier.',
            options: [
              { text: 'Montrer le carnet du Pr Hallström', next: 'preuve', cond: () => npc.status === 'resident' && g.hasItem('formule'), tone: 'quete' },
              { text: 'Je n\'ai pas encore de preuve.', next: null, cond: () => npc.status === 'resident' && !g.hasItem('formule') },
              { text: 'Rappelez-moi la combinaison.', next: 'combi', cond: () => g.hasItem('plan_col') },
              close,
            ],
          },
          preuve: {
            text: 'L\'écriture de Hallström… Il y croyait vraiment. Bon. Je viens avec vous. Voici le plan des aiguillages : au Col, réglez les leviers A, B et C dans cet ordre exact, sinon la voie vous jette dans le ravin.',
            options: [{
              text: 'Bienvenue à bord, Ingrid.', next: 'combi', action: () => {
                this.done('ingrid');
                g.giveItem('plan_col');
                const err = g.crewSystem.recruit(npc);
                if (err) g.ui.toast(err, 'mauvais');
                this.recheck();
              },
            }],
          },
          combi: {
            text: () => {
              const c = String(this.st.flags.combi ?? 'GDG');
              const w = (ch: string) => (ch === 'G' ? 'Gauche' : 'Droite');
              return `Levier A : ${w(c[0])}. Levier B : ${w(c[1])}. Levier C : ${w(c[2])}. Les leviers sont au nord des voies, sur le faisceau.`;
            },
            options: [{ text: 'Noté.', next: null, action: () => { if (!this.st.journal.notes.some((n) => n.id === 'plan_col')) { const c = String(this.st.flags.combi ?? 'GDG'); const w = (ch: string) => (ch === 'G' ? 'Gauche' : 'Droite'); st.journal.notes.push({ id: 'plan_col', title: 'Plan des aiguillages du Col', text: `A : ${w(c[0])} — B : ${w(c[1])} — C : ${w(c[2])}`, station: 'givre', time: st.time }); } } }],
          },
        };
      case 'anselme':
        return {
          start: {
            text: () => npc.status === 'resident' ? 'Paix sur vous, voyageur. Je vois à vos yeux que vous allez loin. J\'étais physicien, avant. Les radiations, je les connais… et la Fièvre aussi. Si vous allez à Polaris, laissez-moi vous accompagner.' : 'Que la lumière vous garde, conducteur.',
            options: [
              { text: 'Venez avec nous, mon frère.', next: null, cond: () => npc.status === 'resident', tone: 'quete', action: () => { const err = g.crewSystem.recruit(npc); if (err) g.ui.toast(err, 'mauvais'); else npc.job = 'medecin'; } },
              close,
            ],
          },
        };
      case 'nadia':
        return {
          start: {
            text: () => npc.status === 'resident' ? 'Lambert garde ses soldats derrière des sacs de sable pendant que le Réseau crève. Moi, je veux me battre pour quelque chose. Votre remède, c\'est quelque chose. Je viens, pour 60 jetons — le prix de ma désertion.' : 'Montrez-moi où tirer.',
            options: [
              { text: `Engager Nadia (${npc.fee} jetons)`, next: null, cond: () => npc.status === 'resident', tone: 'quete', action: () => { const err = g.crewSystem.recruit(npc); if (err) g.ui.toast(err, 'mauvais'); else npc.job = 'garde'; } },
              close,
            ],
          },
        };
      case 'rosalie':
      case 'gaspard':
      case 'oscar':
        return null;
    }
    return null;
  }

  private spawnLambertBandits(): void {
    const g = this.game;
    const lv = g.stationLevel();
    if (!lv) return;
    for (let i = 0; i < 9; i++) {
      const e = g.spawnEnemy(i % 3 === 0 ? 'brute' : 'pillard', -60 + (i % 3) * 4, -30 - Math.floor(i / 3) * 3, lv.node.threat, 'station');
      e.group = 'lambert';
      e.persistId = `garde_fer:lambert:${i}`;
    }
    g.ui.toast('Les pillards sont au nord des voies, derrière les hangars.', 'info');
  }

  /** Comptage des éliminations pour la mission de Lambert. */
  countKill(groupOrStation: string | null): void {
    if (!this.flag('lambert_mission') || this.flag('lambert_ok')) return;
    if (groupOrStation === 'garde_fer') this.setFlag('lambert_kills', Number(this.st.flags.lambert_kills ?? 0) + 1);
  }

  wagonName(type: keyof typeof WAGON_TYPES): string {
    return WAGON_TYPES[type].name;
  }
}
