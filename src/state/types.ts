import type { ResourceId } from '../data/items';
import type { WeaponInstance } from '../data/weapons';
import type { WagonTypeId, EquipId, DecorId, PowerChannel } from '../data/train';
import type { SkillId, PersonalityId, SecretId, JobId, NpcLook } from '../data/npcs';
import type { BiomeId, Season } from '../data/biomes';
import type { ArchetypeId, Hostility, ServiceId, EnemyFaction } from '../data/stations';
import type { Difficulty } from '../data/balance';

export type GameMode = 'histoire' | 'infini';

export type DiseaseId = 'fievre' | 'grippe' | 'infection' | 'rayons';

export interface DiseaseState {
  id: DiseaseId;
  /** Progression 0..1 (1 = stade terminal). */
  severity: number;
  /** Incubation restante (s) avant symptômes. */
  incubation: number;
  /** Connue du joueur (diagnostiquée ou visible). */
  known: boolean;
  /** Sous traitement (médecin). */
  treated: number;
}

export interface PlayerState {
  name: string;
  hp: number;
  stamina: number;
  warmth: number;
  rads: number;
  disease: DiseaseState | null;
  weapons: (WeaponInstance | null)[];
  active: number;
  /** Objets personnels (outils, clés, objets de quête…) : id => quantité. */
  items: Record<string, number>;
  gear: { corps: string | null; tete: string | null };
  filter: number;
  xp: number;
  level: number;
  perks: string[];
  pendingPerks: number;
}

export interface SlotState {
  equip: EquipId | null;
  level: number;
  hp: number;
  on: boolean;
  auto: boolean;
  /** PNJ ou 'joueur' qui sert cette tourelle. */
  gunner: string | null;
}

export interface ComponentState {
  hp: number;
  on: boolean;
}

export interface WagonState {
  uid: string;
  type: WagonTypeId;
  hp: number;
  armor: number;
  slots: SlotState[];
  decor: (DecorId | null)[];
  heater: ComponentState;
  lights: ComponentState;
  temp: number;
  fire: number;
  shield: number;
  name?: string;
}

export interface TrainState {
  name: string;
  wagons: WagonState[];
  throttle: number;
  /** Surchauffe de la chaudière (0..100). */
  heat: number;
  pressure: number;
  autoStoker: boolean;
  power: { alloc: Record<PowerChannel, number>; auto: boolean; battery: number };
  resources: Record<ResourceId, number>;
  upgrades: Record<string, number>;
  /** Accumulateur de production de la serre. */
  greenhouse: number;
  /** Équipements et décorations achetés mais non installés. */
  spare: { equip: { id: EquipId; level: number }[]; decor: DecorId[] };
}

export type NpcStatus = 'resident' | 'equipage' | 'passager' | 'mort' | 'perdu' | 'parti' | 'prisonnier';

export interface NpcState {
  id: string;
  name: string;
  female: boolean;
  age: number;
  look: NpcLook;
  skill: SkillId;
  skillLevel: number;
  personality: PersonalityId;
  secret: SecretId | null;
  known: { skill: boolean; personality: boolean; secret: boolean };
  hp: number;
  maxHp: number;
  morale: number;
  affinity: number;
  disease: DiseaseState | null;
  rads: number;
  cold: number;
  hunger: number;
  status: NpcStatus;
  stationId: string | null;
  wagon: string | null;
  job: JobId;
  jobTarget: string | null;
  /** Prix d'embauche (recrue) ou de passage. */
  fee: number;
  fare: { destination: string; reward: number } | null;
  questId: string | null;
  storyRole: string | null;
  bio: string;
  origin: string;
  hope: string;
  /** Réserve personnelle (voleurs). */
  stash: Partial<Record<ResourceId, number>>;
  timers: { theft: number; sabotage: number; talk: number; bark: number; wage: number };
  interrogations: number;
  /** Armes portées par les PNJ d'escorte. */
  weapon: string;
  /** Dialogue scénarisé à utiliser à la place des dialogues génériques. */
  dialogue: string | null;
  recruitable: boolean;
  /** Le PNJ est un marchand (stock dans l'état de station). */
  trader: boolean;
}

