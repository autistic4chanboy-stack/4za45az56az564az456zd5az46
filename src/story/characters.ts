import { Rng } from '../core/rng';
import { generateNpc } from '../world/npcgen';
import type { NpcState } from '../state/types';
import type { SkillId, PersonalityId, SecretId, NpcLook } from '../data/npcs';

/** Personnages fixes du mode Histoire. */
interface CharacterDef {
  id: string;
  name: string;
  female: boolean;
  age: number;
  skill: SkillId;
  level: number;
  personality: PersonalityId;
  secret: SecretId | null;
  station: string;
  role: string;
  bio: string;
  look: Partial<NpcLook>;
  recruitable: boolean;
  fee: number;
  trader?: boolean;
  weapon?: string;
  known?: Partial<NpcState['known']>;
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'delorme', name: 'Augustin Delorme', female: false, age: 63, skill: 'marchand', level: 2, personality: 'calme', secret: null,
    station: 'cendrebourg', role: 'maire', recruitable: false, fee: 0,
    bio: 'Maire de Cendrebourg depuis vingt ans. Il a vu la ville survivre à tout… sauf peut-être à la Fièvre.',
    look: { skin: 0xe0ac87, hair: 0xe8e8e8, hairStyle: 6, shirt: 0x3c3a4a, pants: 0x2e2a26, hat: 0, accessory: 3 },
    known: { personality: true },
  },
  {
    id: 'elise', name: 'Dr Élise Varga', female: true, age: 41, skill: 'medecin', level: 3, personality: 'calme', secret: null,
    station: 'cendrebourg', role: 'docteur', recruitable: true, fee: 0,
    bio: 'Médecin de Cendrebourg, ancienne assistante du Pr Hallström. Elle croit que le remède existe.',
    look: { skin: 0xf1c9a5, hair: 0x5c3b22, hairStyle: 3, shirt: 0xd8d3c4, pants: 0x3a3f4a, hat: 0, accessory: 2 },
    known: { personality: true },
  },
  {
    id: 'bastien', name: 'Bastien « Boulon » Moreau', female: false, age: 58, skill: 'mecanicien', level: 2, personality: 'jovial', secret: null,
    station: 'cendrebourg', role: 'mecano', recruitable: true, fee: 0,
    bio: 'Le mécanicien du dépôt. Il connaît L\'Espérance boulon par boulon, il l\'a remise en état de ses mains.',
    look: { skin: 0xc68e62, hair: 0x8c8c8c, hairStyle: 0, shirt: 0x2f3b4f, pants: 0x2e2a26, hat: 1, accessory: 0 },
    known: { personality: true },
  },
  {
    id: 'rosalie', name: 'Rosalie Fournier', female: true, age: 36, skill: 'agronome', level: 2, personality: 'jovial', secret: null,
    station: 'fourche', role: 'fermiere', recruitable: true, fee: 30,
    bio: 'Elle cultive des tomates dans la cendre et rêve de faire pousser un verger dans un wagon.',
    look: { skin: 0xe0ac87, hair: 0xc79a52, hairStyle: 2, shirt: 0x7a6a4f, pants: 0x4a3b2c, hat: 5, accessory: 0 },
  },
  {
    id: 'gaspard', name: 'Gaspard Lefort', female: false, age: 44, skill: 'cuisinier', level: 2, personality: 'jovial', secret: 'voleur',
    station: 'fourche', role: 'cuisinier', recruitable: true, fee: 35,
    bio: 'Ancien cuisinier de la voiture-restaurant du Transcontinental. Il a toujours faim, et pas que de cuisine.',
    look: { skin: 0xf1c9a5, hair: 0x3b2a1e, hairStyle: 1, shirt: 0xe8e0d0, pants: 0x2e2a26, hat: 0, accessory: 0 },
  },
  {
    id: 'anselme', name: 'Frère Anselme', female: false, age: 55, skill: 'scientifique', level: 2, personality: 'calme', secret: null,
    station: 'saint_aubin', role: 'moine', recruitable: true, fee: 0,
    bio: 'Physicien avant la Brûlure, moine depuis. Il étudie la Fièvre Grise dans le calme de l\'abbaye.',
    look: { skin: 0xc68e62, hair: 0x8c8c8c, hairStyle: 0, shirt: 0x5b4636, pants: 0x5b4636, hat: 0, accessory: 0 },
  },
  {
    id: 'mila', name: 'Mila Kowalski', female: true, age: 19, skill: 'eclaireur', level: 2, personality: 'curieux', secret: null,
    station: 'creux_noir', role: 'survivante', recruitable: true, fee: 0,
    bio: 'Fille d\'un mineur de Creux-Noir. Elle s\'est cachée trois jours dans une galerie latérale.',
    look: { skin: 0xf5d6c0, hair: 0x7a2a1a, hairStyle: 4, shirt: 0x3c4a3a, pants: 0x3a3f4a, hat: 2, accessory: 4 },
  },
  {
    id: 'silas', name: 'Silas Vex', female: false, age: 37, skill: 'marchand', level: 3, personality: 'jovial', secret: 'traitre',
    station: 'carrefour', role: 'silas', recruitable: true, fee: 0,
    bio: 'Informateur charmant, il connaît tout le monde au Carrefour et propose de vous guider vers la Zone.',
    look: { skin: 0xe0ac87, hair: 0x1c1410, hairStyle: 1, shirt: 0x6e5a7a, pants: 0x1f2430, hat: 3, accessory: 1 },
  },
  {
    id: 'mamajo', name: 'Mama Jo Haddad', female: true, age: 60, skill: 'marchand', level: 3, personality: 'cupide', secret: null,
    station: 'carrefour', role: 'marchande', recruitable: false, fee: 0, trader: true,
    bio: 'La reine du Carrefour. Si Mama Jo ne l\'a pas, c\'est que ça n\'existe pas.',
    look: { skin: 0x9c6b45, hair: 0x8c8c8c, hairStyle: 3, shirt: 0xb94e3a, pants: 0x4a3b2c, hat: 0, accessory: 2 },
    known: { personality: true },
  },
  {
    id: 'lambert', name: 'Commandant Victor Lambert', female: false, age: 52, skill: 'garde', level: 3, personality: 'tetu', secret: null,
    station: 'garde_fer', role: 'commandant', recruitable: false, fee: 0,
    bio: 'Chef de la milice de Garde-Fer. Dur, mais juste. Il garde les portes de la Zone.',
    look: { skin: 0xe0ac87, hair: 0x3b2a1e, hairStyle: 0, shirt: 0x4a5a3a, pants: 0x2b3a2a, hat: 4, accessory: 0 },
    known: { personality: true },
  },
  {
    id: 'nadia', name: 'Nadia Kerr', female: true, age: 34, skill: 'garde', level: 3, personality: 'courageux', secret: null,
    station: 'garde_fer', role: 'soldate', recruitable: true, fee: 60, weapon: 'mitraillette',
    bio: 'Sergente de la milice, lassée des ordres de Lambert. Elle veut se battre pour quelque chose qui compte.',
    look: { skin: 0x7a4e2d, hair: 0x1c1410, hairStyle: 5, shirt: 0x4a5a3a, pants: 0x2b3a2a, hat: 4, accessory: 0 },
  },
  {
    id: 'ingrid', name: 'Ingrid Solberg', female: true, age: 47, skill: 'ingenieur', level: 3, personality: 'tetu', secret: null,
    station: 'givre', role: 'ingenieure', recruitable: true, fee: 0,
    bio: 'Ancienne ingénieure de la Station Polaris. Elle est la seule à connaître la route du Col.',
    look: { skin: 0xf5d6c0, hair: 0xd9c08f, hairStyle: 2, shirt: 0x4f6a8a, pants: 0x3a3f4a, hat: 2, accessory: 4 },
  },
  {
    id: 'oscar', name: 'Oscar Picard', female: false, age: 29, skill: 'serrurier', level: 3, personality: 'paranoiaque', secret: 'fugitif',
    station: 'port_gris', role: 'serrurier', recruitable: true, fee: 45,
    bio: 'Un ancien cambrioleur qui jure s\'être rangé. Il sursaute à chaque coup de sifflet.',
    look: { skin: 0xf1c9a5, hair: 0x8a5a2b, hairStyle: 1, shirt: 0x3d3d3d, pants: 0x1f2430, hat: 2, accessory: 1 },
  },
];

export function createStoryNpcs(seed: number): Record<string, NpcState> {
  const rng = new Rng(seed).fork('story-npcs');
  const out: Record<string, NpcState> = {};
  for (const c of CHARACTERS) {
    const npc = generateNpc(rng, c.id, { skill: c.skill, personality: c.personality, secret: c.secret, female: c.female, level: c.level });
    npc.name = c.name;
    npc.age = c.age;
    npc.bio = c.bio;
    npc.look = { ...npc.look, ...c.look };
    npc.stationId = c.station;
    npc.status = 'resident';
    npc.storyRole = c.role;
    npc.dialogue = c.id;
    npc.recruitable = c.recruitable;
    npc.fee = c.fee;
    npc.trader = !!c.trader;
    npc.affinity = c.id === 'elise' || c.id === 'bastien' ? 40 : 10;
    npc.morale = 65;
    if (c.weapon) npc.weapon = c.weapon;
    npc.known = { skill: true, personality: !!c.known?.personality, secret: false };
    // le traître est charmeur : affinité de départ élevée
    if (c.id === 'silas') npc.affinity = 30;
    out[c.id] = npc;
  }
  return out;
}
