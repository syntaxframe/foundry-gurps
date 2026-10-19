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

// Стартовое богатство по ТУ кампании (B27), как getStartingWealth в GMentor; от ТУ12 — $100 000
const STARTING_WEALTH = [250, 500, 750, 1000, 2000, 5000, 10000, 15000, 20000, 30000, 50000, 75000, 100000];

/** Стартовые деньги персонажа: по ТУ и множителю черты «Богатство» (B25–B27). */
export function startingWealth(tl, multiplier = 1) {
  const base = STARTING_WEALTH[Math.min(Math.max(tl, 0), STARTING_WEALTH.length - 1)];
  return base * multiplier;
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
function damageDice(text, { thr, sw }) {
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
