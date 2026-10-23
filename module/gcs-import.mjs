/**
 * Импорт персонажа из файла GCS 5 (.gcs, JSON). Чистые функции перевода не зависят от Foundry и проверяются
 * обычным node; Foundry нужен только importGcsCharacter: библиотеки, загрузка портрета и запись в персонажа.
 *
 * Файл — источник очков, уровней, модификаторов и эффектов. Английских названий в нём нет (только русские),
 * поэтому identifier, описание и данные, которых в файле нет (школа и требования заклинания, защита умения),
 * берутся из записи библиотеки с тем же русским названием.
 */
import { COMPARE, COST_REDUCTION_ATTRIBUTES, DIFFICULTY, DR_LOCATIONS, toIdentifier, WEAPON_USAGES } from "./rules.mjs";

/** Атрибуты GCS → вводимые поля персонажа: основные — купленный уровень, вторичные — отклонение от базы. */
const SECONDARY_ATTRIBUTES = { will: "will", per: "per", hp: "hp", fp: "fp", basic_speed: "speed", basic_move: "move" };

// attribute_bonus: атрибут GCS → ключ rules.BONUS_TARGETS
const BONUS_ATTRIBUTES = {
  st: "st", dx: "dx", iq: "iq", ht: "ht", will: "will", per: "per", perception: "per", hp: "hp", fp: "fp", sm: "sm",
  basic_speed: "speed", basic_move: "move", dodge: "dodge", parry: "parry", block: "block",
  fright_check: "fright", vision: "vision", hearing: "hearing", taste_smell: "tasteSmell", touch: "touch"
};
const ST_LIMITATIONS = { striking_only: "strikingSt", lifting_only: "liftingSt" };
// Локации dr_bonus в GCS → rules.DR_LOCATIONS. Части доспеха Low-Tech (shins, thighs, shoulders) у нас не считаются
const DR_LOCATIONS_GCS = {
  eye: "eyes", eyes: "eyes", skull: "skull", face: "face", neck: "neck", torso: "torso", groin: "groin",
  arm: "arms", arms: "arms", hand: "hands", hands: "hands", leg: "legs", legs: "legs", foot: "feet", feet: "feet",
  head: "head", all: "fullBody", "full body": "fullBody", full_body: "fullBody",
  "full body except eyes": "fullBodyExceptEyes", full_body_except_eyes: "fullBodyExceptEyes"
};

// Способ сравнения GCS ("starts_with", "any") → rules.COMPARE
const COMPARES = { any: "is anything", is_anything: "is anything", is: "is", is_not: "is not", contains: "contains",
  does_not_contain: "does not contain", starts_with: "starts with" };

const AFFECTS = { total: "total", base_only: "base", levels_only: "levels" };
const SKILL_ATTRIBUTES = ["st", "dx", "iq", "ht", "will", "per"];

/** Счётчик того, что импорт не перенёс, как SkipReport сборщика паков. */
class SkipReport {
  #counts = new Map();

  add(reason) {
    this.#counts.set(reason, (this.#counts.get(reason) ?? 0) + 1);
  }

