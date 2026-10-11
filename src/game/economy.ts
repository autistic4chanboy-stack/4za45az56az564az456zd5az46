import { RESOURCES, RESOURCE_IDS, GEAR, TOOLS, type ResourceId } from '../data/items';
import { WEAPONS, PLAYER_WEAPON_IDS, newWeapon } from '../data/weapons';
import { EQUIPMENT, EQUIP_IDS, DECOR, DECOR_IDS, WAGON_TYPES, BUYABLE_WAGONS, type WagonTypeId, type EquipId, type DecorId } from '../data/train';
import { ARCHETYPES, type ArchetypeId } from '../data/stations';
import { BAL, DIFFICULTIES } from '../data/balance';
import { Rng } from '../core/rng';
import { addResource, createWagon, wagonMaxHp, crewOnBoard } from '../state/trainState';
import { revealNeighbors } from '../world/map';
import type { Game } from './Game';
import type { MapNode, TraderStock } from '../state/types';
import type { SpecialSpec } from '../world/stationBuilder';
import type { StationLevel } from './stationLevel';

/** Multiplicateurs de prix par archétype (ce qui est bon marché ici). */
const CHEAP: Partial<Record<ArchetypeId, Partial<Record<ResourceId, number>>>> = {
  depot: { charbon: 0.6, ferraille: 0.8 },
  village: { nourriture: 0.6 },
  marche: { filtres: 0.85, crochets: 0.8 },
  avantposte: { balles: 0.65, cartouches: 0.7, obus: 0.75, dynamite: 0.8 },
  mine: { charbon: 0.4, dynamite: 0.7 },
  monastere: { medicaments: 0.7, trousses: 0.75, antirad: 0.85 },
  port: { nourriture: 0.7, filtres: 0.8 },
  serre: { nourriture: 0.5 },
  cimetiere: { ferraille: 0.55 },
  triage: { ferraille: 0.8, charbon: 0.8 },
};

export class Economy {
  constructor(private game: Game) {}

  private get st() {
    return this.game.state;
  }

  priceFactor(buying: boolean): number {
    const g = this.game;
    const diff = DIFFICULTIES[this.st.difficulty];
    const merchant = g.crewSystem.bestSkill('marchand');
    if (buying) return diff.prices * (g.player.hasPerk('negociant') ? 0.88 : 1) * (1 - 0.06 * merchant);
    return BAL.sellRatio * (g.player.hasPerk('negociant') ? 1.12 : 1) * (1 + 0.05 * merchant);
  }

  resourcePrice(id: ResourceId, node: MapNode | null, buying: boolean): number {
    const base = RESOURCES[id].price;
    const cheap = node ? CHEAP[node.archetype]?.[id] ?? 1 : 1.15;
    const stock = node ? this.st.stations[node.id]?.stock : null;
    const mod = stock?.priceMod ?? 1;
    const p = base * cheap * mod * this.priceFactor(buying);
    return Math.max(buying ? 1 : 0.2, Math.round(p * 10) / 10);
  }

  itemPrice(price: number, buying: boolean): number {
    return Math.max(1, Math.round(price * this.priceFactor(buying)));
  }

