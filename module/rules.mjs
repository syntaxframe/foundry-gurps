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

// Группы локаций, на которые броня и черты дают СП одной записью (dr_bonus в GMentor)
const DR_GROUPS = {
  head: ["skull", "face"],
  fullBody: LOCATIONS.map(l => l.key),
  fullBodyExceptEyes: LOCATIONS.map(l => l.key).filter(key => key !== "eyes")
};

/** Куда бывает СП у брони и черт: локации и их группы. */
export const DR_LOCATIONS = [...LOCATIONS.map(l => l.key), ...Object.keys(DR_GROUPS)];

/**
 * СП по локациям, как charCalcDR в GMentor: естественная СП локации, общий бонус и бонусы брони и черт.
 * Бонус с типом урона действует только против него, поэтому СП против типа = общая СП + такие бонусы.
 * @param {{location: string, damageType: string, value: number}[]} bonuses
 * @param {number} [common=0]  СП на всё тело (Active Effects)
 * @returns {object[]}  LOCATIONS с итоговой dr и types — [{type, dr}] против отдельных типов урона
 */
export function locationArmor(bonuses, common = 0) {
  const armor = new Map(LOCATIONS.map(l => [l.key, { dr: l.dr + common, byType: {} }]));
  for ( const { location, damageType, value } of bonuses ) {
    for ( const key of DR_GROUPS[location] ?? [location] ) {
      const entry = armor.get(key);
      if ( !entry ) continue;
      if ( damageType ) entry.byType[damageType] = (entry.byType[damageType] ?? 0) + value;
      else entry.dr += value;
    }
  }
  return LOCATIONS.map(location => {
    const { dr, byType } = armor.get(location.key);
    const types = Object.entries(byType).filter(([, add]) => add).map(([type, add]) => ({ type, dr: dr + add }));
    return { ...location, dr, types };
  });
}

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

/**
 * Сколько можно пройти за ход при текущем Движении: шаг (1/10 Движения, не меньше ярда; B368), полное
 * Движение и рывок (+20% Движения, не меньше +1, после хода бега по прямой; B354).
 */
export function movementBands(move) {
  if ( !(move > 0) ) return { step: 0, move: 0, sprint: 0 };
  return {
    step: Math.max(1, Math.floor(move / 10)),
    move,
    sprint: move + Math.max(1, Math.floor(move * 0.2))
  };
}

// Стартовое богатство по ТУ кампании (B27), как getStartingWealth в GMentor; от ТУ12 — $100 000
const STARTING_WEALTH = [250, 500, 750, 1000, 2000, 5000, 10000, 15000, 20000, 30000, 50000, 75000, 100000];

/** Стартовые деньги персонажа: по ТУ и множителю черты «Богатство» (B25–B27). */
export function startingWealth(tl, multiplier = 1) {
  const base = STARTING_WEALTH[Math.min(Math.max(tl, 0), STARTING_WEALTH.length - 1)];
  return base * multiplier;
}

// Цена уровня атрибута (B14)
export const ATTRIBUTE_COST = { st: 10, dx: 20, iq: 20, ht: 10 };

// Атрибуты, цену которых снижают черты (cost_reduction)
export const COST_REDUCTION_ATTRIBUTES = Object.keys(ATTRIBUTE_COST);

/**
 * Стоимость атрибута. Скидка (например, за SM для ST) действует только на уровни выше 10, как в GMentor.
 * @param {number} costModifier  Множитель стоимости, не меньше 0.2
 */
export function attributeCost(key, value, costModifier = 1) {
  const k = value > 10 ? costModifier : 1;
  return Math.round((value - 10) * ATTRIBUTE_COST[key] * k);
}

/** Скидка за модификатор размера на ST и HP (B15), в процентах: 10 за каждый SM выше 0, SM не больше 8. */
export function sizeCostReduction(sm) {
  return 10 * Math.min(Math.max(sm, 0), 8);
}

/**
 * Множитель цены атрибута по сумме скидок в процентах (за SM и от черт, cost_reduction: «Нет тонких
 * манипуляторов» −40% к ST и DX, B145). Скидки складываются, цена не меньше 20%, как в GMentor.
 */