  get entries() {
    return [...this.#counts].map(([reason, count]) => ({ reason, count }));
  }
}

/* -------------------------------------------- */
/*  Перевод файла                               */
/* -------------------------------------------- */

/**
 * Персонаж из файла GCS: поля актёра и предметы. Предметам ещё не подставлены данные библиотек
 * (см. applyLibraryEntry), у каждого есть служебное поле lookup — по какому названию искать.
 * @param {object} gcs  Разобранный JSON файла
 * @returns {{actor: object, items: object[], portrait: string|null, skipped: {reason: string, count: number}[]}}
 */
export function convertGcsCharacter(gcs) {
  if ( !gcs?.version || !gcs.profile ) throw new Error("Not a GCS character file");
  const skipped = new SkipReport();
  const items = [
    ...flatten(gcs.traits).map(trait => convertTrait(trait, skipped)),
    ...flatten(gcs.skills).map(skill => convertSkill(skill, skipped)),
    ...flatten(gcs.spells).map(spell => convertSpell(spell, skipped)),
    ...convertEquipmentList(gcs.equipment, "equipped", skipped),
    ...convertEquipmentList(gcs.other_equipment, "stored", skipped)
  ].filter(Boolean);
  return { actor: convertActor(gcs, skipped), items, portrait: gcs.profile.portrait || null, skipped: skipped.entries };
}

/**
 * Группы («Группа / Недостатки») у нас не переносятся: на листе свои списки по типам. Составная черта
 * (meta_trait) — не группа, а одна черта из нескольких (см. convertMetaTrait).
 */
function flatten(list = []) {
  return list.flatMap(entry => isGroup(entry) ? flatten(entry.children) : [entry]);
}

function isGroup(entry) {
  return !!entry.children && (entry.container_type !== "meta_trait");
}

/**
 * Библиотека из файла GCS. Библиотеки в GCS ведут как персонажа на 0 очков: группы — разделы библиотеки,
 * у снаряжения разделы — «контейнеры» без своей цены, веса и оружия, а строки из чёрточек — разделители.
 * Разделы становятся папками компендиума, «А / Б» в названии раздела — вложенными папками.
 * Глубже FolderTree.MAX_DEPTH Foundry папки не вкладывает: такие разделы склеиваются с родителем («Броня / Военные»).
 * @param {object} gcs  Разобранный JSON файла
 * @param {Record<string, string>} typeFolders  Названия верхних папок по типу предмета: «Черты», «Умения»…
 * @returns {{folders: {_id: string, name: string, folder: string|null, depth: number, sort: number}[],
 *   items: object[], skipped: {reason: string, count: number}[]}}  Предметы — как у convertGcsCharacter, с folder
 */
export function convertGcsLibrary(gcs, typeFolders) {
  if ( !gcs?.version || !gcs.profile ) throw new Error("Not a GCS file");
  const skipped = new SkipReport();
  const tree = new FolderTree();
  const items = [];
  const sections = [
    ["advantage", gcs.traits, trait => [convertTrait(trait, skipped)]],
    ["skill", gcs.skills, skill => [convertSkill(skill, skipped)]],
    ["spell", gcs.spells, spell => [convertSpell(spell, skipped)]],
    // В библиотеке предмет не лежит в контейнере персонажа: содержимое — рядом, в той же папке
    ["equipment", [...gcs.equipment ?? [], ...gcs.other_equipment ?? []],
      entry => convertEquipmentList([entry], "equipped", skipped).map(item => ({ ...item, system: { ...item.system, containerId: "" } }))]
  ];
  for ( const [type, list, convert] of sections ) {
    if ( !list?.length ) continue;
    const root = tree.folder(typeFolders[type], null);
    const visit = (entries, parent) => {
      for ( const entry of entries ) {
        const name = entry.name ?? entry.description ?? "";
        if ( /^\s*-*\s*$/.test(name) ) continue;
        if ( isSection(entry, type) ) visit(entry.children, tree.path(name, parent));
        else items.push(...convert(entry).filter(Boolean).map(item => ({ ...item, folder: parent._id })));
      }
    };
    visit(list, root);
  }
  items.forEach((item, index) => item.sort = index + 1);
  return { folders: tree.withoutEmpty(items), items, skipped: skipped.entries };
}

/** Раздел библиотеки: группа черт, умений, заклинаний или «контейнер» снаряжения без своих данных. */
function isSection(entry, type) {
  if ( !entry.children?.length ) return false;
  if ( type !== "equipment" ) return isGroup(entry);
  const own = parseFloat(entry.base_value) || parseFloat(entry.base_weight) || entry.weapons?.length || entry.features?.length;
  return !own;
}

/** Папки компендиума: одна папка на путь, глубина не больше MAX_DEPTH. */
class FolderTree {
  // В компендиуме папки вкладываются на уровень меньше, чем в боковой панели: CONST.FOLDER_MAX_DEPTH − 1
  // (CompendiumCollection#maxFolderDepth). Папку глубже Foundry не создаёт, и предметы в ней не видны
  static MAX_DEPTH = 3;

  folders = [];

  /** Папка name в parent (null — верхний уровень), уже созданная или новая. */
  folder(name, parent) {
    // Глубже нельзя: раздел склеивается с родителем и встаёт рядом с ним
    if ( parent?.depth === FolderTree.MAX_DEPTH ) {
      return this.folder(`${parent.name} / ${name}`, this.folders.find(f => f._id === parent.folder) ?? null);
    }
    const parentId = parent?._id ?? null;
    const existing = this.folders.find(f => (f.folder === parentId) && (f.name === name));
    if ( existing ) return existing;
    const folder = { _id: randomId(), name, folder: parentId, depth: (parent?.depth ?? 0) + 1, sort: this.folders.length + 1 };
    this.folders.push(folder);
    return folder;
  }

  /**
   * Папки, в которых есть предметы или вложенные папки с ними. Раздел, все подразделы которого склеены
   * с ним на последнем уровне («Снаряжение / Контейнеры» рядом со «Снаряжение»), остаётся пустым.
   */
  withoutEmpty(items) {
    const used = new Set(items.map(item => item.folder));
    for ( const folder of this.folders.toReversed() ) {
      if ( used.has(folder._id) && folder.folder ) used.add(folder.folder);
    }
    return this.folders.filter(folder => used.has(folder._id));
  }