  /** Génère le stock d'un commerçant (une fois par visite, réapprovisionnement lent). */
  ensureStock(node: MapNode): TraderStock | null {
    const delta = this.st.stations[node.id];
    if (!delta) return null;
    const arch = ARCHETYPES[node.archetype];
    const trades = arch.services.includes('commerce') || arch.services.includes('atelier') || arch.services.includes('wagons') || arch.services.includes('charbon');
    if (!trades || node.hostility === 'hostile') return null;
    if (delta.stock && delta.stock.restock > this.st.time) return delta.stock;
    const rng = new Rng(node.seed + Math.floor(this.st.time / 1440));
    const tier = Math.min(3, Math.floor(node.threat / 1.4));
    const res: Partial<Record<ResourceId, number>> = {};
    for (const id of RESOURCE_IDS) {
      if (id === 'jetons') continue;
      const cheap = CHEAP[node.archetype]?.[id];
      const base = id === 'charbon' ? 90 : id === 'balles' ? 120 : id === 'nourriture' ? 50 : id === 'ferraille' ? 50 : id === 'cartouches' ? 30 : id === 'obus' ? 8 : 6;
      if (cheap || rng.chance(arch.services.includes('commerce') ? 0.6 : 0.25)) res[id] = Math.round(base * (cheap ? 1.8 : 0.6) * (0.6 + rng.next() * 0.8));
    }
    if (arch.services.includes('charbon')) res.charbon = Math.max(res.charbon ?? 0, 140 + rng.int(0, 80));
    const weapons = arch.services.includes('commerce') || node.archetype === 'avantposte' ? rng.shuffle(PLAYER_WEAPON_IDS.filter((w) => WEAPONS[w].tier > 0 && WEAPONS[w].tier <= tier + 1)).slice(0, rng.int(1, 3)) : [];
    const gear = arch.services.includes('commerce') ? rng.shuffle(Object.keys(GEAR)).slice(0, rng.int(1, 3)) : [];
    const tools = arch.services.includes('commerce') ? rng.shuffle(Object.keys(TOOLS)).slice(0, rng.int(1, 2)) : [];
    const equipment: EquipId[] = arch.services.includes('atelier') || node.archetype === 'marche' ? rng.shuffle([...EQUIP_IDS]).slice(0, rng.int(2, 4)) : [];
    const decor: DecorId[] = node.archetype === 'marche' || node.archetype === 'village' || node.archetype === 'port' ? rng.shuffle([...DECOR_IDS]).slice(0, rng.int(3, 6)) : [];
    const wagons: WagonTypeId[] = arch.services.includes('wagons') ? rng.shuffle([...BUYABLE_WAGONS]).slice(0, rng.int(3, 5)) : [];
    const stock: TraderStock = { resources: res, weapons, gear, tools, equipment, decor, wagons, priceMod: 0.9 + rng.next() * 0.25, restock: this.st.time + 1440 };
    this.game.story.adjustStock(node, stock);
    delta.stock = stock;
    return stock;
  }

  // ------------------------------------------------------------------ achats / ventes

  buyResource(node: MapNode, id: ResourceId, qty: number): string | null {
    const stock = this.ensureStock(node);
    if (!stock) return 'Personne ne vend ici.';
    const avail = stock.resources[id] ?? 0;
    qty = Math.min(qty, avail);
    if (qty <= 0) return 'Rupture de stock.';
    const price = this.resourcePrice(id, node, true);
    const cost = Math.ceil(price * qty);
    if ((this.st.train.resources.jetons ?? 0) < cost) return `Il faut ${cost} jetons.`;
    const added = addResource(this.st, id, qty);
    if (added <= 0) return id === 'charbon' ? 'Tender plein.' : 'Soute pleine.';
    const realCost = Math.ceil(price * added);
    this.st.train.resources.jetons -= realCost;
    stock.resources[id] = avail - added;
    this.game.audio.play('coin');
    return null;
  }

  sellResource(node: MapNode, id: ResourceId, qty: number): string | null {
    const have = this.st.train.resources[id] ?? 0;
    qty = Math.min(qty, have);
    if (qty <= 0 || id === 'jetons') return 'Rien à vendre.';
    const price = this.resourcePrice(id, node, false);
    const gain = Math.floor(price * qty);
    this.st.train.resources[id] -= qty;
    this.st.train.resources.jetons += gain;
    const stock = this.st.stations[node.id]?.stock;
    if (stock) stock.resources[id] = (stock.resources[id] ?? 0) + qty;
    this.game.audio.play('coin');
    return null;
  }

  pay(cost: number): boolean {
    if ((this.st.train.resources.jetons ?? 0) < cost) {
      this.game.ui.toast(`Il faut ${cost} jetons.`, 'mauvais');
      this.game.audio.play('error');
      return false;
    }
    this.st.train.resources.jetons -= cost;
    this.game.audio.play('coin');
    return true;
  }

  buyWeapon(node: MapNode, id: string): string | null {
    const stock = this.ensureStock(node);
    if (!stock?.weapons.includes(id)) return 'Indisponible.';
    const cost = this.itemPrice(WEAPONS[id].price, true);
    const slot = this.st.player.weapons.findIndex((w) => w === null);
    if (slot < 0) return 'Vos 4 emplacements d\'armes sont pleins : vendez-en une d\'abord.';
    if (!this.pay(cost)) return null;
    this.st.player.weapons[slot] = newWeapon(id);
    stock.weapons = stock.weapons.filter((w) => w !== id);
    return null;
  }

  sellWeapon(slot: number): void {
    const w = this.st.player.weapons[slot];
    if (!w || w.id === 'cle') return;
    const gain = Math.floor(WEAPONS[w.id].price * (1 + 0.3 * w.level) * this.priceFactor(false));
    this.st.train.resources.jetons += gain;
    this.st.player.weapons[slot] = null;
    if (this.st.player.active === slot) this.st.player.active = 0;
    this.game.audio.play('coin');
  }

