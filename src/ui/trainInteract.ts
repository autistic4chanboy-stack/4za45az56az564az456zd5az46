import { EQUIPMENT, DECOR, WAGON_TYPES } from '../data/train';
import { BAL } from '../data/balance';
import { wagonMaxHp } from '../state/trainState';
import { FLOOR } from '../train/trainModel';
import type { Game } from '../game/Game';
import type { Interactable } from '../game/types';

/** Interactifs du train : conduite, chaudière, maintenance, tourelles, confort… */
export function buildTrainInteractables(game: Game): Interactable[] {
  const out: Interactable[] = [];
  const train = game.train;
  const st = () => game.state;
  const repairMult = () => (game.player.hasPerk('mecano') ? 1.5 : 1) * ((st().player.items.trousse_outils ?? 0) > 0 ? 1.5 : 1);
  const scrapMult = () => (game.player.hasPerk('mecano') ? 0.75 : 1);

  for (const w of train.wagons) {
    const ws = w.state;
    const idx = w.index;
    const P = (key: string) => train.pointWorld(w, key);
    // poste de conduite
    const ctrl = P('controls');
    if (ctrl) {
      out.push({ id: `train:controls`, x: ctrl.x, y: FLOOR, z: ctrl.z, radius: 1.3, kind: 'machine', onTrain: true, label: () => 'Poste de conduite', interact: () => game.ui.openCab(), highlight: () => 0x80d0ff });
    }
    const fire = P('firebox');
    if (fire) {
      out.push({
        id: 'train:firebox', x: fire.x, y: FLOOR, z: fire.z + 0.4, radius: 1.1, kind: 'machine', onTrain: true,
        label: () => (st().train.heat > 60 ? 'Purger la chaudière' : 'Pelleter du charbon (3)'),
        interact: () => {
          const tr = st().train;
          if (tr.heat > 60) {
            tr.heat = Math.max(0, tr.heat - 45);
            tr.pressure = Math.max(0.3, tr.pressure - 0.25);
            game.engine.fx.steam(fire.x, 3, 1.6, train.speed, false);
            game.audio.play('chuff', { volume: 1 });
            return;
          }
          if ((tr.resources.charbon ?? 0) < 3) return game.ui.toast('Plus assez de charbon.', 'mauvais');
          tr.resources.charbon -= 3;
          tr.pressure = Math.min(1.15, tr.pressure + 0.12);
          train.shovelBoost = game.player.hasPerk('chauffeur') ? 14 : 9;
          game.audio.play('shovel');
          game.player.model.attack();
        },
      });
    }
    // panneau de maintenance : réparation de la coque (maintenir E)
    const m = P('maintenance');
    if (m) {
      out.push({
        id: `train:maint:${ws.uid}`, x: m.x, y: FLOOR, z: m.z, radius: 1.6, kind: 'reparation', onTrain: true,
        label: () => {
          const cur = st().train.wagons.find((x) => x.uid === ws.uid);
          if (!cur) return null;
          if (cur.fire > 0) return `Éteindre l'incendie du wagon ${idx + 1}`;
          const max = wagonMaxHp(st(), cur);
          if (cur.hp >= max) return null;
          if (idx === 0 && cur.hp < max * 0.2 && (st().train.resources.ferraille ?? 0) < 1) return `Réparation de fortune de la locomotive (${Math.round(cur.hp)}/${max})`;
          return `Réparer le wagon ${idx + 1} (${Math.round(cur.hp)}/${max}) — ferraille`;
        },
        hold: () => 0.5,
        interact: () => {
          const cur = st().train.wagons.find((x) => x.uid === ws.uid);
          if (!cur) return;
          if (cur.fire > 0) {
            cur.fire = Math.max(0, cur.fire - 0.3);
            game.engine.fx.puff(m.x, 2, m.z, 0xc8c8c8, 1.2, false, 0.6);
            game.audio.play('flame', { volume: 0.5, pitch: 0.6 });
            if (cur.fire <= 0) game.ui.toast('Incendie maîtrisé.', 'bon');
            return;
          }
          const amount = BAL.repairRate * 0.5 * repairMult();
          const cost = Math.max(1, Math.round((amount / BAL.hpPerScrap) * scrapMult()));
          // sans ferraille, la locomotive peut toujours être remise en marche (jusqu'à 20 %)
          const emergency = idx === 0 && cur.hp < wagonMaxHp(st(), cur) * 0.2 && (st().train.resources.ferraille ?? 0) < cost;
          if (!emergency && (st().train.resources.ferraille ?? 0) < cost) return game.ui.toast('Plus de ferraille pour réparer.', 'mauvais');
          if (!emergency) st().train.resources.ferraille -= cost;
          train.repairWagon(idx, emergency ? amount * 0.4 : amount);
          game.engine.fx.sparks(m.x, FLOOR + 1, m.z, 4);
          game.audio.play('repair', { x: m.x, z: m.z });
          game.player.model.attack();
        },
        highlight: () => 0xffb040,
      });
    }
    // chauffage et éclairage : bascule ou réparation
    const heater = P('heater');
    if (heater && WAGON_TYPES[ws.type].insulation > 0) {
      out.push(componentIt(game, `heater:${ws.uid}`, heater.x, heater.z, () => st().train.wagons.find((x) => x.uid === ws.uid)?.heater, 'chauffage', repairMult, scrapMult));
    }
    const lights = P('lights');
    if (lights) out.push(componentIt(game, `lights:${ws.uid}`, lights.x, lights.z, () => st().train.wagons.find((x) => x.uid === ws.uid)?.lights, 'éclairage', repairMult, scrapMult));
    // postes de tir
    ws.slots.forEach((slot, si) => {
      if (!slot.equip) return;
      const def = EQUIPMENT[slot.equip];
      const p = P(`gun${si}`) ?? (w.model.open ? { x: w.cx + (w.model.slotAnchors[si]?.x ?? 0), z: (w.model.slotAnchors[si]?.z ?? 0) * 0.4, y: FLOOR } : null);
      if (!p) return;
      out.push({
        id: `train:gun:${ws.uid}:${si}`, x: p.x, y: FLOOR, z: p.z, radius: 1.2, kind: 'tourelle', onTrain: true,
        label: () => {
          if (slot.hp <= 0) return `Réparer : ${def.name} (maintenir E)`;
          if (!def.weapon) return slot.on ? `${def.name} : couper` : `${def.name} : allumer`;
          return `Prendre les commandes : ${def.name}`;
        },
        hold: () => (slot.hp <= 0 ? 0.5 : 0),
        interact: () => {
          if (slot.hp <= 0 || slot.hp < def.hp * 0.999 && !def.weapon) {
            const amount = BAL.repairRate * 0.6 * repairMult();
            const cost = Math.max(1, Math.round((amount / BAL.hpPerScrap) * scrapMult()));
            if ((st().train.resources.ferraille ?? 0) < cost) return game.ui.toast('Plus de ferraille.', 'mauvais');
            st().train.resources.ferraille -= cost;
            slot.hp = Math.min(def.hp, slot.hp + amount);
            game.audio.play('repair');
            if (slot.hp >= def.hp * 0.5 && slot.hp - amount < def.hp * 0.5) game.ui.toast(`${def.name} réparé(e).`, 'bon');
            return;
          }
          if (!def.weapon) {
            slot.on = !slot.on;
            game.audio.play('ui');
            return;
          }
          const t = train.wagons[idx]?.turrets.find((tt) => tt.slotIndex === si);
          if (t) game.player.mount(t);
        },
        highlight: () => (slot.hp <= 0 ? 0xff6040 : 0x80d0ff),
      });
    });
    // établi, infirmerie, cuisine, générateur
    const bench = P('workbench');
    if (bench) out.push({ id: `train:bench:${ws.uid}`, x: bench.x, y: FLOOR, z: bench.z, radius: 1.3, kind: 'machine', onTrain: true, label: () => 'Établi : fabriquer, améliorer', interact: () => game.ui.openWorkbench() });
    const med = P('medcab');
    if (med) {
      out.push({
        id: `train:med:${ws.uid}`, x: med.x, y: FLOOR, z: med.z, radius: 1.3, kind: 'machine', onTrain: true,
        label: () => 'Armoire médicale : se soigner (1 médicament)',
        interact: () => {
          const s = st();
          if ((s.train.resources.medicaments ?? 0) < 1) return game.ui.toast('Plus de médicaments.', 'mauvais');
          if (s.player.hp >= game.player.maxHp && !s.player.disease) return game.ui.toast('Vous êtes en bonne santé.', 'info');
          s.train.resources.medicaments--;
          game.player.heal(35);
          if (s.player.disease) s.player.disease.treated = 60;
          game.engine.fx.heal(game.player.x, game.player.y + 1, game.player.z);
          game.audio.play('pickup');
        },
      });
    }
    const kitchen = P('kitchen');
    if (kitchen) {
      out.push({
        id: `train:kitchen:${ws.uid}`, x: kitchen.x, y: FLOOR, z: kitchen.z, radius: 1.3, kind: 'machine', onTrain: true,
        label: () => 'Préparer un festin (8 vivres) : moral +',
        interact: () => {
          const s = st();
          if ((s.train.resources.nourriture ?? 0) < 8) return game.ui.toast('Pas assez de vivres.', 'mauvais');
          s.train.resources.nourriture -= 8;
          game.crewSystem.party();
          for (const n of Object.values(s.npcs)) if (n.status === 'equipage' || n.status === 'passager') n.hunger = 0;
          game.ui.toast('Un festin réchauffe les cœurs. Le moral remonte !', 'bon');
          game.audio.play('success');
        },
      });
    }
    const gen = P('generator');
    if (gen) out.push({ id: `train:gen:${ws.uid}`, x: gen.x, y: FLOOR, z: gen.z, radius: 1.3, kind: 'machine', onTrain: true, label: () => (ws.heater.on ? 'Arrêter la turbine auxiliaire' : 'Démarrer la turbine auxiliaire'), interact: () => { ws.heater.on = !ws.heater.on; game.audio.play('lever'); } });
    const storage = P('storage');
    if (storage) out.push({ id: `train:storage:${ws.uid}`, x: storage.x, y: FLOOR, z: storage.z, radius: 1.5, kind: 'conteneur', onTrain: true, label: () => 'Inventaire de la soute', interact: () => game.ui.openDashboard('inventaire') });
    // décorations interactives
    ws.decor.forEach((d, di) => {
      if (!d || !DECOR[d].interactive) return;
      const a = w.model.decorAnchors[di];
      if (!a) return;
      const kind = DECOR[d].interactive;
      out.push({
        id: `train:decor:${ws.uid}:${di}`, x: w.cx + a.x, y: FLOOR, z: a.z * 0.6, radius: 1.4, kind: 'decor', onTrain: true,
        label: () => (kind === 'arcade' ? 'Jouer à Rail Runner' : kind === 'jukebox' ? 'Lancer le juke-box' : kind === 'piano' ? 'Jouer du piano' : 'Lire un livre'),
        interact: () => {
          if (kind === 'arcade') return game.ui.openArcade();
          if (kind === 'jukebox' || kind === 'piano') {
            game.audio.setMusic('calm');
            const key = `${kind}_${Math.floor(st().time / 720)}`;
            if (!st().flags[key]) {
              st().flags[key] = true;
              game.crewSystem.party();
              game.ui.toast(kind === 'jukebox' ? 'Une vieille chanson d\'avant résonne dans le wagon. Les visages s\'éclairent.' : 'Quelques accords hésitants, puis une mélodie. L\'équipage fredonne.', 'bon');
            } else game.ui.toast('La musique continue de tourner.', 'info');
            return;
          }
          const lore = [
            '« Le Réseau ferroviaire continental, 2041 » : une carte jaunie montre des lignes à grande vitesse jusqu\'à la mer.',
            '« Manuel du chauffeur » : « Une chaudière contente ronronne. Une chaudière en colère siffle. Une chaudière qui se tait va exploser. »',
            '« Contes de la Brume » : on y raconte que les Nuées fuient la lumière depuis la première nuit de la Brûlure.',
            '« Botanique des terres mortes » : les champignons de Lumen ne poussent que dans l\'obscurité totale, sur le charbon.',
          ];
          game.ui.openNote('Bibliothèque', lore[Math.floor(Math.random() * lore.length)]);
          for (const n of Object.values(st().npcs)) if (n.status === 'equipage' && n.wagon === ws.uid) n.morale = Math.min(100, n.morale + 2);
        },
      });
    });
  }
  return out;
}