  /** «Всем брать обязательно! / Репутация» — вложенные папки. */
  path(name, parent) {
    return name.split(" / ").map(part => part.trim()).filter(Boolean)
      .reduce((folder, part) => this.folder(part, folder), parent);
  }
}

function convertActor(gcs, skipped) {
  const profile = gcs.profile;
  const system = {
    profile: {
      player: profile.player_name ?? "", title: profile.title ?? "", age: profile.age ?? "",
      birthday: profile.birthday ?? "", eyes: profile.eyes ?? "", hair: profile.hair ?? "", skin: profile.skin ?? "",
      handedness: profile.handedness ?? "", height: profile.height ?? "", weight: profile.weight ?? "",
      gender: profile.gender ?? "", religion: profile.religion ?? ""
    },
    attributes: {},
    sm: Number(profile.SM) || 0,
    points: pointsOf(gcs),
    notes: (gcs.notes ?? []).map(note => paragraphs(note.text ?? note.markdown ?? "")).join("")
  };
  const tl = parseInt(profile.tech_level);
  if ( Number.isFinite(tl) ) system.tl = tl;
  for ( const attribute of gcs.attributes ?? [] ) {
    const id = attribute.attr_id;
    const adj = attribute.adj ?? 0;
    // Основные атрибуты в GCS — отклонение от 10, у нас — купленный уровень
    if ( id in { st: 1, dx: 1, iq: 1, ht: 1 } ) system.attributes[id] = { value: 10 + adj };
    else if ( id in SECONDARY_ATTRIBUTES ) {
      const key = SECONDARY_ATTRIBUTES[id];
      system[key] = { mod: adj };
      // Текущие ЕЖ и ЕУ; без calc.current шкала полная
      if ( (key === "hp") || (key === "fp") ) system[key].value = attribute.calc?.current ?? attribute.calc?.value ?? 10;
    }
    else if ( adj ) skipped.add(`купленный атрибут «${id}»`);
  }
  return { name: profile.name || "", system };
}

/** Стартовые очки — запись «Initial points», которую GCS делает при создании персонажа, остальное — заработано. */
function pointsOf(gcs) {
  const total = gcs.total_points ?? 0;
  const initial = (gcs.points_record ?? []).find(record => /^initial points$/i.test(record.reason ?? ""));
  const start = initial?.points ?? total;
  return { total: start, earned: total - start };
}

/** Текст с переводами строк → абзацы HTML. */
function paragraphs(text) {
  return String(text).split(/\n+/).map(line => line.trim()).filter(Boolean)
    .map(line => `<p>${escapeHtml(line)}</p>`).join("");
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Заглушки «@Language@» заменяются ответами из replacements, как их показывает GCS. */
function replaced(text, replacements = {}) {
  return String(text ?? "").replace(/@([^@]*)@/g, (placeholder, key) => replacements[key] ?? placeholder).trim();
}

/* -------------------------------------------- */
/*  Черты                                       */
/* -------------------------------------------- */

function convertTrait(trait, skipped) {
  if ( trait.disabled ) {
    skipped.add("выключенная черта");
    return null;
  }
  if ( trait.container_type === "meta_trait" ) return convertMetaTrait(trait, skipped);
  if ( trait.cr_adj ) skipped.add(`эффект самоконтроля (cr_adj «${trait.cr_adj}»)`);
  for ( const key of ["weapons", "prereqs"] ) {
    if ( trait[key] ) skipped.add(`черта: ${key}`);
  }
  const replacements = trait.replacements;
  const name = replaced(trait.name, replacements);
  return {
    type: "advantage",
    name,
    lookup: name,
    system: {
      reference: trait.reference ?? "",
      notes: replaced(trait.local_notes ?? trait.notes, replacements),
      basePoints: trait.base_points ?? 0,
      pointsPerLevel: trait.points_per_level ?? 0,
      levels: trait.can_level ? Math.floor(trait.levels ?? 0) : 0,
      cr: trait.cr ?? 0,
      roundDown: !!trait.round_down,
      // GCS считает причудой черту ценой ровно −1
      quirk: trait.calc?.points === -1,
      modifiers: flatten(trait.modifiers).map(modifier => convertTraitModifier(modifier, replacements, skipped)),
      features: convertFeatures(trait.features, replacements, skipped)
    }
  };
}

/**
 * Составная черта GCS (meta_trait: «Подкожная броня» из двух «Сопротивлений вреду» с модификаторами) — одна
 * черта: цена из расчёта GCS, эффекты всех частей с уже умноженным уровнем, состав — в описании.
 * Уровни и модификаторы частей на листе не меняются: для этого черты нужно добавить по отдельности.
 */
function convertMetaTrait(trait, skipped) {
  const parts = flatten(trait.children).map(child => convertTrait(child, skipped)).filter(Boolean);
  const features = parts.flatMap(({ system }) => {
    const enabled = system.modifiers.filter(modifier => modifier.enabled);
    return [system.features, ...enabled.map(modifier => modifier.features)].flat()
      .map(feature => feature.perLevel ? { ...feature, amount: feature.amount * system.levels, perLevel: false } : feature);
  });
  const partText = ({ name, system }) => {
    const levels = system.levels ? ` ${system.levels}` : "";
    const modifiers = system.modifiers.filter(modifier => modifier.enabled).map(modifier => modifier.name);
    return `<li>${escapeHtml(name + levels)}${modifiers.length ? ` (${escapeHtml(modifiers.join("; "))})` : ""}</li>`;
  };
  const name = replaced(trait.name, trait.replacements);
  const cost = trait.calc?.points ?? 0;
  return {
    type: "advantage",
    name,
    lookup: name,
    system: {
      reference: trait.reference ?? "",
      description: `<ul>${parts.map(partText).join("")}</ul>`,
      notes: replaced(trait.local_notes ?? trait.notes, trait.replacements),
      basePoints: cost,
      quirk: cost === -1,
      modifiers: [],
      features
    }
  };
}

/** cost_adj: "-5" — очки, "x0.5" — множитель, "+50%" — проценты; levels — модификатор с уровнями. */
function convertTraitModifier(modifier, replacements, skipped) {
  const cost = String(modifier.cost_adj ?? "0").trim();
  let costType = "points";
  if ( /^[x×]/i.test(cost) ) costType = "multiplier";
  else if ( cost.endsWith("%") ) costType = "percentage";
  return {
    name: replaced(modifier.name, replacements),
    notes: replaced(modifier.local_notes ?? modifier.notes, replacements),
    reference: modifier.reference ?? "",
    enabled: !modifier.disabled,
    costType,
    value: parseFloat(cost.replace(/^[x×+]/i, "")) || 0,
    affects: AFFECTS[modifier.affects] ?? "total",
    levels: Math.max(1, Math.floor(modifier.levels ?? 1)),
    group: "",
    features: convertFeatures(modifier.features, replacements, skipped)
  };
}

/* -------------------------------------------- */
/*  Эффекты                                     */
/* -------------------------------------------- */

/** Эффекты черты, модификатора или снаряжения → features[] (соответствие — в CLAUDE.md, «Эффекты features[]»). */
function convertFeatures(features = [], replacements, skipped) {
  return features.flatMap(feature => {
    const scaled = { amount: Number(feature.amount) || 0, perLevel: !!feature.per_level };
    switch ( feature.type ) {
      case "attribute_bonus": {
        const target = (feature.attribute === "st") ? (ST_LIMITATIONS[feature.limitation] ?? "st")
          : BONUS_ATTRIBUTES[feature.attribute];
        if ( target ) return [{ type: "attribute", target, ...scaled }];
        break;
      }
      case "reaction_bonus":
        return [{ type: "reaction", situation: replaced(feature.situation, replacements), ...scaled }];
      case "skill_bonus": {
        if ( (feature.selection_type ?? "skills_with_name") !== "skills_with_name" ) break;
        const name = criterion(feature.name, "is", replacements);
        const specialization = criterion(feature.specialization, "is anything", replacements);
        if ( !name || !specialization ) break;
        return [{ type: "skill", name: name.text, nameCompare: name.compare,
          specialization: specialization.text, specializationCompare: specialization.compare, ...scaled }];
      }
      case "spell_bonus": {
        if ( feature.match === "all_colleges" ) return [{ type: "spell", college: "", collegeCompare: "is anything", ...scaled }];
        const college = (feature.match === "college_name") && criterion(feature.name, "is", replacements);
        if ( college ) return [{ type: "spell", college: college.text, collegeCompare: college.compare, ...scaled }];
        break;
      }
      case "dr_bonus":
        return drFeatures(feature, scaled, skipped);
      case "cost_reduction":
        if ( !COST_REDUCTION_ATTRIBUTES.includes(feature.attribute) ) break;
        return [{ type: "costReduction", attribute: feature.attribute, amount: Number(feature.percentage) || 0, perLevel: false }];
    }
    skipped.add(`эффект ${feature.type}${feature.selection_type ? ` (${feature.selection_type})` : ""}`);
    return [];
  });
}

/** Условие {compare, qualifier} → текст и способ rules.COMPARE; null, если способа у нас нет. */
function criterion(value, fallback, replacements) {
  if ( !value ) return { text: "", compare: fallback };
  const compare = value.compare ? COMPARES[value.compare] : fallback;
  if ( !COMPARE.includes(compare) ) return null;
  return { text: replaced(value.qualifier, replacements), compare };
}

/** СП на локации (в GCS 5 — список locations, раньше — location); specialization — тип урона. */
function drFeatures(feature, scaled, skipped) {
  const damageType = (feature.specialization && (feature.specialization !== "all")) ? feature.specialization : "";
  const locations = feature.locations ?? [feature.location ?? "torso"];
  return locations.flatMap(location => {
    const key = DR_LOCATIONS_GCS[location];
    if ( DR_LOCATIONS.includes(key) ) return [{ type: "dr", location: key, damageType, ...scaled }];
    skipped.add(`СП на локацию «${location}»`);
    return [];
  });
}

/* -------------------------------------------- */
/*  Умения и заклинания                         */
/* -------------------------------------------- */

/** "dx/a" → атрибут и сложность; у техники (Финт) атрибута нет, только "h". */
function difficultyOf(text) {
  const [attribute, difficulty] = String(text ?? "").split("/");
  const key = difficulty?.toUpperCase();
  if ( !SKILL_ATTRIBUTES.includes(attribute) || !(key in DIFFICULTY) ) return null;
  return { attribute, difficulty: key };
}

function convertSkill(skill, skipped) {
  const difficulty = difficultyOf(skill.difficulty);
  if ( !difficulty ) {
    skipped.add(skill.default ? `техника «${skill.name}»` : `умение «${skill.name}» со сложностью «${skill.difficulty}»`);
    return null;
  }
  if ( skill.prereqs ) skipped.add("требования умения");
  const name = replaced(skill.name, skill.replacements);
  return {
    type: "skill",
    name,
    lookup: name,
    // Специализация из ответа на заглушку: в библиотеке она бывает по-английски (Arrow), берётся оттуда
    specialization: replaced(skill.specialization, skill.replacements),
    system: {
      reference: skill.reference ?? "",
      ...difficulty,
      points: Math.max(0, Math.floor(skill.points ?? 0)),
      techLevel: skill.tech_level ?? ""
    }
  };
}

function convertSpell(spell, skipped) {
  const difficulty = difficultyOf(spell.difficulty);
  if ( !difficulty ) {
    skipped.add(`заклинание «${spell.name}» со сложностью «${spell.difficulty}»`);
    return null;
  }
  return {
    type: "spell",
    name: spell.name,
    lookup: spell.name,
    // Требования в GCS записаны иначе, чем у нас, поэтому берутся только из библиотеки
    system: {
      reference: spell.reference ?? "",
      difficulty: difficulty.difficulty,
      points: Math.max(0, Math.floor(spell.points ?? 0)),
      college: (spell.college ?? []).join("/"),
      spellClass: spell.spell_class ?? "",
      castingCost: spell.casting_cost ?? "",
      maintain: spell.maintenance_cost ?? "",
      castingTime: spell.casting_time ?? "",
      duration: spell.duration ?? "",
      weapons: (spell.weapons ?? []).map(weapon => convertWeapon(weapon, skipped))
    }
  };
}

/* -------------------------------------------- */
/*  Снаряжение                                  */
/* -------------------------------------------- */

/**
 * Снаряжение с вложенностью: содержимое контейнера (children) ссылается на него через containerId,
 * поэтому id предметов задаются заранее.
 */
function convertEquipmentList(list = [], defaultState, skipped, containerId = "") {
  return list.flatMap(entry => {
    const item = convertEquipment(entry, defaultState, skipped, containerId);
    const contents = entry.children ? convertEquipmentList(entry.children, item.system.state, skipped, item._id) : [];
    return [item, ...contents];
  });
}

function convertEquipment(entry, defaultState, skipped, containerId) {
  if ( entry.modifiers?.length ) skipped.add("модификаторы снаряжения");
  const name = replaced(entry.description, entry.replacements);
  // Снятый предмет в GCS — с собой, но не надет; «прочее снаряжение» — не с собой
  const state = (defaultState === "equipped") && (entry.equipped === false) ? "carried" : defaultState;
  return {
    type: "equipment",
    _id: randomId(),
    name,
    lookup: name,
    system: {
      reference: entry.reference ?? "",
      notes: replaced(entry.local_notes ?? entry.notes, entry.replacements),
      quantity: Math.max(0, Math.floor(entry.quantity ?? 1)),
      weight: weightKg(entry.base_weight ?? entry.weight),
      value: parseFloat(entry.base_value ?? entry.value) || 0,
      techLevel: entry.tech_level ?? "",
      legalityClass: entry.legality_class ?? "",
      state,
      isContainer: !!entry.children,
      capacity: capacityOf(entry, skipped),
      containerId,
      weapons: (entry.weapons ?? []).map(weapon => convertWeapon(weapon, skipped)),
      features: convertFeatures(entry.features, entry.replacements, skipped)
    }
  };
}

/** Вместимость контейнера в кг: требование «вес содержимого не больше» (contained_weight_prereq). */
function capacityOf(entry, skipped) {
  let capacity = 0;
  for ( const prereq of entry.prereqs?.prereqs ?? [] ) {
    if ( (prereq.type === "contained_weight_prereq") && (prereq.qualifier?.compare === "at_most") ) {
      capacity = weightKg(prereq.qualifier.qualifier);
    }
    else skipped.add(`требование снаряжения ${prereq.type}`);
  }
  return capacity;
}

/** id предмета Foundry: 16 букв и цифр. */
function randomId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/** "2 lb" → кг (фунт = 0.5 кг, как в GMentor); "1.5 kg", "8 oz", "500 g" — по единице. */
function weightKg(text) {
  const match = String(text ?? "").trim().match(/^([\d.]+)\s*(lb|kg|oz|g)?/);
  if ( !match ) return 0;
  const perUnit = { lb: 0.5, kg: 1, oz: 0.5 / 16, g: 0.001 };
  return Math.round(Number(match[1]) * perUnit[match[2] ?? "lb"] * 10000) / 10000;
}

/**
 * Режим оружия. Ближний и дальний бой GCS различает по id: "w…" — ближний, "W…" — дальний;
 * урон собирается в запись, как в книге: thr+3 imp, 1d(2) pi.
 */
function convertWeapon(weapon, skipped) {
  const ranged = weapon.id?.startsWith("W") ?? ("accuracy" in weapon);
  const common = {
    usage: WEAPON_USAGES[weapon.usage] ?? weapon.usage ?? "",
    damage: damageText(weapon.damage),
    minSt: weapon.strength ?? "",
    defaults: (weapon.defaults ?? []).map(entry => weaponDefault(entry, skipped)).filter(Boolean)
  };
  if ( !ranged ) {
    return { type: "melee", ...common, reach: weapon.reach ?? "", parry: weapon.parry ?? "", block: weapon.block ?? "" };
  }
  return {
    type: "ranged", ...common,
    accuracy: weapon.accuracy ?? "", range: weapon.range ?? "", rateOfFire: weapon.rate_of_fire ?? "",
    shots: weapon.shots ?? "", bulk: weapon.bulk ?? "", recoil: weapon.recoil ?? "", ammo: ""
  };
}

function damageText(damage = {}) {
  let dice = `${damage.st ?? ""}${damage.base ?? ""}`;
  // "sw" + "1d" без знака: прибавка кубиков пишется через плюс (sw+1d)
  if ( damage.st && damage.base && !/^[+-]/.test(damage.base) ) dice = `${damage.st}+${damage.base}`;
  const divisor = damage.armor_divisor && (damage.armor_divisor !== 1) ? `(${damage.armor_divisor})` : "";
  return [`${dice}${divisor}`, damage.type ?? ""].filter(Boolean).join(" ");
}

function weaponDefault(entry, skipped) {
  const modifier = entry.modifier ?? 0;
  if ( entry.type === "skill" ) {
    // В оружии GCS имя умения — строка, в умолчаниях умений — условие {compare, qualifier}
    const text = value => (typeof value === "object" ? value?.qualifier : value) ?? "";
    return { type: "skill", name: text(entry.name), specialization: text(entry.specialization), modifier };
  }
  if ( SKILL_ATTRIBUTES.includes(entry.type) ) return { type: entry.type, name: "", specialization: "", modifier };
  skipped.add(`умолчание оружия «${entry.type}»`);
  return null;
}

/* -------------------------------------------- */
/*  Библиотеки                                  */
/* -------------------------------------------- */

/**
 * Название для сравнения с библиотекой: без регистра, «ё», специализации в скобках и «/ТУ».
 * «Навигация/ТУ (Подземная)» и «Навигация/ТУ (@Где@)» — одно умение.
 */
export function baseName(name) {
  return String(name).toLowerCase().replace(/ё/g, "е").replace(/\s*\([^)]*\)/g, " ")
    .replace(/\/ту\b/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Запись библиотеки для предмета: сначала с точно таким же названием («Быстрое выхватывание (Стрела)»),
 * потом с тем же основным названием — лучше с заглушкой в скобках («Враги (@Кто@)»), то есть общая.
 * @param {{_id: string, name: string}[]} index  Записи библиотеки
 */
export function findLibraryEntry(index, name) {
  const lower = String(name).toLowerCase().replace(/ё/g, "е");
  const exact = index.find(entry => entry.name.toLowerCase().replace(/ё/g, "е") === lower);
  if ( exact ) return exact;
  const base = baseName(name);
  const similar = index.filter(entry => baseName(entry.name) === base);
  return similar.find(entry => entry.name.includes("@")) ?? similar[0] ?? null;
}

/**
 * Данные предмета для создания: файл плюс то, чего в нём нет, из записи библиотеки.
 * @param {object} item  Предмет из convertGcsCharacter
 * @param {object|null} library  Данные записи библиотеки (toObject()) или null
 */
export function applyLibraryEntry(item, library) {
  const { lookup, specialization, ...data } = item;
  const system = { ...data.system };
  const fromLibrary = library?.system;
  if ( fromLibrary ) {
    system.identifier = fromLibrary.identifier;
    // Своё описание есть только у составной черты — её состав
    system.description ||= fromLibrary.description;
  }
  switch ( item.type ) {
    case "advantage":
      if ( fromLibrary?.quirk ) system.quirk = true;
      break;
    case "skill":
      // Совпало точное название — специализация из библиотеки (по-английски, как в бонусах черт)
      system.specialization = (fromLibrary && (library.name === item.name)) ? fromLibrary.specialization : specialization;
      if ( fromLibrary ) Object.assign(system, { defense: fromLibrary.defense, defenseMod: fromLibrary.defenseMod });
      break;
    case "spell":
      // Школа библиотеки — та, с которой сравнивают бонусы черт; требования и атака — тоже оттуда
      if ( fromLibrary ) {
        Object.assign(system, { college: fromLibrary.college, prereqGroups: fromLibrary.prereqGroups });
        if ( !system.weapons.length ) system.weapons = fromLibrary.weapons;
      }
      break;
  }
  return { ...data, system };
}

/* -------------------------------------------- */
/*  Запись в Foundry                            */
/* -------------------------------------------- */

/**
 * Заменяет персонажа содержимым файла GCS: поля, портрет и все предметы. Действующие эффекты не трогает.
 * @param {Actor} actor
 * @param {object} gcs  Разобранный JSON файла
 * @returns {Promise<{reason: string, count: number}[]>}  Что не перенесено
 */
export async function importGcsCharacter(actor, gcs) {
  const { actor: actorData, items, portrait, skipped } = convertGcsCharacter(gcs);
  const { prepared, missing } = await withLibraryData(items);
  prepared.forEach((item, index) => item.sort = (index + 1) * CONST.SORT_INTEGER_DENSITY);

  const img = portrait ? await uploadPortrait(actor, portrait) : null;
  if ( img ) actorData.img = img;
  await actor.deleteEmbeddedDocuments("Item", actor.items.map(item => item.id));
  await actor.update(actorData);
  await actor.createEmbeddedDocuments("Item", prepared, { keepId: true });
  return [...skipped, ...missing];
}

/**
 * Компендиум предметов мира из библиотеки GCS (см. convertGcsLibrary). Компендиум с тем же названием
 * создаётся заново.
 * @param {object} gcs  Разобранный JSON файла
 * @param {string} label  Название компендиума
 * @returns {Promise<{reason: string, count: number}[]>}  Что не перенесено
 */
export async function importGcsLibrary(gcs, label) {
  const typeFolders = Object.fromEntries(["advantage", "skill", "spell", "equipment"]
    .map(type => [type, game.i18n.localize(`GMENTOR.Import.folder.${type}`)]));
  const { folders, items, skipped } = convertGcsLibrary(gcs, typeFolders);
  const { prepared, missing } = await withLibraryData(items);

  const { CompendiumCollection } = foundry.documents.collections;
  await worldPack(label)?.deleteCompendium();
  const pack = await CompendiumCollection.createCompendium({ type: "Item", label });
  // Родитель должен существовать до вложенной папки, поэтому папки создаются по уровням
  for ( let depth = 1; depth <= FolderTree.MAX_DEPTH; depth++ ) {
    const level = folders.filter(folder => folder.depth === depth)
      .map(({ _id, name, folder, sort }) => ({ _id, name, folder, sort, type: "Item", sorting: "m" }));
    if ( level.length ) await Folder.implementation.createDocuments(level, { pack: pack.collection, keepId: true });
  }
  // Тысячи предметов — частями, чтобы не упереться в размер одного запроса
  for ( let start = 0; start < prepared.length; start += 500 ) {
    await Item.implementation.createDocuments(prepared.slice(start, start + 500), { pack: pack.collection });
  }
  return [...skipped, ...missing];
}

/** Компендиум мира с таким названием или undefined. */
export function worldPack(label) {
  return game.packs.find(pack => (pack.metadata.packageType === "world") && (pack.metadata.label === label));
}

/**
 * Подставляет предметам данные системных библиотек (CONFIG.GMENTOR.libraries). Записи загружаются одним
 * запросом на библиотеку: предметов в библиотеке GCS бывают тысячи.
 * @returns {Promise<{prepared: object[], missing: {reason: string, count: number}[]}>}  Готовые данные и
 *   сколько черт, умений и заклинаний в библиотеках не нашлось (у снаряжения это обычное дело)
 */
async function withLibraryData(items) {
  const notFound = new SkipReport();
  const matches = new Map();
  const indexes = new Map();
  for ( const item of items ) {
    const pack = game.packs.get(CONFIG.GMENTOR.libraries[item.type]);
    if ( pack && !indexes.has(pack) ) indexes.set(pack, [...await pack.getIndex()]);
    const entry = pack ? findLibraryEntry(indexes.get(pack), item.lookup) : null;
    if ( entry ) matches.set(item, { pack, id: entry._id });
    else if ( item.type !== "equipment" ) notFound.add(game.i18n.localize(`TYPES.Item.${item.type}`));
  }
  const documents = new Map();
  for ( const pack of new Set([...matches.values()].map(match => match.pack)) ) {
    const ids = [...new Set([...matches.values()].filter(match => match.pack === pack).map(match => match.id))];
    for ( const document of await pack.getDocuments({ _id__in: ids }) ) documents.set(document.uuid, document.toObject());
  }
  const prepared = items.map(item => {
    const match = matches.get(item);
    return applyLibraryEntry(item, match ? documents.get(match.pack.getUuid(match.id)) ?? null : null);
  });
  const missing = notFound.entries.map(({ reason, count }) => ({
    reason: game.i18n.format("GMENTOR.Import.notInLibrary", { type: reason }), count
  }));
  return { prepared, missing };
}

/* -------------------------------------------- */
/*  Окна импорта                                */
/* -------------------------------------------- */

/** Пункт «Импорт из GCS» листа персонажа: файл, подтверждение замены, импорт и отчёт. */
export async function importCharacterFromFile(actor) {
  const file = await readGcsFile();
  if ( !file ) return;
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "GMENTOR.Import.title" },
    content: `<p>${game.i18n.format("GMENTOR.Import.confirm", { file: foundry.utils.escapeHTML(file.name) })}</p>`
  });
  if ( confirmed ) await runImport(() => importGcsCharacter(actor, file.gcs), "GMENTOR.Import.done");
}