  buyGear(node: MapNode, id: string, kind: 'gear' | 'tool'): string | null {
    const stock = this.ensureStock(node);
    const list = kind === 'gear' ? stock?.gear : stock?.tools;
    if (!list?.includes(id)) return 'Indisponible.';
    const price = kind === 'gear' ? GEAR[id].price : TOOLS[id].price;
    if (!this.pay(this.itemPrice(price, true))) return null;
    this.st.player.items[id] = (this.st.player.items[id] ?? 0) + 1;
    if (kind === 'gear') stock!.gear = stock!.gear.filter((g) => g !== id);
    else stock!.tools = stock!.tools.filter((g) => g !== id);
    this.game.emit({ type: 'item', id, qty: 1 });
    return null;
  }

  buyEquip(node: MapNode, id: EquipId): string | null {
    const stock = this.ensureStock(node);
    if (!stock?.equipment.includes(id)) return 'Indisponible.';
    const def = EQUIPMENT[id];
    const cost = this.itemPrice(def.price, true);
    if ((this.st.train.resources.ferraille ?? 0) < Math.round(def.scrap * 0.3)) return `Il faut aussi ${Math.round(def.scrap * 0.3)} ferraille pour le montage.`;
    if (!this.pay(cost)) return null;
    this.st.train.resources.ferraille -= Math.round(def.scrap * 0.3);
    this.st.train.spare.equip.push({ id, level: 0 });
    this.game.ui.toast(`${def.name} achetée : installez-la depuis le menu Train (T).`, 'bon');
    return null;
  }

  buyDecor(node: MapNode, id: DecorId): string | null {
    const stock = this.ensureStock(node);
    if (!stock?.decor.includes(id)) return 'Indisponible.';
    if (!this.pay(this.itemPrice(DECOR[id].price, true))) return null;
    this.st.train.spare.decor.push(id);
    stock.decor = stock.decor.filter((d) => d !== id);
    this.game.ui.toast(`${DECOR[id].name} achetée : installez-la depuis le menu Train (T).`, 'bon');
    return null;
  }

  buyWagon(node: MapNode, type: WagonTypeId): string | null {
    const stock = this.ensureStock(node);
    if (!stock?.wagons.includes(type)) return 'Indisponible.';
    if (this.st.train.wagons.length >= 12) return 'Le convoi est trop long (12 wagons max).';
    const def = WAGON_TYPES[type];
    const cost = this.itemPrice(def.price, true);
    if ((this.st.train.resources.ferraille ?? 0) < def.scrap) return `Il faut aussi ${def.scrap} ferraille.`;
    if (!this.pay(cost)) return null;
    this.st.train.resources.ferraille -= def.scrap;
    this.st.train.wagons.push(createWagon(type, `w${this.st.nextId++}`));
    stock.wagons = stock.wagons.filter((w) => w !== type);
    this.game.train.rebuild();
    this.game.invalidateTrainInteractables();
    this.game.audio.play('build');
    return null;
  }

  sellWagon(index: number): string | null {
    const w = this.st.train.wagons[index];
    if (!w || index === 0) return 'Impossible.';
    const people = crewOnBoard(this.st).filter((n) => n.wagon === w.uid);
    if (people.length) return 'Des personnes occupent ce wagon : déplacez-les d\'abord.';
    const def = WAGON_TYPES[w.type];
    const gain = Math.round(def.price * 0.4 * (w.hp / wagonMaxHp(this.st, w)));
    for (const s of w.slots) if (s.equip) this.st.train.spare.equip.push({ id: s.equip, level: s.level });
    for (const d of w.decor) if (d) this.st.train.spare.decor.push(d);
    this.st.train.wagons.splice(index, 1);
    this.st.train.resources.jetons += gain;
    this.game.train.rebuild();
    this.game.invalidateTrainInteractables();
    this.game.syncCrewActors(true);
    this.game.audio.play('coin');
    return null;
  }

  /** Coût d'une réparation complète en gare (atelier). */
  repairCost(): { jetons: number; ferraille: number; hp: number } {
    let hp = 0;
    for (const w of this.st.train.wagons) {
      hp += wagonMaxHp(this.st, w) - w.hp;
      hp += 100 - w.heater.hp + 100 - w.lights.hp;
      for (const s of w.slots) if (s.equip) hp += EQUIPMENT[s.equip].hp - s.hp;
    }
    return { jetons: Math.ceil(hp * 0.25 * this.priceFactor(true)), ferraille: Math.ceil(hp / BAL.hpPerScrap * 0.5), hp };
  }

