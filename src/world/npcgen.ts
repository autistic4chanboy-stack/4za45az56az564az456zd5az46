import { Rng } from '../core/rng';
import {
  FIRST_NAMES_F, FIRST_NAMES_M, LAST_NAMES, NICKNAMES, SKIN_TONES, HAIR_COLORS, CLOTH_COLORS, PANTS_COLORS,
  ORIGINS, PASTS, HOPES, SKILL_IDS, PERSONALITY_IDS, SKILLS, PERSONALITIES,
  type SkillId, type PersonalityId, type SecretId, type NpcLook,
} from '../data/npcs';
import type { NpcState } from '../state/types';

export function randomLook(rng: Rng, female: boolean): NpcLook {
  return {
    skin: rng.pick(SKIN_TONES),
    hair: rng.pick(HAIR_COLORS),
    hairStyle: female ? rng.pick([1, 2, 3, 4, 5]) : rng.pick([0, 0, 1, 2, 5, 6]),
    shirt: rng.pick(CLOTH_COLORS),
    pants: rng.pick(PANTS_COLORS),
    hat: rng.chance(0.45) ? rng.int(1, 5) : 0,
    accessory: rng.chance(0.5) ? rng.int(1, 4) : 0,
    height: 0.92 + rng.next() * 0.16,
    build: 0.9 + rng.next() * 0.25,
  };
}

export interface NpcGenOpts {
  skill?: SkillId;
  personality?: PersonalityId;
  secret?: SecretId | null;
  female?: boolean;
  /** Multiplicateur des chances d'avoir un secret négatif. */
  shady?: number;
  level?: number;
}

export function generateNpc(rng: Rng, id: string, opts: NpcGenOpts = {}): NpcState {
  const female = opts.female ?? rng.chance(0.5);
  const first = rng.pick(female ? FIRST_NAMES_F : FIRST_NAMES_M);
  const last = rng.pick(LAST_NAMES);
  const name = rng.chance(0.12) ? `${first} « ${rng.pick(NICKNAMES)} » ${last}` : `${first} ${last}`;
  const skill = opts.skill ?? rng.pick(SKILL_IDS);
  let personality = opts.personality ?? rng.pick(PERSONALITY_IDS);
  let secret: SecretId | null = null;
  if (opts.secret !== undefined) secret = opts.secret;
  else {
    const shady = opts.shady ?? 1;
    const r = rng.next();
    if (r < 0.035 * shady) secret = 'traitre';
    else if (r < 0.12 * shady) secret = 'voleur';
    else if (r < 0.17) secret = 'porteur';
    else if (r < 0.22) secret = 'fugitif';
    else if (r < 0.28) secret = 'veteran';
  }
  if ((secret === 'traitre' || secret === 'voleur') && personality === 'loyal') personality = rng.pick(['cupide', 'calme', 'jovial', 'tetu']);
  if (secret === 'voleur' && rng.chance(0.4)) personality = 'cupide';
  const level = opts.level ?? (rng.chance(0.15) ? 3 : rng.chance(0.45) ? 2 : 1);
  const origin = rng.pick(ORIGINS);
  const past = rng.pick(PASTS).replace('né·e', female ? 'née' : 'né');
  const hope = rng.pick(HOPES);
  const pdef = PERSONALITIES[personality];
  return {
    id,
    name,
    female,
    age: rng.int(17, 68),
    look: randomLook(rng, female),
    skill,
    skillLevel: level,
    personality,
    secret,
    known: { skill: true, personality: false, secret: false },
    hp: 100,
    maxHp: 100,
    morale: pdef.moraleBase + rng.int(-5, 10),
    affinity: rng.int(-5, 15),
    disease: secret === 'porteur' ? { id: 'fievre', severity: 0, incubation: 99999, known: false, treated: 0 } : null,
    rads: 0,
    cold: 0,
    hunger: 0,
    status: 'resident',
    stationId: null,
    wagon: null,
    job: 'repos',
    jobTarget: null,
    fee: Math.round((25 + level * 20) * (personality === 'cupide' ? 1.6 : 1) * (0.8 + rng.next() * 0.4)),
    fare: null,
    questId: null,
    storyRole: null,
    bio: `Je viens ${origin}. ${past} ${hope}`,
    origin,
    hope,
    stash: {},
    timers: { theft: rng.int(200, 500), sabotage: rng.int(300, 600), talk: 0, bark: rng.int(10, 60), wage: 0 },
    interrogations: 0,
    weapon: skill === 'garde' || skill === 'tireur' || secret === 'veteran' ? 'fusil_pompe' : 'revolver',
    dialogue: null,
    recruitable: true,
    trader: false,
  };
}

export function skillLabel(npc: NpcState): string {
  return `${SKILLS[npc.skill].name} ${'★'.repeat(npc.skillLevel)}`;
}