export interface MapNode {
  id: string;
  name: string;
  archetype: ArchetypeId;
  biome: BiomeId;
  layer: number;
  x: number;
  y: number;
  links: string[];
  hostility: Hostility;
  faction: EnemyFaction;
  threat: number;
  seed: number;
  services: ServiceId[];
  known: boolean;
  scouted: boolean;
  visited: boolean;
  story: string | null;
  season: Season;
  radiation: number;
  gas: boolean;
  boss: boolean;
  /** Masqué tant qu'une condition de quête n'est pas remplie. */
  hidden: boolean;
  /** Présentation (mode Histoire). */
  blurb?: string;
}

export interface MapEdge {
  from: string;
  to: string;
  length: number;
  biome: BiomeId;
  danger: number;
  /** Événements imposés (aiguillage, tunnel…) */
  features: string[];
}

export interface MapState {
  nodes: Record<string, MapNode>;
  edges: MapEdge[];
  current: string;
  maxLayer: number;
}

export interface TraderStock {
  resources: Partial<Record<ResourceId, number>>;
  weapons: string[];
  gear: string[];
  tools: string[];
  equipment: EquipId[];
  decor: DecorId[];
  wagons: WagonTypeId[];
  priceMod: number;
  restock: number;
}

export interface StationDelta {
  looted: string[];
  opened: string[];
  killed: string[];
  taken: string[];
  levers: Record<string, number>;
  flags: Record<string, number>;
  visits: number;
  lastVisit: number;
  residents: string[];
  stock: TraderStock | null;
  /** Temps passé à quai (s), pour les gares irradiées. */
  dwell: number;
}

export interface Objective {
  id: string;
  text: string;
  done: boolean;
  optional?: boolean;
  /** Station où l'objectif se situe (marqueur carte). */
  station?: string;
  count?: number;
  progress?: number;
}

export interface QuestState {
  id: string;
  title: string;
  kind: 'principale' | 'secondaire';
  giver: string | null;
  status: 'active' | 'terminee' | 'echouee';
  stage: number;
  desc: string;
  objectives: Objective[];
  reward: { jetons?: number; xp?: number; items?: Record<string, number>; resources?: Partial<Record<ResourceId, number>> } | null;
  data: Record<string, string | number | boolean>;
  /** Échéance (temps de jeu en minutes) pour les quêtes à durée limitée. */
  deadline?: number;
}

export interface JournalNote {
  id: string;
  title: string;
  text: string;
  station: string;
  time: number;
}

export interface Incident {
  id: string;
  kind: 'vol' | 'sabotage' | 'bagarre' | 'radio';
  wagon: string;
  time: number;
  text: string;
  culprit: string | null;
  witnesses: string[];
  resolved: boolean;
}

export interface JournalState {
  notes: JournalNote[];
  clues: { id: string; npc: string | null; text: string; time: number }[];
  incidents: Incident[];
  log: { time: number; text: string; kind: 'info' | 'bon' | 'mauvais' | 'quete' }[];
  codes: Record<string, string>;
}

export interface RunStats {
  kills: number;
  distance: number;
  stations: number;
  deaths: number;
  saved: number;
  attacks: number;
  playTime: number;
}

export type Location =
  | { kind: 'station'; station: string }
  | { kind: 'voyage'; from: string; to: string; progress: number; length: number; eventsDone: string[] };

export interface GameState {
  version: number;
  mode: GameMode;
  difficulty: Difficulty;
  seed: number;
  /** Temps de jeu en minutes depuis le jour 1 à 00:00. */
  time: number;
  season: Season;
  player: PlayerState;
  train: TrainState;
  npcs: Record<string, NpcState>;
  map: MapState;
  location: Location;
  quests: QuestState[];
  flags: Record<string, number | boolean | string>;
  journal: JournalState;
  stats: RunStats;
  stations: Record<string, StationDelta>;
  /** Compteur pour générer des identifiants uniques. */
  nextId: number;
  over: null | { victory: boolean; reason: string };
}