  repairAll(): string | null {
    const c = this.repairCost();
    if (c.hp <= 0) return 'Le convoi est en parfait état.';
    if ((this.st.train.resources.ferraille ?? 0) < c.ferraille) return `Il faut ${c.ferraille} ferraille.`;
    if (!this.pay(c.jetons)) return null;
    this.st.train.resources.ferraille -= c.ferraille;
    for (const w of this.st.train.wagons) {
      w.hp = wagonMaxHp(this.st, w);
      w.heater.hp = 100;
      w.lights.hp = 100;
      w.fire = 0;
      for (const s of w.slots) if (s.equip) s.hp = EQUIPMENT[s.equip].hp;
    }
    this.game.audio.play('repair');
    return null;
  }

  healCost(): number {
    let c = this.st.player.hp < this.game.player.maxHp ? 10 : 0;
    if (this.st.player.disease) c += 25;
    if (this.st.player.rads > 50) c += Math.round(this.st.player.rads / 10);
    for (const n of crewOnBoard(this.st)) {
      if (n.hp < n.maxHp) c += 5;
      if (n.disease) c += 20;
      if (n.rads > 50) c += Math.round(n.rads / 15);
    }
    return Math.round(c * this.priceFactor(true));
  }

  healAll(): string | null {
    const c = this.healCost();
    if (c <= 0) return 'Tout le monde est en bonne santé.';
    if (!this.pay(c)) return null;
    this.st.player.hp = this.game.player.maxHp;
    this.st.player.disease = null;
    this.st.player.rads = 0;
    for (const n of crewOnBoard(this.st)) {
      n.hp = n.maxHp = 100;
      n.disease = null;
      n.rads = 0;
    }
    this.game.player.heal(999);
    this.game.audio.play('success');
    return null;
  }

  buyInfo(node: MapNode): string | null {
    if (!this.pay(this.itemPrice(20, true))) return null;
    revealNeighbors(this.st.map, node.id, true);
    for (const l of node.links) {
      const n = this.st.map.nodes[l];
      if (n) revealNeighbors(this.st.map, n.id, false);
    }
    this.game.ui.toast('Carte mise à jour : gares voisines repérées.', 'bon');
    return null;
  }

  rest(): string | null {
    const g = this.game;
    if (!this.pay(this.itemPrice(8, true))) return null;
    const now = this.st.time % 1440;
    const wake = 7 * 60;
    const wait = now < wake ? wake - now : 1440 - now + wake;
    this.st.time += wait;
    g.player.heal(999);
    this.st.player.warmth = 100;
    for (const n of crewOnBoard(this.st)) {
      n.morale = Math.min(100, n.morale + 15);
      n.hp = Math.min(n.maxHp, n.hp + 30);
    }
    // la nuit passe : les vivres aussi
    const eaters = crewOnBoard(this.st).length + 1;
    this.st.train.resources.nourriture = Math.max(0, (this.st.train.resources.nourriture ?? 0) - Math.round(eaters * BAL.foodPerHour * wait / 60));
    g.ui.toast('Une bonne nuit à l\'auberge. Tout le monde est reposé.', 'bon');
    return null;
  }

  // ------------------------------------------------------------------ interactifs spéciaux

  specialLabel(s: SpecialSpec, lv: StationLevel): string | null {
    const d = lv.delta;
    switch (s.action) {
      case 'tour_charbon': {
        const price = this.resourcePrice('charbon', lv.node, true);
        return `Tour à charbon : remplir le tender (${price} jetons/unité)`;
      }
      case 'terril':
        return (d.flags[s.id] ?? 0) >= 3 ? 'Terril épuisé' : 'Ramasser du charbon (maintenir E)';
      case 'cage':
        return d.flags.cage ? null : 'Libérer les prisonniers';
      case 'soins':
        return `Soins des frères (${this.healCost()} jetons)`;
      case 'pompe':
        return d.flags.pompe ? 'Pompe réparée' : 'Réparer la pompe (15 ferraille)';
      case 'radio':
        return d.flags.radio ? 'Émetteur en marche' : 'Relancer l\'émetteur (fusible ou 25 ferraille)';
    }
    if (s.action.startsWith('recup_wagon:')) {
      if (d.flags[s.id]) return null;
      const type = s.action.split(':')[1] as WagonTypeId;
      return `Remettre en état : ${WAGON_TYPES[type].name} (${Math.round(WAGON_TYPES[type].scrap * 0.8)} ferraille)`;
    }
    return null;
  }