/**
 * Кнопка «Импорт библиотеки GCS» на вкладке компендиумов. Название компендиума — имя «персонажа»-библиотеки;
 * если такой компендиум мира уже есть, он заменяется (после подтверждения).
 */
export async function importLibraryFromFile() {
  const file = await readGcsFile();
  if ( !file ) return;
  const label = file.gcs.profile?.name?.trim() || file.name.replace(/\.gcs$/i, "");
  const key = worldPack(label) ? "GMENTOR.Import.libraryReplace" : "GMENTOR.Import.libraryCreate";
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "GMENTOR.Import.libraryTitle" },
    content: `<p>${game.i18n.format(key, { label: foundry.utils.escapeHTML(label) })}</p>`
  });
  if ( !confirmed ) return;
  ui.notifications.info("GMENTOR.Import.libraryWorking", { localize: true });
  await runImport(() => importGcsLibrary(file.gcs, label), "GMENTOR.Import.libraryDone");
}

/**
 * Файл GCS с диска: окно выбора открывается невидимым полем ввода.
 * @returns {Promise<{name: string, gcs: object}|null>}  null — файл не выбран или это не JSON
 */
async function readGcsFile() {
  const file = await new Promise(resolve => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ".gcs" });
    input.addEventListener("change", () => resolve(input.files[0] ?? null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
  if ( !file ) return null;
  try {
    return { name: file.name, gcs: JSON.parse(await file.text()) };
  } catch {
    ui.notifications.error("GMENTOR.Import.notGcs", { localize: true });
    return null;
  }
}

/** Импорт с окном итога: что не перенесено. */
async function runImport(task, doneKey) {
  let skipped;
  try {
    skipped = await task();
  } catch ( error ) {
    console.error(error);
    return ui.notifications.error("GMENTOR.Import.notGcs", { localize: true });
  }
  const escape = foundry.utils.escapeHTML;
  const list = skipped.map(({ reason, count }) => `<li>${count} × ${escape(reason)}</li>`).join("");
  const content = `<p>${game.i18n.localize(doneKey)}</p>`
    + (list ? `<p>${game.i18n.localize("GMENTOR.Import.skipped")}</p><ul>${list}</ul>` : "");
  return foundry.applications.api.DialogV2.prompt({ window: { title: "GMENTOR.Import.title" }, content });
}

/**
 * Портрет (PNG в base64) кладётся файлом в папку мира: в данных персонажа картинка весила бы мегабайт.
 * Без права загрузки файлов портрет пропускается.
 * @returns {Promise<string|null>}  Путь к файлу
 */
async function uploadPortrait(actor, base64) {
  if ( !game.user.can("FILES_UPLOAD") ) return null;
  const FilePicker = foundry.applications.apps.FilePicker.implementation;
  const folder = `worlds/${game.world.id}/portraits`;
  try {
    await FilePicker.createDirectory("data", folder, { notify: false });
  } catch {
    // Папка уже есть
  }
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const file = new File([bytes], `${actor.id}.png`, { type: "image/png" });
  const result = await FilePicker.upload("data", folder, file, {}, { notify: false });
  return result?.path ?? null;
}