export function attributeCostModifier(reduction) {
  return Math.max(1 - reduction / 100, 0.2);
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
 * Стоимость преимущества или недостатка с уровнями, улучшениями и ограничениями (B101, B110), как calcAdvantage
 * в GMentor. Модификатор бывает в процентах, в очках или множителем; affects задаёт, на что он действует:
 * на всю цену (total), только на базовую (base) или только на цену уровней (levels).
 * Проценты на базу и на уровни складываются отдельно, каждая сумма не ниже −80%.
 */
export function traitCost({ basePoints, pointsPerLevel, levels, cr, modifiers, roundDown }) {
  let base = basePoints;
  let perLevel = pointsPerLevel;
  let basePercent = 0;
  let levelPercent = 0;
  let multiplier = SELF_CONTROL_MULTIPLIER[cr] ?? 1;
  for ( const modifier of modifiers ) {
    if ( !modifier.enabled ) continue;
    const value = modifier.value * modifier.levels;
    if ( modifier.costType === "multiplier" ) multiplier *= value;
    else if ( modifier.costType === "points" ) {
      if ( modifier.affects === "levels" ) perLevel += value;
      else base += value;
    }
    else {
      if ( modifier.affects !== "levels" ) basePercent += value;
      if ( modifier.affects !== "base" ) levelPercent += value;
    }
  }
  const withPercent = (points, percent) => points * (1 + Math.max(percent, -80) / 100);
  const raw = (withPercent(base, basePercent) + withPercent(perLevel * levels, levelPercent)) * multiplier;
  // Убираем погрешность дробей (10 * 1.1 = 11.000000000000002), иначе ceil даст 12
  const cost = Math.round(raw * 1000) / 1000;
  return roundDown ? Math.floor(cost) : Math.ceil(cost);
}

/**
 * Характеристики, к которым черта даёт бонус (attribute_bonus в библиотеке GMentor).
 * Ключи совпадают с CharacterData#bonuses. vision, hearing, tasteSmell, touch — чувства (B358).
 */
export const BONUS_TARGETS = ["st", "dx", "iq", "ht", "hp", "fp", "will", "per", "speed", "move", "sm",
  "dodge", "parry", "block", "fright", "strikingSt", "liftingSt", "vision", "hearing", "tasteSmell", "touch"];

/**
 * Английский идентификатор предмета: "Fast-Draw" → "fast-draw", "Sex Appeal" → "sex-appeal".
 * По нему черты находят умения и заклинания, которым дают бонус, независимо от русского названия.
 */
export function toIdentifier(text) {
  return String(text).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Способы сравнения названий из библиотеки GMentor/GCS (skill_bonus, spell_bonus)
export const COMPARE = ["is", "is anything", "starts with", "contains", "does not contain", "is not"];

/** Сравнение строки с образцом одним из способов COMPARE. Строки сравниваются как есть, нормализует вызывающий. */
export function compareText(value, pattern, compare) {
  switch ( compare ) {
    case "is anything": return true;
    case "starts with": return value.startsWith(pattern);
    case "contains": return value.includes(pattern);
    case "does not contain": return !value.includes(pattern);
    case "is not": return value !== pattern;
    default: return value === pattern;
  }
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
 * Превращает запись урона GURPS в формулу Foundry: "sw+2 cut" → {formula: "2d6+1", type: "cut"}, "2d8+1" → "2d8+1".
 * thr/sw подставляются из переданных значений персонажа.
 */
export function parseDamage(text, { thr, sw }) {
  const match = String(text).trim().match(/^(thr|sw|\d+d\d*)\s*([+-]\s*\d+)?\s*(.*)$/i);
  if ( !match ) return null;
  let [, base, add, type] = match;
  base = base.toLowerCase();
  if ( base === "thr" || base === "sw" ) {
    const [dice, mod = "0"] = (base === "thr" ? thr : sw).split("d");
    base = `${dice}d`;
    add = Number(mod || 0) + Number((add ?? "0").replace(/\s/g, ""));
  }
  else add = Number((add ?? "0").replace(/\s/g, ""));
  const [dice, sides] = base.split("d");
  const formula = `${dice}d${sides || 6}${add > 0 ? `+${add}` : add < 0 ? add : ""}`;
  return { formula, type: type.trim() };
}

/* -------------------------------------------- */
/*  Оружие                                      */
/* -------------------------------------------- */

/**
 * Урон оружия кубиками персонажа, как damage-result в GMentor: "sw+2 cut" при sw 1d+2 → "2d cut".
 * Урон без thr/sw ("2d+1 pi", "Special") возвращается как есть.
 */
export function resolveDamage(text, { thr, sw }) {
  const match = String(text).trim().match(/^(thr|sw)\s*([+-]\s*\d+)?(.*)$/i);
  if ( !match ) return String(text).trim();
  const [, base, add, rest] = match;
  const dice = (base.toLowerCase() === "thr") ? thr : sw;
  // Делитель брони пишется вплотную к кубикам: "1d(2) pi"
  const tail = rest.trim();
  const separator = tail.startsWith("(") ? "" : " ";
  return `${addDamage(dice, Number((add ?? "0").replace(/\s/g, "")))}${separator}${tail}`.trim();
}

/** Число со знаком: 2 → "+2", -1 → "-1". */
const signed = number => (number >= 0 ? `+${number}` : String(number));

// Части составного урона: удар и эффект заклинания через «+» ("thr-1 cr +1d+1 burn/point", "thr-1 cr + Paralysis")
// или эффект через « - » ("1d kb/point - Blinds"). "thr +1 cr" и "sw+1d cut" — не составной урон
const DAMAGE_PART_SEPARATOR = /\s+\+\s*(?=\d+d|[a-z])|\s+-\s+(?=[a-z])/i;

/** Составной урон по частям: "thr-1 cr +1d burn/point" → ["thr-1 cr", "1d burn/point"]. Каждая бросается отдельно. */
export function damageParts(text) {
  return String(text).trim().split(DAMAGE_PART_SEPARATOR).map(part => part.trim()).filter(Boolean);
}

// Урон заклинания за вложенную энергию: "1d burn/point", "1d-1 burn ex/2 points", "1d/point"
const DAMAGE_PER_ENERGY = /^(\d+)d([+-]\d+)?\s*(.*?)\s*\/\s*(\d+)?\s*points?$/i;

/** За сколько очков энергии даётся урон из записи заклинания: "1d burn/point" → 1, "…/2 points" → 2, иначе null. */
export function energyStep(text) {
  const match = String(text).trim().match(DAMAGE_PER_ENERGY);
  return match ? Number(match[4] ?? 1) : null;
}

/**
 * Урон заклинания при вложенной энергии (M): кубики и прибавка умножаются на число шагов.
 * "1d-1 burn/point" и 3 очка → "3d-3 burn", "1d burn ex/2 points" и 4 очка → "2d burn ex".
 */
export function energyDamage(text, energy) {
  const match = String(text).trim().match(DAMAGE_PER_ENERGY);
  if ( !match ) return String(text).trim();
  const [, dice, add = "0", type, per = "1"] = match;
  const steps = Math.max(Math.floor(energy / Number(per)), 1);
  const bonus = Number(add) * steps;
  return `${Number(dice) * steps}d${bonus ? signed(bonus) : ""} ${type}`.trim();
}

// Урон в записи оружия: "2d+1", "sw+2", "thr" (без "3dx2" — множитель кубиков)
const DAMAGE_DICE = /\b(\d{1,2})d([+-]\d{1,2})?(?!x)/;
const DAMAGE_BY_ST = /\b(sw|thr)([+-]\d{1,2})?\b/;

/** Сколько кубиков в уроне оружия: у "sw+2" — сколько их в sw персонажа. */
export function damageDice(text, { thr, sw }) {
  const dice = String(text).match(DAMAGE_DICE);
  if ( dice ) return Number(dice[1]);
  const byST = String(text).match(DAMAGE_BY_ST);
  return byST ? parseInt(byST[1] === "thr" ? thr : sw) || 1 : 1;
}

/** Прибавить к урону оружия, как "damage value" в GMentor: "sw+2 cut" +1 → "sw+3 cut", "2d+1 pi" +1 → "2d+2 pi". */
function addWeaponDamage(text, add) {
  const dice = text.match(DAMAGE_DICE);
  if ( dice ) return text.replace(dice[0], addDamage(dice[0], add));
  const byST = text.match(DAMAGE_BY_ST);
  if ( !byST ) return `${text}${signed(add)}`;
  const mod = Number(byST[2] ?? 0) + add;
  return text.replace(byST[0], `${byST[1]}${mod ? signed(mod) : ""}`);
}

/** Делитель брони (B378), как "damage dr" в GMentor: "1d+2 imp" и 2 → "1d+2(2) imp"; старый делитель заменяется. */
function setArmorDivisor(text, divisor) {
  const match = text.match(/\b((?:\d{1,2}d|sw|thr)(?:[+-]\d{1,2})?)(\([\d.]+\))?/);
  if ( !match ) return `${text}(${divisor})`;
  return text.replace(match[0], `${match[1]}(${divisor})`);
}

/**
 * Тип урона, как "damage type" в GMentor: "pi" и т.п. заменяет тип, "++" и "--" сдвигают проникающий урон
 * на ступень (pi- → pi → pi+ → pi++), как пули с полой оболочкой и бронебойные (B279).
 */
function changeDamageType(text, type) {
  const steps = ["pi--", "pi-", "pi", "pi+", "pi++"];
  let result;
  if ( (type === "++") || (type === "--") ) {
    result = text.replace(/\bpi(\+\+|\+|--|-)?(?=$|\s)/i, found => {
      const index = steps.indexOf(found.toLowerCase()) + (type === "++" ? 1 : -1);
      return steps[Math.min(Math.max(index, 0), steps.length - 1)];
    });
  }
  else result = text.replace(/\b(cr|cut|imp|burn)\b|\bpi(\+\+|\+|--|-)?(?=$|\s)/i, type);
  return result === text ? `${text} ${type}` : result;
}

/** Умножить дальность: "150/200" × 1.2 → "180/240", "x1/x1.5" × 2 → "x2/x3". */
function multiplyRange(text, factor) {
  return text.replace(/\d+(?:\.\d+)?/g, number => String(Math.round(Number(number) * factor * 100) / 100));
}

/**
 * Режим оружия с модификаторами снаряжения (equipment_modifier в GMentor: качество, прицелы, особые стрелы),
 * как charCalcWeapons. Точность и дальность меняются только у стрелкового режима (у ближнего их нет).
 * @param {{damage: string, accuracy?: string, range?: string}} mode
 * @param {object[]} modifiers  Изменения из EquipmentData#weaponModifiers
 * @param {{thr: string, sw: string}} damage  Урон персонажа, для модификаторов «за кубик»
 * @returns {{damage: string, accuracy?: string, range?: string, skill: number}}  skill — прибавка к уровню
 */
export function modifyWeapon({ damage, accuracy, range }, modifiers, { thr, sw }) {
  let skill = 0;
  for ( const modifier of modifiers ) {
    switch ( modifier.type ) {
      case "damage": {
        const dice = modifier.perDice ? damageDice(damage, { thr, sw }) : 1;
        damage = addWeaponDamage(damage, modifier.amount * dice);
        break;
      }
      case "armorDivisor": damage = setArmorDivisor(damage, modifier.value); break;
      case "damageType": damage = changeDamageType(damage, modifier.value); break;
      case "accuracy":
        if ( accuracy === undefined ) break;
        // "4" + 1 → "5"; "4+2" (с прицелом) + 1 → "4+2+1", как add в GMentor
        accuracy = /^[+-]?\d+$/.test(accuracy.trim())
          ? String(Number(accuracy) + modifier.amount) : `${accuracy}${signed(modifier.amount)}`;
        break;
      case "scope":
        // Бонус прицела пишется отдельно (B278): "4" → "4+2"
        if ( accuracy !== undefined ) accuracy = `${accuracy}${signed(modifier.amount)}`;
        break;
      case "range":
        if ( range !== undefined ) range = multiplyRange(range, modifier.multiplier);
        break;
      case "skill": skill += modifier.amount; break;
    }
  }
  return { damage, accuracy, range, skill };
}

/** Дальность метательного оружия в долях ST (B270): "x1/x1.5" при ST 10 → "10/15". */
export function resolveRange(text, st) {
  const range = String(text).trim();
  if ( !range.startsWith("x") ) return range;
  return range.split("/").map(part => {
    const factor = Number(part.trim().slice(1));
    return part.trim().startsWith("x") && Number.isFinite(factor) ? String(Math.round(factor * st)) : part;
  }).join("/");
}

/**
 * Хватает ли силы для оружия (B270), как charCalcWeapons в GMentor: "10", "11B" — с сошкой хватает 2/3,
 * "20M" — на станке, не проверяется. Нечисловое значение ("-") не проверяется.
 */
export function lacksStrength(minSt, st) {
  const text = String(minSt);
  const value = parseInt(text);
  if ( !Number.isFinite(value) || text.includes("M") ) return false;
  if ( text.includes("B") ) return Math.ceil(value * 2 / 3) > st;
  return value > st;
}

/**
 * Парирование или блок оружием (B376): половина уровня + 3 + модификатор оружия.
 * Модификатор записан как в книге: "0", "-2U", "+2", "0F"; "No" и пусто — защищаться этим оружием нельзя.
 * @returns {{value: number, note: string}|null}  note — пометка после числа (U — неуравновешенное, F — фехтовальное)
 */
export function weaponDefense(text, level) {
  const match = String(text).trim().match(/^([+-]?\d+)(.*)$/);
  if ( !match || (level === null) ) return null;
  return { value: Math.floor(level / 2) + 3 + Number(match[1]), note: match[2].trim() };
}

// Способ атаки (usage в библиотеках GMentor и GCS) по-русски; незнакомые остаются как есть.
// Jet, Gaze, Breath, Area — у заклинаний
export const WEAPON_USAGES = {
  Swung: "Замах", Thrust: "Укол", "Shield Bash": "Удар щитом", Punch: "Удар", Thrown: "Бросок",
  Fragmentation: "Осколки", Concussion: "Контузия", Stun: "Оглушение",
  Jet: "Струя", Gaze: "Взгляд", Breath: "Дыхание", Area: "Область", Grapple: "Захват"
};

/* -------------------------------------------- */
/*  Сотворение заклинаний                       */
/* -------------------------------------------- */

// Типы заклинаний для окна сотворения (M10–M15), как в инструменте GMentor
export const SPELL_CAST_TYPES = ["regular", "area", "melee", "missile", "blocking", "info", "enchantment"];

// Уровень маны (M5): при низкой −5 к навыку, при очень высокой любой провал — критический
export const MANA_LEVELS = ["veryHigh", "high", "normal", "low"];

// Дальность информационного заклинания (B241): до 200 м, полмили, 1, 3, 10 … 1 000 000 миль
export const INFO_RANGE_MODIFIERS = [0, -1, -2, -3, -4, -5, -6, -7, -8, -10, -12, -14];

/** Тип для окна сотворения по классу заклинания: "Regular/Blocking" → "regular", "Info" → "info", "Special" → "regular". */
export function spellCastType(spellClass) {
  const first = String(spellClass).trim().toLowerCase().split(/[\s/]/)[0];
  return SPELL_CAST_TYPES.includes(first) ? first : "regular";
}

/**
 * Итоговый навык сотворения, как toolSpellCast в GMentor: низкая мана −5, −1 за каждую ЕЖ вместо ЕУ,
 * −1 за каждое действующее заклинание и −3 за требующее концентрации (M8), расстояние −1 за метр и −5,
 * если цель не видна (M10–M11), дальность информационного по таблице и −1 за игнорируемый объект (M13).
 * Против сопротивления навык не выше 16, если сопротивление не выше (правило 16, B349).
 */
export function spellCastTarget({ level, modifier = 0, mana = "normal", hpInstead = 0, activeSpells = 0,
  concentrating = 0, type = "regular", range = 0, unseen = false, infoRange = 0, ignored = 0, resisted = false,
  resistance = 10 }) {
  let target = level + modifier - hpInstead - activeSpells - (3 * concentrating);
  if ( mana === "low" ) target -= 5;
  if ( (type === "regular") || (type === "area") ) target -= range + (unseen ? 5 : 0);
  if ( type === "info" ) target += infoRange - ignored;
  if ( resisted ) target = Math.min(target, Math.max(16, resistance));
  return target;
}

/**
 * Ритуал, скидка на стоимость и множитель времени по уровню заклинания (M9), как подсказка GMentor:
 * до 10 — громкие слова и время ×2; 10+ — тихие слова и жест; 15+ — слово или жест, −1 к стоимости;
 * 20+ — без ритуала, −2 и время ÷2; дальше каждые 5 уровней ещё −1 и ÷2. У блокирующих стоимость и время
 * не меняются.
 * @returns {{ritual: "loud"|"quiet"|"word"|"none"|"absent", costReduction: number, timeFactor: number}}
 */
export function castingEffects(level, { mana = "normal", type = "regular" } = {}) {
  const skill = (mana === "low") ? level - 5 : level;
  let ritual = "loud";
  if ( skill >= 25 ) ritual = "absent";
  else if ( skill >= 20 ) ritual = "none";
  else if ( skill >= 15 ) ritual = "word";
  else if ( skill >= 10 ) ritual = "quiet";
  if ( type === "blocking" ) return { ritual, costReduction: 0, timeFactor: 1 };
  const costReduction = (skill >= 15) ? Math.floor(skill / 5) - 2 : 0;
  let timeFactor = 1;
  if ( skill < 10 ) timeFactor = 2;
  else if ( skill >= 20 ) timeFactor = 1 / (2 ** (Math.floor(skill / 5) - 3));
  return { ritual, costReduction, timeFactor };
}

/** Базовая стоимость из записи заклинания, если это просто число ("3"); "Varies", "1-3", "1#" → null. */
export function baseSpellCost(castingCost) {
  const text = String(castingCost).trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

/**
 * Энергия на сотворение: обычное заклинание — × (МР + 1) цели при МР больше 0, областное — × радиус
 * больше 1 (M10–M11), затем скидка за уровень, не меньше 0.
 */
export function spellEnergy(baseCost, { type = "regular", sm = 0, radius = 1, costReduction = 0 } = {}) {
  let cost = baseCost;
  if ( (type === "regular") && (sm > 0) ) cost *= sm + 1;
  if ( (type === "area") && (radius > 1) ) cost *= radius;
  return Math.max(cost - costReduction, 0);
}

/**
 * Сколько энергии тратится по исходу броска: при критическом успехе — ничего (как в GMentor), при провале — 1,
 * при критическом провале — вся (B236). Часть платится ЕЖ вместо ЕУ (hpInstead), но не больше потраченного.
 * @returns {{fp: number, hp: number}}
 */
export function spentEnergy(cost, outcome, hpInstead = 0) {
  let spent = cost;
  if ( outcome === "critSuccess" ) spent = 0;
  else if ( outcome === "failure" ) spent = Math.min(cost, 1);
  const hp = Math.min(hpInstead, spent);
  return { fp: spent - hp, hp };
}

/* -------------------------------------------- */
/*  Дистанционная атака                         */
/* -------------------------------------------- */

// Таблица размера и скорости/дистанции (B550): наибольшее расстояние в метрах для штрафа 0, −1, −2 …
const RANGE_STEPS = [2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100, 150, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 5000,
  7000, 10000, 15000, 20000, 30000, 50000, 70000, 100000, 150000, 200000, 300000, 500000, 700000];

/** Штраф за скорость плюс расстояние (B550), как getRangeSpeedModifier в GMentor: 10 м → −4, 100 м → −10. */
export function rangeSpeedModifier(distance) {
  const index = RANGE_STEPS.findIndex(step => distance <= step);
  const steps = (index === -1) ? RANGE_STEPS.length : index;
  return steps ? -steps : 0;
}

// Размер цели меньше 1.5 м (B550): наибольший размер для SM −15, −14 … −1
const SMALL_SIZES = [0.005, 0.0085, 0.0127, 0.0169, 0.025, 0.038, 0.05, 0.0762, 0.1778, 0.2032, 0.3, 0.45, 0.6, 1, 1.5];

/** Модификатор размера по наибольшему измерению в метрах (B550), как getSizeModifier в GMentor: 1.8 м → 0. */
export function sizeModifier(size) {
  const index = SMALL_SIZES.findIndex(limit => size < limit);
  return index === -1 ? Math.abs(rangeSpeedModifier(size)) : index - SMALL_SIZES.length;
}

// Бонус скорострельности (B373): наибольшее число выстрелов для +0, +1 …
const RAPID_FIRE_STEPS = [4, 8, 12, 16, 24, 49, 99, 200, 400, 800, 1600];

/** Бонус за число выстрелов (B373), как getRofBonus в GMentor: 5–8 → +1, 9–12 → +2. */
export function rapidFireBonus(shots) {
  const index = RAPID_FIRE_STEPS.findIndex(step => shots <= step);
  return index === -1 ? RAPID_FIRE_STEPS.length : index;
}

/**
 * Куда целиться (B398–B400, Martial Arts), как список локаций инструментов GMentor. location — локация попадания
 * для ранения: у щитовой руки та же, что у руки, у вен и суставов свои правила.
 */
export const ATTACK_LOCATIONS = [
  { key: "random", location: "random", toHit: 0 },
  { key: "torso", location: "torso", toHit: 0 },
  { key: "arm", location: "arms", toHit: -2 },
  { key: "shieldArm", location: "arms", toHit: -4 },
  { key: "leg", location: "legs", toHit: -2 },
  { key: "foot", location: "feet", toHit: -4 },
  { key: "hand", location: "hands", toHit: -4 },
  { key: "shieldHand", location: "hands", toHit: -8 },
  { key: "skull", location: "skull", toHit: -7 },
  { key: "face", location: "face", toHit: -5 },
  { key: "neck", location: "neck", toHit: -5 },
  { key: "groin", location: "groin", toHit: -3 },
  { key: "eye", location: "eyes", toHit: -9 },
  { key: "vitals", location: "vitals", toHit: -3 },
  { key: "ear", location: "ear", toHit: -7 },
  { key: "jaw", location: "jaw", toHit: -6 },
  { key: "bigJoint", location: "bigJoint", toHit: -5 },
  { key: "smallJoint", location: "smallJoint", toHit: -7 },
  { key: "nose", location: "nose", toHit: -7 },
  { key: "spine", location: "spine", toHit: -8 },
  { key: "limbVein", location: "limbVein", toHit: -5 },
  { key: "neckVein", location: "neckVein", toHit: -8 },
  { key: "wing", location: "wings", toHit: -2 },
  { key: "tail", location: "tail", toHit: -3 },
  { key: "weaponSmall", location: "weapon", toHit: -5 },
  { key: "weaponMedium", location: "weapon", toHit: -4 },
  { key: "weaponLarge", location: "weapon", toHit: -3 }
];

// Промах на 1 по мелкой цели попадает в соседнюю (B400), как в GMentor; остальные — в торс
const MISS_BY_ONE = { limbVein: "arms", neckVein: "neck", bigJoint: "arms", smallJoint: "hands" };
const MISS_BY_ONE_TO_TORSO = ["eyes", "skull", "face", "groin", "neck", "vitals", "ear", "nose", "jaw", "spine"];

/** Куда попадает промах на 1 при прицельной атаке (B400) или null, если по этой локации промах — промах. */
export function missByOneLocation(location) {
  if ( MISS_BY_ONE[location] ) return MISS_BY_ONE[location];
  return MISS_BY_ONE_TO_TORSO.includes(location) ? "torso" : null;
}

// Чья СП у локаций, которых нет в LOCATIONS: жизненно важные органы и позвоночник — под бронёй торса (B399),
// ухо, нос, челюсть — части лица, вены и суставы конечностей — как рука (так же их промах на 1, MISS_BY_ONE)
const ARMOR_LOCATION = { random: "torso", vitals: "torso", spine: "torso", ear: "face", nose: "face", jaw: "face",
  neckVein: "neck", limbVein: "arms", bigJoint: "arms", smallJoint: "hands" };

/**
 * СП цели там, куда целятся, против типа урона: «pi» брони действует на весь колющий (pi-, pi+, pi++).
 * Случайная локация — СП торса. У крыльев, хвоста и оружия брони персонажа нет — null.
 * @param {object[]} locations   system.locations цели (locationArmor)
 * @param {string} aimedAt       Ключ ATTACK_LOCATIONS
 * @param {string} damageType    Тип урона атаки: "cut", "pi+"
 */
export function targetLocationDr(locations, aimedAt, damageType) {
  const location = ATTACK_LOCATIONS.find(entry => entry.key === aimedAt)?.location;
  const armor = locations.find(entry => entry.key === (ARMOR_LOCATION[location] ?? location));
  if ( !armor ) return null;
  const typeKey = damageType.startsWith("pi") ? "pi" : damageType;
  return armor.types.find(entry => entry.type === typeKey)?.dr ?? armor.dr;
}

/** Случайная локация по броску 3d6 (B552), как getRandomLocation в GMentor. */
export function randomLocation(total) {
  const location = LOCATIONS.find(({ roll }) => roll.split("/").some(part => {
    const [from, to = from] = part.trim().split("–").map(Number);
    return (total >= from) && (total <= to);
  }));
  return location?.key ?? "torso";
}

/** Дальность "25/50" → {half: 25, max: 50}; одно число — только максимальная дальность (B269). */
export function parseRange(text) {
  const numbers = String(text).split("/").map(part => parseFloat(part)).filter(Number.isFinite);
  if ( numbers.length > 1 ) return { half: numbers[0], max: numbers[1] };
  return { half: null, max: numbers[0] ?? null };
}

/**
 * Скорострельность (B373): "3x9" — 3 выстрела по 9 снарядов (дробь), "20!" — только очередями,
 * не меньше четверти RoF, как в GMentor.
 * @returns {{rof: number, burst: number, minShots: number}}
 */
export function parseRateOfFire(text) {
  const [rof, burst] = String(text).split("x").map(part => parseInt(part));
  const rate = rof || 1;
  return { rof: rate, burst: burst || 1, minShots: String(text).includes("!") ? Math.ceil(rate / 4) : 1 };
}

/**
 * Бонус прицеливания (B364): первый раунд даёт Acc, второй +1, третий и дальше +2. Оптика (B278) прибавляется,
 * когда раундов не меньше её бонуса; с переменным увеличением — по раунду, пока не наберётся весь бонус.
 * Бонус оптики не больше Acc.
 */
export function aimBonus(rounds, accuracy, { optics = false, opticsBonus = 0, variable = true } = {}) {
  if ( rounds <= 0 ) return 0;
  let bonus = accuracy + Math.min(rounds - 1, 2);
  if ( !optics ) return bonus;
  const scope = Math.min(opticsBonus, accuracy);
  if ( rounds >= scope ) bonus += scope;
  else if ( variable ) bonus += rounds;
  return bonus;
}

/**
 * Итоговый навык дистанционной атаки, как toolRangedAttack в GMentor (B372, B548–B550). Флажки с постоянным
 * модификатором (тотальная атака, плохая поверхность, транспорт) приходят списком в optionModifiers.
 * @param {object} values
 * @param {number} values.skill        Уровень оружия
 * @param {number} values.modifier     Прочие модификаторы
 * @param {object[]} values.optionModifiers  Модификаторы флажков (rangedOptionModifiers)
 * @param {string} values.location     Ключ ATTACK_LOCATIONS
 * @param {boolean} values.armorGaps   Сквозь щели в доспехах: −8 в торс, −10 в остальное вместо штрафа локации
 * @param {number} values.aim          Бонус прицеливания (aimBonus); при движении и атаке и высовывании — 0
 * @param {boolean} values.brace       Упор: +1 при прицеливании
 * @param {number} values.distance     Расстояние, м
 * @param {number} values.speed        Скорость цели, м/с
 * @param {number} values.height       Разница высот, м: выше цели — плюс к дистанции, ниже — минус половина
 * @param {number} values.heightFactor 1 — стрелок ниже цели, −0.5 — выше, 0 — на одной высоте
 * @param {number} values.shots        Выстрелов, burst — снарядов в выстреле
 * @param {boolean} values.pose        Цель пригнулась: −2 в торс, пах и ноги
 * @param {number} values.size         Модификатор размера цели
 * @param {number} values.lowSt        Штраф за недостаток ST (отрицательный или 0)
 * @param {number} values.visibility   Видимость, −10 — темнота
 * @param {boolean} values.unseen      Врага не видно: навык не выше 9
 * @param {number} values.controlFailure  На сколько провален бросок управления транспортом
 * @returns {{target: number, modifiers: object[], capped: boolean}}  Навык, ненулевые модификаторы {key, value}
 *   (у локации ещё location — ключ ATTACK_LOCATIONS) и ограничен ли навык 9
 */
export function rangedAttackTarget({ skill, modifier = 0, optionModifiers = [], location = "torso", armorGaps = false,
  aim = 0, brace = false, distance = 0, speed = 0, height = 0, heightFactor = 0, shots = 1, burst = 1, pose = false,
  size = 0, lowSt = 0, visibility = 0, unseen = false, controlFailure = 0 }) {
  const aimed = ATTACK_LOCATIONS.find(entry => entry.key === location) ?? ATTACK_LOCATIONS[1];
  // Стрелок выше цели сокращает расстояние, но не больше чем вдвое
  let heightShift = Math.ceil(height * heightFactor);
  if ( heightShift < -distance / 2 ) heightShift = -Math.floor(distance / 2);
  const targetCrouching = pose && ["torso", "leg", "groin"].includes(aimed.key);
  const modifiers = [
    { key: "modifier", value: modifier },
    ...optionModifiers,
    locationModifier(aimed, armorGaps),
    { key: "targetPose", value: targetCrouching ? -2 : 0 },
    { key: "aim", value: aim },
    { key: "brace", value: (brace && (aim > 0)) ? 1 : 0 },
    { key: "range", value: rangeSpeedModifier(distance + speed + heightShift) },
    { key: "rapidFire", value: rapidFireBonus(burst * shots) },
    { key: "size", value: size },
    { key: "lowSt", value: lowSt },
    { key: "visibility", value: visibility },
    { key: "controlFailure", value: -controlFailure }
  ];
  return attackTarget(skill, modifiers, unseen || (visibility <= -10));
}

/** Штраф за локацию; сквозь щели в доспехах — −8 в торс, −10 в остальное вместо него (B400). */
function locationModifier(aimed, armorGaps) {
  if ( armorGaps ) return { key: "armorGaps", value: (aimed.location === "torso") ? -8 : -10 };
  return { key: "location", location: aimed.key, value: aimed.toHit };
}

/** Навык атаки: уровень плюс модификаторы, при ограничении — не выше 9 (B365, B388, B394). Нулевые модификаторы отбрасываются. */
function attackTarget(skill, modifiers, capped) {
  const applied = modifiers.filter(({ value }) => value !== 0);
  const target = skill + applied.reduce((sum, { value }) => sum + value, 0);
  return { target: capped ? Math.min(target, 9) : target, modifiers: applied, capped };
}

/**
 * Флажки окна атаки с постоянным модификатором (B548), как флажки с value в GMentor. Атака с транспорта — B467.
 * Движение и атака (−2 или Bulk, если он хуже), бой вплотную (Bulk) и перекрывающие цель (−4 за каждого)
 * зависят от оружия и считаются в rangedOptionModifiers.
 */
export const RANGED_ATTACK_OPTIONS = { allOutAttack: 1, badFooting: -2, offHand: -4, dualWeapons: -4, popUp: -2,
  lightCover: -2, partlyHidden: -2, unfamiliar: -2, unseen: -6, unseenKnown: -4, opportunityCheck: -2 };

export const VEHICLE_ATTACK_OPTIONS = { hanging: -6, turnedBack: -4, vehicleDodged: -2, aircraftDodged: -4,
  goodRoadHandheld: -1, badRoadHandheld: -3, badRoadMount: -2, badRoadTurret: -1, offRoadHandheld: -4,
  offRoadMount: -3, offRoadTurret: -2, offRoadStabilized: -1, calmWaterHandheld: -3, calmWaterMount: -2,
  calmWaterTurret: -1, wavesHandheld: -4, wavesMount: -3, wavesTurret: -2, wavesStabilized: -1, aircraftHandheld: -1 };

// Стрельба по возможности (B390): сколько клеток под наблюдением → штраф; линия — −2
export const OPPORTUNITY_FIRE = { hex1: 0, hex2: -1, hex4: -2, hex6: -3, hex10: -4, hex11: -5, line: -2 };

/**
 * Модификаторы флажков окна атаки: постоянные, движение и атака, бой вплотную, перекрывающие цель
 * и стрельба по возможности.
 * @param {object} options  Включённые флажки (ключи RANGED_ATTACK_OPTIONS и VEHICLE_ATTACK_OPTIONS),
 *                          moveAndAttack, closeCombat, blockers — сколько людей перекрывают цель, opportunity
 * @param {number} bulk     Громоздкость оружия
 * @returns {object[]}  [{key, value}] включённых флажков
 */
export function rangedOptionModifiers(options, bulk) {
  const modifiers = [];
  for ( const [key, value] of Object.entries({ ...RANGED_ATTACK_OPTIONS, ...VEHICLE_ATTACK_OPTIONS }) ) {
    if ( options[key] ) modifiers.push({ key, value });
  }
  if ( options.moveAndAttack ) modifiers.push({ key: "moveAndAttack", value: Math.min(bulk, -2) });
  if ( options.closeCombat ) modifiers.push({ key: "closeCombat", value: bulk });
  if ( options.blockers > 0 ) modifiers.push({ key: "blockers", value: -4 * options.blockers });
  if ( options.opportunity ) modifiers.push({ key: "opportunityFire", value: OPPORTUNITY_FIRE[options.opportunity] ?? 0 });
  return modifiers;
}

/**
 * Урон снаряда по обстоятельствам атаки, как toolRangedAttack в GMentor: прибавка Мастера оружия (B99),
 * дальше 1/2D урон вдвое меньше (B269), дробь вплотную (ближе 10% от 1/2D) умножает урон и DR на половину
 * дробин (B409), щели в доспехах вдвое уменьшают DR (B400). Часть без кубиков ("Paralysis") не меняется.
 */
export function rangedDamage(text, { adds = 0, halfDamage = false, shotgunFactor = 1, armorGaps = false } = {}) {
  const record = damageRecord(text);
  if ( !record ) return String(text).trim();
  record.adds += adds;
  if ( halfDamage ) record.multiplier *= 0.5;
  if ( shotgunFactor > 1 ) {
    record.dice *= shotgunFactor;
    record.adds *= shotgunFactor;
    record.divisor /= shotgunFactor;
  }
  if ( armorGaps ) record.divisor *= 2;
  return damageRecordText(record);
}

/**
 * Флажки окна контактной атаки с постоянным модификатором (B547, B365), как флажки с value в toolMeleeAttack
 * GMentor. Скоростной удар, обманная атака и щит в бою вплотную зависят от выбора и считаются в meleeAttackTarget.
 */
export const MELEE_ATTACK_OPTIONS = { determined: 4, moveAndAttack: -4, badFooting: -2, grappled: -4, offHand: -4,
  dualWeapons: -4, intoCloseCombat: -2, wildSwing: -5, fromAbove: -2, largeShield: -2, mountAttacked: -2,
  mountSpeed: -1, unseen: -6, unseenKnown: -4 };

// Атаки, после которых навык не выше 9 (B365, B388, B394), как в GMentor
const MELEE_CAPPED_OPTIONS = ["moveAndAttack", "wildSwing", "unseen", "unseenKnown"];

/**
 * Итоговый навык контактной атаки, как toolMeleeAttack в GMentor (B369, B547).
 * @param {object} values
 * @param {number} values.skill          Уровень оружия
 * @param {number} values.modifier       Прочие модификаторы
 * @param {string} values.location       Ключ ATTACK_LOCATIONS
 * @param {boolean} values.armorGaps     Сквозь щели в доспехах: −8 в торс, −10 в остальное вместо штрафа локации
 * @param {number} values.lowSt          Штраф за недостаток ST (отрицательный или 0)
 * @param {boolean} values.rapidStrike   Скоростной удар (B370): −6, с Учеником мастера или Мастером оружия −3
 * @param {boolean} values.trainedByMaster
 * @param {number} values.deceptive      Обманная атака (B369): −2 за каждый −1 к защите противника
 * @param {number} values.shieldDb       Бой вплотную со щитом (B391): −DB щита
 * @param {number} values.evaluate       Оценка (B364): +1 за раунд
 * @param {number} values.pose           Поза атакующего (B551)
 * @param {number} values.visibility     Видимость, −10 — темнота
 * @returns {{target: number, modifiers: object[], capped: boolean}}  Как у rangedAttackTarget
 */
export function meleeAttackTarget({ skill, modifier = 0, location = "torso", armorGaps = false, lowSt = 0,
  rapidStrike = false, trainedByMaster = false, deceptive = 0, shieldDb = 0, evaluate = 0, pose = 0,
  visibility = 0, ...options }) {
  const aimed = ATTACK_LOCATIONS.find(entry => entry.key === location) ?? ATTACK_LOCATIONS[1];
  const modifiers = [
    { key: "modifier", value: modifier },
    locationModifier(aimed, armorGaps),
    { key: "lowSt", value: lowSt },
    { key: "evaluate", value: evaluate },
    { key: "attackerPose", value: pose },
    { key: "deceptive", value: -2 * deceptive },
    { key: "rapidStrike", value: rapidStrike ? (trainedByMaster ? -3 : -6) : 0 },
    { key: "shield", value: -shieldDb }
  ];
  for ( const [key, value] of Object.entries(MELEE_ATTACK_OPTIONS) ) {
    if ( options[key] ) modifiers.push({ key, value });
  }
  modifiers.push({ key: "visibility", value: visibility });
  const capped = MELEE_CAPPED_OPTIONS.some(key => options[key]) || (visibility <= -10);
  return attackTarget(skill, modifiers, capped);
}

/**
 * Урон удара по обстоятельствам, как toolMeleeAttack в GMentor: прибавка (Мастер оружия B99, сильная тотальная атака
 * B365) переводится в кубики (каждые 3.5 — кубик, B269), если не просили иначе; щели в доспехах вдвое уменьшают
 * DR (B400). Часть без кубиков ("Paralysis") не меняется.
 */
export function meleeDamage(text, { adds = 0, convertDice = true, armorGaps = false } = {}) {
  const record = damageRecord(text);
  if ( !record ) return String(text).trim();
  record.adds += adds;
  if ( convertDice && (record.sides === 6) ) {
    const [dice, mod = "0"] = addDamage(`${record.dice}d${record.adds ? signed(record.adds) : ""}`, 0).split("d");
    record.dice = Number(dice);
    record.adds = Number(mod);
  }
  if ( armorGaps ) record.divisor *= 2;
  return damageRecordText(record);
}

/** Сколько снарядов попало (B373): 1 + запас успеха / отдача, но не больше выпущенных. */
export function hitsFromMargin(margin, recoil, fired) {
  return Math.min(1 + Math.floor(margin / Math.max(recoil, 1)), fired);
}

// Урон с множителем и делителем брони, как damageStrToObj в GMentor: "3d+1x0.5(2) pi+ rest"
const DAMAGE_RECORD = /^(\d+)d(\d+)?([+-]\d+)?(?:x([\d.]+))?(?:\(([\d.]+)\))?\s*(burn|fat|tox|cor|cr|imp|cut|ex|pi\+\+|pi\+|pi-|pi)?(.*)$/i;

/**
 * Запись урона частями, чтобы менять их по обстоятельствам атаки (половина урона, дробь вплотную, щели в доспехах).
 * @returns {{dice: number, sides: number, adds: number, multiplier: number, divisor: number, type: string, tail: string}|null}
 */
export function damageRecord(text) {
  const match = String(text).trim().match(DAMAGE_RECORD);
  if ( !match ) return null;
  const [, dice, sides, adds, multiplier, divisor, type, tail] = match;
  return { dice: Number(dice), sides: Number(sides ?? 6), adds: Number(adds ?? 0), multiplier: Number(multiplier ?? 1),
    divisor: Number(divisor ?? 1), type: (type ?? "").toLowerCase(), tail: tail.trim() };
}

/** Запись урона обратно в текст, как damageObjToStr в GMentor: "2d+2x0.5(2) pi". */
export function damageRecordText({ dice, sides, adds, multiplier, divisor, type, tail }) {
  const round2 = number => Math.round(number * 100) / 100;
  let text = `${dice}d${sides === 6 ? "" : sides}${adds ? signed(adds) : ""}`;
  if ( multiplier !== 1 ) text += `x${round2(multiplier)}`;
  if ( divisor !== 1 ) text += `(${round2(divisor)})`;
  // Урон за энергию пишется слитно: "1d burn/point"
  const description = [type, tail].filter(Boolean).join(" ").replace(/\s+\//, "/");
  return [text, description].filter(Boolean).join(" ");
}

// Размеры кубиков по кругу, как кнопка «dice» в toolDiceRoll GMentor
const DIE_SIZES = [4, 6, 8, 10, 12, 20, 100];

/**
 * Урон, изменённый кнопками окна броска (toolDiceRoll GMentor): кубики, прибавка и размер кубика меняются
 * у первой части с кубиками, прибавка в кубики не переводится. Кубиков не меньше одного.
 * modifyDamage("1d+2 cut", {dice: 1}) → "2d+2 cut", modifyDamage("2d", {nextSize: true}) → "2d8".
 */
export function modifyDamage(text, { dice = 0, adds = 0, nextSize = false } = {}) {
  text = String(text).trim();
  const part = damageParts(text).find(damageRecord);
  if ( !part ) return text;
  const record = damageRecord(part);
  record.dice = Math.max(record.dice + dice, 1);
  record.adds += adds;
  if ( nextSize ) record.sides = DIE_SIZES[(DIE_SIZES.indexOf(record.sides) + 1) % DIE_SIZES.length];
  return text.replace(part, damageRecordText(record));
}

/**
 * Урон одного снаряда против DR (B378), как damageRoll в GMentor: результат кубиков × множитель, DR делится на
 * делитель брони (не меньше 1, если она есть), урона не меньше 0.
 * @returns {{damage: number, dr: number, penetrating: number}}
 */
export function penetratingDamage(rolled, { multiplier = 1, divisor = 1 } = {}, dr = 0) {
  const damage = Math.round(rolled * multiplier);
  const effectiveDr = dr > 0 ? Math.max(Math.round(dr / divisor - 0.0001), 1) : 0;
  return { damage, dr: effectiveDr, penetrating: Math.max(damage - effectiveDr, 0) };
}

// Множители ранения по типу урона (B379) и у неживых, однородных целей (B380)
const WOUNDING = {
  normal: { "pi++": 2, "pi+": 1.5, "pi-": 0.5, imp: 2, cut: 1.5 },
  unliving: { "pi++": 1, "pi+": 0.5, pi: 1 / 3, "pi-": 0.2, imp: 1, cut: 1.5 },
  homogenous: { "pi++": 0.5, "pi+": 1 / 3, pi: 0.2, "pi-": 0.1, imp: 0.5, cut: 1.5 }
};

const LIMBS = ["arms", "legs", "feet", "hands", "bigJoint", "smallJoint"];

/**
 * Множитель ранения и пометки к попаданию (B379–B400), как toolLocationsTexts в GMentor. Пометки — ключи
 * перевода GMENTOR.Attack.wound.*. У рассеянной цели (B380) рана не больше 1 от проникающих и 2 от остальных.
 * Отличие от GMentor: режущий урон у неживых и однородных целей ×1.5, как в книге (в GMentor ×1).
 * @returns {{multiplier: number, notes: string[], maxInjury: number|null}}
 */
export function woundingModifier(type, location, targetType = "normal") {
  const piercing = type.startsWith("pi") || (type === "imp");
  const notes = [];
  let multiplier = (WOUNDING[targetType] ?? WOUNDING.normal)[type] ?? 1;
  if ( targetType === "diffuse" ) multiplier = 1;

  switch ( location ) {
    case "vitals":
      if ( piercing ) multiplier = 3;
      if ( type === "burn" ) {
        multiplier = 2;
        notes.push("vitalsBurn");
      }
      break;
    case "skull":
    case "eyes":
      if ( type !== "tox" ) {
        multiplier = 4;
        notes.push("stun10");
      }
      if ( (location === "eyes") && (piercing || (type === "burn")) ) notes.push("eyeBlinded");
      break;
    case "face":
      notes.push("stun5");
      if ( type === "cor" ) {
        multiplier = 1.5;
        notes.push("faceCorrosion");
      }
      break;
    case "neck":
      if ( (type === "cr") || (type === "cor") ) multiplier = 1.5;
      if ( type === "cut" ) multiplier = 2;
      break;
    case "groin":
      if ( type === "cr" ) notes.push("groinCrushing");
      break;
    case "ear":
      notes.push("stun5");
      if ( type === "cut" ) notes.push("earCut");
      break;
    case "nose":
      notes.push("stun5", "noseBroken");
      if ( type === "cut" ) notes.push("noseCut");
      break;
    case "jaw":
      notes.push(type === "cr" ? "stun6" : "stun5");
      break;
    case "spine":
      notes.push("spine");
      break;
    case "limbVein":
    case "neckVein":
      multiplier += 0.5;
      if ( (location === "neckVein") && (type === "cut") ) multiplier += 0.5;
      notes.push("veins");
      break;
    case "weapon":
      multiplier = 1;
      notes.push("weapon");
      break;
  }
  if ( LIMBS.includes(location) ) {
    if ( ["pi+", "pi++", "imp"].includes(type) ) multiplier = 1;
    if ( (location === "arms") || (location === "legs") ) notes.push("crippledHalf");
    else if ( location === "smallJoint" ) notes.push("crippledQuarter");
    else notes.push("crippledThird");
    if ( location.endsWith("Joint") ) notes.push("joint");
  }
  const maxInjury = (targetType === "diffuse") ? (piercing ? 1 : 2) : null;
  return { multiplier: Math.round(multiplier * 1000) / 1000, notes, maxInjury };
}