  handleSpecial(s: SpecialSpec, lv: StationLevel): boolean {
    const g = this.game;
    const st = this.st;
    const d = lv.delta;
    switch (s.action) {
      case 'tour_charbon': {
        g.ui.openTrade(lv.node, 'charbon');
        return true;
      }
      case 'terril': {
        const used = d.flags[s.id] ?? 0;
        if (used >= 3) return true;
        d.flags[s.id] = used + 1;
        const q = addResource(st, 'charbon', 10 + Math.floor(Math.random() * 8));
        g.ui.toast(q > 0 ? `+${q} charbon` : 'Tender plein !', q > 0 ? 'bon' : 'mauvais');
        g.audio.play('shovel');
        return true;
      }
      case 'cage': {
        if (d.flags.cage) return true;
        const near = lv.enemies.some((e) => e.alive && Math.hypot(e.x - s.x, e.z - s.z) < 18);
        if (near) {
          g.ui.toast('Des bandits montent la garde : éliminez-les d\'abord.', 'mauvais');
          return true;
        }
        d.flags.cage = 1;
        g.story.onPrisonersFreed(lv);
        return true;
      }
      case 'soins': {
        const err = this.healAll();
        if (err) g.ui.toast(err, 'info');
        return true;
      }
      case 'pompe': {
        if (d.flags.pompe) return true;
        if ((st.train.resources.ferraille ?? 0) < 15) {
          g.ui.toast('Il faut 15 ferraille.', 'mauvais');
          return true;
        }
        st.train.resources.ferraille -= 15;
        d.flags.pompe = 1;
        addResource(st, 'nourriture', 12);
        addResource(st, 'jetons', 40);
        g.gainXp(20);
        g.ui.toast('La pompe repart ! Les habitants vous remercient : +40 jetons, +12 vivres.', 'bon');
        g.audio.play('success');
        return true;
      }
      case 'radio': {
        if (d.flags.radio) return true;
        if (g.hasItem('fusible')) g.removeItem('fusible');
        else if ((st.train.resources.ferraille ?? 0) >= 25) st.train.resources.ferraille -= 25;
        else {
          g.ui.toast('Il faut un fusible industriel ou 25 ferraille.', 'mauvais');
          return true;
        }
        d.flags.radio = 1;
        for (const n of Object.values(st.map.nodes)) {
          if (n.hidden) continue;
          if (n.layer <= lv.node.layer + 3) {
            n.known = true;
            n.scouted = true;
          }
        }
        g.gainXp(25);
        g.audio.play('success');
        g.ui.toast('L\'émetteur grésille puis capte le Réseau : la carte des environs est révélée !', 'bon');
        g.emit({ type: 'special', action: 'radio', station: lv.node.id });
        return true;
      }
    }
    if (s.action.startsWith('recup_wagon:')) {
      if (d.flags[s.id]) return true;
      const type = s.action.split(':')[1] as WagonTypeId;
      const cost = Math.round(WAGON_TYPES[type].scrap * 0.8);
      if (st.train.wagons.length >= 12) {
        g.ui.toast('Le convoi est déjà trop long.', 'mauvais');
        return true;
      }
      if ((st.train.resources.ferraille ?? 0) < cost) {
        g.ui.toast(`Il faut ${cost} ferraille.`, 'mauvais');
        return true;
      }
      st.train.resources.ferraille -= cost;
      d.flags[s.id] = 1;
      const w = createWagon(type, `w${st.nextId++}`);
      w.hp = Math.round(w.hp * 0.6);
      st.train.wagons.push(w);
      g.train.rebuild();
      g.invalidateTrainInteractables();
      g.audio.play('build');
      g.ui.toast(`${WAGON_TYPES[type].name} remis en état et attelé au convoi !`, 'bon');
      g.gainXp(15);
      return true;
    }
    return false;
  }

  openRoadTrader(node: MapNode): void {
    // marchand ambulant : stock dérivé de la destination
    const pseudo: MapNode = { ...node, id: `draisine:${node.id}`, archetype: 'marche' };
    const st = this.st;
    st.stations[pseudo.id] ??= { looted: [], opened: [], killed: [], taken: [], levers: {}, flags: {}, visits: 1, lastVisit: st.time, residents: [], stock: null, dwell: 0 };
    st.map.nodes[pseudo.id] = pseudo;
    this.ensureStock(pseudo);
    this.game.ui.openTrade(pseudo, null, () => {
      delete st.map.nodes[pseudo.id];
    });
  }

  tick(_dt: number): void {
    /* réapprovisionnement géré à la demande */
  }
}
