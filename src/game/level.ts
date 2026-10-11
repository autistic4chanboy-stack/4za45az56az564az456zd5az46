import type * as THREE from 'three';
import type { CollisionWorld } from '../world/collision';
import type { Enemy } from './enemy';
import type { NpcActor } from './npcActor';
import type { Interactable, Hazard, BuildingRuntime, LevelEnv } from './types';
import type { Rect } from '../core/math';

/** Interface commune aux niveaux (gare ou voyage). */
export interface Level {
  readonly kind: 'station' | 'voyage';
  readonly root: THREE.Group;
  readonly colliders: CollisionWorld;
  enemies: Enemy[];
  residents: NpcActor[];
  interactables: Interactable[];
  hazards: Hazard[];
  buildings: BuildingRuntime[];
  env: LevelEnv;
  bounds: Rect;
  /** Les collisions du décor sont-elles actives (faux quand le train roule) ? */
  collidersActive: boolean;
  update(dt: number): void;
  dispose(): void;
  groundY(x: number, z: number): number;
  darknessAt(x: number, z: number): number;
  findPath(x0: number, z0: number, x1: number, z1: number): { x: number; z: number }[] | null;
  /** Lumières statiques demandées au gestionnaire de lumières. */
  requestLights(cx: number, cz: number, night: number): void;
}