function componentIt(game: Game, id: string, x: number, z: number, get: () => { hp: number; on: boolean } | undefined, name: string, repairMult: () => number, scrapMult: () => number): Interactable {
  return {
    id: `train:${id}`, x, y: FLOOR, z, radius: 1.0, kind: 'machine', onTrain: true,
    label: () => {
      const c = get();
      if (!c) return null;
      if (c.hp <= 0) return `Réparer le ${name} (maintenir E)`;
      if (c.hp < 100) return `Réparer le ${name} (${Math.round(c.hp)} %) — maintenir E`;
      return `${c.on ? 'Éteindre' : 'Allumer'} le ${name}`;
    },
    hold: () => ((get()?.hp ?? 100) < 100 ? 0.5 : 0),
    interact: () => {
      const c = get();
      if (!c) return;
      if (c.hp < 100) {
        const amount = BAL.repairRate * 0.9 * repairMult();
        const cost = Math.max(1, Math.round((amount / BAL.hpPerScrap) * scrapMult()));
        if ((game.state.train.resources.ferraille ?? 0) < cost) return game.ui.toast('Plus de ferraille.', 'mauvais');
        game.state.train.resources.ferraille -= cost;
        c.hp = Math.min(100, c.hp + amount);
        game.audio.play('repair');
        return;
      }
      c.on = !c.on;
      game.audio.play('ui');
    },
  };
}
