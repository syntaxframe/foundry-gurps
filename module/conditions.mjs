/**
 * Временные состояния GMentor (constants > character-states) как статусы Foundry.
 * Статус — это Active Effect: его можно включить с листа или с токена, а бонусы применяются через system.bonuses.*.
 * Название и пометка берутся из lang: GMENTOR.Condition.<id>.name / .notes.
 */

const DEFENSES = value => [["dodge", value], ["parry", value], ["block", value]];

/** [id, группа, иконка, ссылка, бонусы]. Бонус moveMultiplier умножается, остальные складываются. */
const DEFINITIONS = [
  ["crouching", "posture", "down", "B551", [["moveMultiplier", 2 / 3]]],
  ["kneeling", "posture", "down", "B551", [...DEFENSES(-2), ["moveMultiplier", 1 / 3]]],
  ["sitting", "posture", "down", "B551", DEFENSES(-2)],
  ["crawling", "posture", "pawprint", "B551", [...DEFENSES(-3), ["moveMultiplier", 1 / 3]]],
  ["lying", "posture", "falling", "B551", [...DEFENSES(-3), ["moveMultiplier", 0]]],

  ["stunned", "injury", "daze", "B420", DEFENSES(-4)],
  ["mentalStun", "injury", "daze", "B420", DEFENSES(-4)],
  ["bleeding", "injury", "blood", "B420", []],
  ["unconsciousInjury", "injury", "unconscious", "B423", []],
  ["crippledHand", "injury", "bones", "B421", []],
  ["crippledArm", "injury", "bones", "B421", []],
  ["crippledFoot", "injury", "leg", "B421", [["moveMultiplier", 0.5]]],
  ["crippledLeg", "injury", "leg", "B421", [["moveMultiplier", 0]]],
  ["crippledEye", "injury", "blind", "B421", []],

  ["starvation", "irritating", "degen", "B426", []],
  ["dehydration", "irritating", "degen", "B426", []],
  ["missedSleep", "irritating", "sleep", "B427", []],
  ["drowsy", "irritating", "sleep", "B428", [["dx", -2], ["iq", -2], ["selfControl", -2]]],
  ["coughing", "irritating", "biohazard", "B428", [["dx", -3], ["iq", -1]]],
  ["sneezing", "irritating", "biohazard", "B428", [["dx", -3], ["iq", -1]]],
  ["tipsy", "irritating", "tankard", "B428", [["dx", -1], ["iq", -1], ["selfControl", -2]]],
  ["drunk", "irritating", "tankard", "B428", [["dx", -2], ["iq", -2], ["selfControl", -4]]],
  ["euphoria", "irritating", "sun", "B428", [["dx", -3], ["iq", -3], ["selfControl", -3]]],
  ["nauseated", "irritating", "poison", "B428", [["st", -2], ["dx", -2], ["iq", -2], ["ht", -2], ...DEFENSES(-1)]],
  ["painModerate", "irritating", "lightning", "B428", [["dx", -2], ["iq", -2], ["selfControl", -2]]],
  ["painSevere", "irritating", "lightning", "B428", [["dx", -4], ["iq", -4], ["selfControl", -4]]],
  ["painTerrible", "irritating", "lightning", "B428", [["dx", -6], ["iq", -6], ["selfControl", -6]]],

  ["agony", "incapacitating", "terror", "B428", DEFENSES(-4)],
  ["choking", "incapacitating", "silenced", "B428", DEFENSES(-4)],
  ["daze", "incapacitating", "daze", "B428", DEFENSES(-4)],
  ["ecstasy", "incapacitating", "angel", "B428", DEFENSES(-4)],
  ["hallucinating", "incapacitating", "eye", "B429", DEFENSES(-4)],
  ["paralysis", "incapacitating", "paralysis", "B429", DEFENSES(-4)],
  ["retching", "incapacitating", "poison", "B428", [...DEFENSES(-4), ["dx", -5], ["iq", -5]]],
  ["seizure", "incapacitating", "explosion", "B428", DEFENSES(-4)],
  ["unconscious", "incapacitating", "unconscious", "B428", DEFENSES(-4)],

  ["mortalWound", "mortal", "skull", "B423", []],
  ["coma", "mortal", "unconscious", "B429", []],
  ["heartAttack", "mortal", "hazard", "B429", []]
];

export const CONDITION_GROUPS = ["posture", "injury", "irritating", "incapacitating", "mortal"];

export const CONDITIONS = DEFINITIONS.map(([id, group, icon, reference, bonuses], index) => ({
  id,
  name: `GMENTOR.Condition.${id}.name`,
  img: `icons/svg/${icon}.svg`,
  // Палитра на токене сортирует по order, иначе по алфавиту: держим порядок групп как в диалоге
  order: index + 1,
  system: {
    changes: bonuses.map(([key, value]) => ({
      key: `system.bonuses.${key}`,
      type: key === "moveMultiplier" ? "multiply" : "add",
      value
    }))
  },
  flags: { gmentor: { group, reference } }
}));

/**
 * Заменить стандартные статусы Foundry состояниями GMentor. Служебные статусы ядра (dead, invisible и т.п.)
 * остаются: на них завязаны трекер боя и зрение токенов.
 * CONFIG.statusEffects в v14 — Proxy над массивом, поэтому меняем его на месте, а не присваиваем новый.
 */
export function registerConditions() {
  const special = new Set(Object.values(CONFIG.specialStatusEffects));
  const kept = CONFIG.statusEffects.filter(s => special.has(s.id))
    .map((s, i) => ({ ...s, order: CONDITIONS.length + i + 1 }));
  CONFIG.statusEffects.length = 0;
  for ( const status of [...CONDITIONS, ...kept] ) CONFIG.statusEffects.push(status);
}

/** Группа состояния по id статуса или null, если это не состояние GMentor. */
export function conditionGroup(statusId) {
  return CONFIG.statusEffects[statusId]?.flags?.gmentor?.group ?? null;
}

/** Полное описание состояния (HTML) или null: тексты есть только в русской локализации, из GMentor. */
export function conditionDescription(statusId) {
  const key = `GMENTOR.Condition.${statusId}.description`;
  return game.i18n.has(key, false) ? game.i18n.localize(key) : null;
}
