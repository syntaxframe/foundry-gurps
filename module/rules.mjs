/**
 * Чистые функции с правилами GURPS 4e. Не зависят от Foundry, поэтому их легко проверять отдельно.
 * Формулы перенесены из GMentor (characters.js, constants.js, skills.js, advantages.js).
 */

// Таблица урона по ST (B16): индекс = ST - 1, для ST 1..40
const THR = ["1d-6", "1d-6", "1d-5", "1d-5", "1d-4", "1d-4", "1d-3", "1d-3", "1d-2", "1d-2",
  "1d-1", "1d-1", "1d", "1d", "1d+1", "1d+1", "1d+2", "1d+2", "2d-1", "2d-1",
  "2d", "2d", "2d+1", "2d+1", "2d+2", "2d+2", "3d-1", "3d-1", "3d", "3d",
  "3d+1", "3d+1", "3d+2", "3d+2", "4d-1", "4d-1", "4d", "4d", "4d+1", "4d+1"];
const SW = ["1d-5", "1d-5", "1d-4", "1d-4", "1d-3", "1d-3", "1d-2", "1d-2", "1d-1", "1d",
  "1d+1", "1d+2", "2d-1", "2d", "2d+1", "2d+2", "3d-1", "3d", "3d+1", "3d+2",
  "4d-1", "4d", "4d+1", "4d+2", "5d-1", "5d", "5d+1", "5d+1", "5d+2", "5d+2",
  "6d-1", "6d-1", "6d", "6d", "6d+1", "6d+1", "6d+2", "6d+2", "7d-1", "7d-1"];
// Для ST 41..100 таблица идёт шагом 5: индекс = ceil((ST - 40) / 5) - 1
const THR_5 = ["5d", "5d+2", "6d", "7d-1", "7d+1", "8d", "8d+2", "9d", "9d+2", "10d", "10d+2", "11d"];
const SW_5 = ["7d+1", "8d-1", "8d+1", "9d", "9d+2", "10d", "10d+2", "11d", "11d+2", "12d", "12d+2", "13d"];

function damageByST(st, base, by5, diceAt100) {
  st = Math.max(1, Math.floor(st));
  if ( st <= 40 ) return base[st - 1];
  if ( st <= 100 ) return by5[Math.ceil((st - 40) / 5) - 1];
  return `${diceAt100 + Math.floor((st - 100) / 10)}d`;
}

export const thrust = st => damageByST(st, THR, THR_5, 11);
export const swing = st => damageByST(st, SW, SW_5, 13);

/**
 * Прибавить к урону "NdM" модификатор, как modifyDamage в GMentor: каждые 3.5 модификатора превращаются
 * в кубик, а кубиков не бывает меньше одного. addDamage("1d-2", -1) → "1d-3", addDamage("2d+2", 2) → "3d".
 */
export function addDamage(damage, add) {
  const [, d, m] = String(damage).match(/^(\d+)d([+-]\d+)?$/) ?? [];
  if ( d === undefined ) return damage;
  let dice = Number(d);
  let mod = Number(m ?? 0) + add;
  const shift = Math.floor(Math.abs(mod) / 3.5);
  dice += Math.sign(mod) * shift;
  mod -= mod > 0 ? Math.ceil(shift * 3.5) : Math.floor(shift * -3.5);
  if ( dice < 1 ) {
    mod -= Math.round((1 - dice) * 3.5);
    dice = 1;
  }
  return `${dice}d${mod > 0 ? `+${mod}` : mod < 0 ? mod : ""}`;
}

/**
 * Локации попадания (B552): бросок 3d6 при случайном попадании, штраф на прицельный удар, естественная СП.
 * Для рук и ног бросок указан как «правая / левая».
 */
export const LOCATIONS = [
  { key: "skull", roll: "3–4", toHit: -7, dr: 2 },
  { key: "face", roll: "5", toHit: -5, dr: 0 },
  { key: "eyes", roll: "", toHit: -9, dr: 0 },
  { key: "neck", roll: "17–18", toHit: -5, dr: 0 },
  { key: "torso", roll: "9–10", toHit: 0, dr: 0 },
  { key: "groin", roll: "11", toHit: -3, dr: 0 },
  { key: "arms", roll: "8 / 12", toHit: -2, dr: 0 },
  { key: "hands", roll: "15", toHit: -4, dr: 0 },
  { key: "legs", roll: "6–7 / 13–14", toHit: -2, dr: 0 },
  { key: "feet", roll: "16", toHit: -4, dr: 0 }
];

/** Базовый подъём (B15) в фунтах: ST²/5, от 10 и выше округляется. */
export function basicLift(st) {
  const bl = st * st / 5;
  return bl >= 10 ? Math.round(bl) : bl;
}

