import type * as THREE from 'three';
import type { WeaponDef } from '../data/weapons';
import type { Rect } from '../core/math';
import type { BiomeId, Weather } from '../data/biomes';

export type Faction = 'joueur' | 'bandit' | 'monstre' | 'machine' | 'neutre';

export type DamageKind = 'balle' | 'melee' | 'explosion' | 'feu' | 'acide' | 'arc' | 'gaz' | 'froid' | 'radiation' | 'faim' | 'maladie';

export interface DamageSource {
  faction: Faction;
  x: number;
  z: number;
  kind: DamageKind;
  weapon?: WeaponDef;
  knockback?: number;
  burn?: number;
  slow?: number;
  infects?: boolean;
  attacker?: Actor | null;
  structureMult?: number;
}

export interface Actor {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  radius: number;
  height: number;
  faction: Faction;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Se trouve à l'intérieur du train. */
  onTrain: boolean;
  /** Volant (ignore l'eau et les obstacles bas). */
  flying?: boolean;
  damage(amount: number, src: DamageSource): void;
  /** Ralentissement en cours (0..1) et durée. */
  slow: number;
  slowT: number;
  burnT: number;
  burnDps: number;
}

export interface Interactable {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  label: () => string | null;
  /** Durée de maintien de la touche (s). */
  hold?: () => number;
  interact: () => void;
  onTrain?: boolean;
  kind?: 'porte' | 'conteneur' | 'pnj' | 'machine' | 'objet' | 'levier' | 'reparation' | 'note' | 'tourelle' | 'decor';
  /** Couleur de surbrillance du marqueur. */
  highlight?: () => number | null;
}

export type HazardKind = 'radiation' | 'gaz' | 'feu' | 'acide' | 'glace' | 'chaleur';

export interface Hazard {
  kind: HazardKind;
  x: number;
  z: number;
  r: number;
  rect?: Rect;
  intensity: number;
  ttl?: number;
  world?: boolean;
  /** Visible au compteur Geiger mais pas à l'œil nu. */
  hidden?: boolean;
}

export interface BuildingRuntime {
  id: string;
  name: string;
  rect: Rect;
  roof: THREE.Object3D;
  front: THREE.Object3D[];
  dark: boolean;
  inside: boolean;
  fade: number;
}

export interface LevelEnv {
  biome: BiomeId;
  weather: Weather;
  fogColor: number;
  /** Teinte d'ambiance (zones irradiées…). */
  tint?: number;
  tintAmount?: number;
}