// Пороги нагрузки (B17) в долях базового подъёма: Нет, Лёгкая, Средняя, Тяжёлая, Сверхтяжёлая
export const ENCUMBRANCE_MULTIPLIERS = [1, 2, 3, 6, 10];

/** Уровень нагрузки 0..4 по весу; 5 — вес больше сверхтяжёлой нагрузки. */
export function encumbranceLevel(weight, lift) {
  const level = ENCUMBRANCE_MULTIPLIERS.findIndex(m => weight <= lift * m);
  return level === -1 ? 5 : level;
}

// Цена уровня атрибута (B14)
export const ATTRIBUTE_COST = { st: 10, dx: 20, iq: 20, ht: 10 };

/**
 * Стоимость атрибута. Скидка (например, за SM для ST) действует только на уровни выше 10, как в GMentor.
 * @param {number} costModifier  Множитель стоимости, не меньше 0.2
 */
export function attributeCost(key, value, costModifier = 1) {
  const k = value > 10 ? costModifier : 1;
  return Math.round((value - 10) * ATTRIBUTE_COST[key] * k);
}

/** Скидка за модификатор размера на ST и HP (B15): −10% за каждый SM выше 0, не больше 8, минимум 20% цены. */
export function sizeCostModifier(sm) {
  const clamped = Math.min(Math.max(sm, 0), 8);
  return Math.max(1 - 0.1 * clamped, 0.2);
}

// Сложность умения → относительный уровень при вложении 1 очка (B170)
export const DIFFICULTY = { E: 0, A: -1, H: -2, VH: -3 };

/**
 * Уровень умения по вложенным очкам: 1 очко — базовый, 2 — +1, 4 — +2, далее +1 за каждые 4.
 * @returns {{level: number, relative: number}|null}  null, если очков нет (умение не изучено)
 */
export function skillLevel(base, difficulty, points) {
  if ( !(points > 0) ) return null;
  let relative = DIFFICULTY[difficulty] ?? DIFFICULTY.A;
  if ( points >= 4 ) relative += 1 + Math.floor(points / 4);
  else if ( points >= 2 ) relative += 1;
  return { level: base + relative, relative };
}

// Множитель стоимости недостатка по самоконтролю (B120)
export const SELF_CONTROL_MULTIPLIER = { 6: 2, 9: 1.5, 12: 1, 15: 0.5 };

/**
 * Стоимость преимущества или недостатка с уровнями, улучшениями и ограничениями (B101, B110).
 * Улучшения и ограничения складываются, итог не ниже −80%.
 */
export function traitCost({ basePoints, pointsPerLevel, levels, cr, modifiers, roundDown }) {
  const percent = modifiers.filter(m => m.enabled).reduce((sum, m) => sum + m.value, 0);
  const raw = (basePoints + pointsPerLevel * levels) * (1 + Math.max(percent, -80) / 100)
    * (SELF_CONTROL_MULTIPLIER[cr] ?? 1);
  // Убираем погрешность дробей (10 * 1.1 = 11.000000000000002), иначе ceil даст 12
  const cost = Math.round(raw * 1000) / 1000;
  return roundDown ? Math.floor(cost) : Math.ceil(cost);
}

/**
 * Исход броска 3d6 против навыка (B347–B348).
 * @returns {{outcome: "critSuccess"|"success"|"failure"|"critFailure", margin: number}}
 */
export function successOutcome(total, target) {
  const margin = target - total;
  let outcome;
  if ( (total <= 4) || ((total === 5) && (target >= 15)) || ((total === 6) && (target >= 16)) ) outcome = "critSuccess";
  else if ( (total === 18) || ((total === 17) && (target <= 15)) || (margin <= -10) ) outcome = "critFailure";
  else if ( total === 17 ) outcome = "failure";
  else outcome = margin >= 0 ? "success" : "failure";
  return { outcome, margin };
}

/**
 * Превращает запись урона GURPS в формулу Foundry: "sw+2 cut" → {formula: "2d6+1", type: "cut"}.
 * thr/sw подставляются из переданных значений персонажа.
 */
export function parseDamage(text, { thr, sw }) {
  const match = String(text).trim().match(/^(thr|sw|\d+d)\s*([+-]\s*\d+)?\s*(.*)$/i);
  if ( !match ) return null;
  let [, base, add, type] = match;
  base = base.toLowerCase();
  if ( base === "thr" || base === "sw" ) {
    const [dice, mod = "0"] = (base === "thr" ? thr : sw).split("d");
    base = `${dice}d`;
    add = Number(mod || 0) + Number((add ?? "0").replace(/\s/g, ""));
  }
  else add = Number((add ?? "0").replace(/\s/g, ""));
  const dice = parseInt(base);
  const formula = `${dice}d6${add > 0 ? `+${add}` : add < 0 ? add : ""}`;
  return { formula, type: type.trim() };
}
