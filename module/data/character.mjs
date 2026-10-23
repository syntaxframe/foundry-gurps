import * as rules from "../rules.mjs";

const { HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;

const integer = (initial = 0, options = {}) =>
  new NumberField({ required: true, nullable: false, integer: true, initial, ...options });

/** Купленные отклонения вторичной характеристики от базы (как HP/FP/Will/Per в GMentor) */
const secondary = () => new SchemaField({ mod: integer(0) });

/** Шкала с текущим значением; max считается в prepareDerivedData. */
const pool = () => new SchemaField({ value: integer(10), mod: integer(0) });

/** Чувства (B358): бросок от Восприятия с бонусами Обострённых чувств и т.п. Ключи совпадают с bonuses. */
export const SENSES = ["vision", "hearing", "tasteSmell", "touch"];

/** Поля анкеты в порядке блока profile GMentor (ТУ и МР хранятся отдельно: они участвуют в расчётах). */
export const PROFILE_FIELDS = ["player", "campaign", "title", "age", "birthday", "eyes", "hair", "skin",
  "handedness", "height", "weight", "gender", "race", "religion", "notes"];

/**
 * Данные персонажа. В базе лежит только то, что вводит игрок (купленные уровни, текущие HP/FP).
 * Всё остальное считается при каждой подготовке данных и в базу не пишется.
 */
export default class CharacterData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const attribute = () => new SchemaField({ value: integer(10, { min: 1 }) });
    return {
      profile: new SchemaField(Object.fromEntries(PROFILE_FIELDS.map(k => [k, new StringField({ required: true })]))),
      attributes: new SchemaField({ st: attribute(), dx: attribute(), iq: attribute(), ht: attribute() }),
      hp: pool(),
      fp: pool(),
      will: secondary(),
      per: secondary(),
      speed: new SchemaField({ mod: new NumberField({ required: true, nullable: false, initial: 0, step: 0.25 }) }),
      move: secondary(),
      sm: integer(0),
      tl: integer(8, { min: 0 }),
      points: new SchemaField({ total: integer(100), earned: integer(0) }),
      notes: new HTMLField()
    };
  }

  /**
   * Бонусы от черт, состояний и снаряжения. Active Effects (ключи вида system.bonuses.st) Foundry применяет
   * между prepareBaseData и prepareDerivedData, эффекты черт и снаряжения — #applyFeatures в начале prepareDerivedData.
   */
  prepareBaseData() {
    this.bonuses = {
      ...Object.fromEntries(rules.BONUS_TARGETS.map(key => [key, 0])),
      // СП на всё тело и общий модификатор реакции
      dr: 0, reaction: 0,
      // От состояний: множитель движения (поза, увечье) и штраф к броскам самоконтроля
      moveMultiplier: 1, selfControl: 0
    };
  }

  prepareDerivedData() {
    const drBonuses = this.#applyFeatures();
    const b = this.bonuses;
    const sm = this.sm + b.sm;
    const sizeReduction = rules.sizeCostReduction(sm);
    const cost = { attributes: 0 };

    // Основные атрибуты; скидка за SM — только у ST
    for ( const [key, attr] of Object.entries(this.attributes) ) {
      attr.total = attr.value + b[key];
      const reduction = this.costReductions[key] + ((key === "st") ? sizeReduction : 0);
      attr.cost = rules.attributeCost(key, attr.value, rules.attributeCostModifier(reduction));
      cost.attributes += attr.cost;
    }
    const { st, dx, iq, ht } = this.attributes;

    // Вторичные характеристики (B15–B17)
    this.hp.max = st.total + this.hp.mod + b.hp;
    this.hp.cost = Math.round(this.hp.mod * 2 * rules.attributeCostModifier(sizeReduction));
    this.fp.max = ht.total + this.fp.mod + b.fp;
    this.fp.cost = this.fp.mod * 3;
    this.will.value = iq.total + this.will.mod + b.will;
    this.will.cost = this.will.mod * 5;
    this.will.fright = this.will.value + b.fright;
    this.per.value = iq.total + this.per.mod + b.per;
    this.per.cost = this.per.mod * 5;
    this.senses = Object.fromEntries(SENSES.map(key => [key, this.per.value + b[key]]));
    this.speed.value = (ht.total + dx.total) / 4 + this.speed.mod + b.speed;
    this.speed.cost = this.speed.mod * 20;
    this.move.value = Math.floor(this.speed.value) + this.move.mod + b.move;
    this.move.cost = this.move.mod * 5;
    for ( const key of ["hp", "fp", "will", "per", "speed", "move"] ) cost.attributes += this[key].cost;

    // Выход за рекомендованные пределы покупки (B16–B17): GMentor подсвечивает такие значения
    this.hp.warning = Math.abs(this.hp.mod) > 0.3 * st.total;
    this.fp.warning = Math.abs(this.fp.mod) > 0.3 * ht.total;
    this.will.warning = (this.will.value > 20) || (this.will.value < 4);
    this.per.warning = (this.per.value > 20) || (this.per.value < 4);
    this.speed.warning = Math.abs(this.speed.mod) > 2;
    this.move.warning = Math.abs(this.move.mod) > 3;
    this.#preparePools();

    // Урон и подъём
    const strikingSt = st.total + b.strikingSt;
    const thr = rules.thrust(strikingSt);
    // Удар кулаком thr−1, пинок thr (B271)
    this.damage = { thr, sw: rules.swing(strikingSt), punch: rules.addDamage(thr, -1), kick: thr };
    // СП по локациям: естественная, бонус на всё тело из эффектов, броня и черты
    this.locations = rules.locationArmor(drBonuses, b.dr);
    this.lift = rules.basicLift(st.total + b.liftingSt) / 2; // в кг: в русском издании 1 фунт = 0.5 кг

    this.#prepareItems(cost);
    this.#prepareEncumbrance();
    this.#prepareContainers();
    this.#prepareWealth();
    this.#prepareDefenses();
    this.#preparePoints(cost);
  }

  /** Черты и снаряжение, чьи эффекты действуют на персонажа (у снаряжения — только надетого). */
  get #featureSources() {
    return [...this.parent.itemTypes.advantage, ...this.parent.itemTypes.equipment];
  }

  /**
   * Эффекты черт и снаряжения на характеристики и реакцию. Предметы к этому моменту уже подготовлены, поэтому
   * activeFeatures посчитаны. Бонусы к умениям и заклинаниям применяются в #prepareItems.
   * @returns {object[]}  Эффекты СП: локации считаются позже, вместе с остальными производными
   */
  #applyFeatures() {
    // Все модификаторы реакции с источником, как reaction-text в GMentor; условные в итог не входят
    this.reactions = [];
    this.wealthMultiplier = 1;
    // Скидки на цену атрибутов в процентах (cost_reduction)
    this.costReductions = Object.fromEntries(rules.COST_REDUCTION_ATTRIBUTES.map(key => [key, 0]));
    const drBonuses = [];
    for ( const item of this.#featureSources ) {
      for ( const feature of item.system.activeFeatures ) {
        if ( feature.type === "attribute" ) this.bonuses[feature.target] += feature.value;
        else if ( feature.type === "dr" ) drBonuses.push(feature);
        else if ( feature.type === "wealth" ) this.wealthMultiplier *= feature.value;
        else if ( feature.type === "costReduction" ) this.costReductions[feature.attribute] += feature.value;
        else if ( feature.type === "reaction" ) {
          if ( !feature.situation ) this.bonuses.reaction += feature.value;
          this.reactions.push({ source: item.name, value: feature.value, situation: feature.situation });
        }
      }
    }
    return drBonuses;
  }

  /**
   * Бонусы черт и снаряжения к умению или заклинанию (skill_bonus, spell_bonus в GMentor) с источником: лист
   * показывает, откуда взялся бонус, а в строке черты или предмета — каким умениям он его дал.
   * @returns {{traitId: string, source: string, value: number}[]}
   */
  #traitBonuses(item) {
    const lower = text => text.trim().toLowerCase();
    const s = item.system;
    const matches = feature => {
      if ( item.type === "spell" ) return rules.compareText(lower(s.college), lower(feature.college), feature.collegeCompare);
      // Умение без идентификатора бонусов не получает: иначе пустое имя в эффекте совпало бы с любым из них
      const identifier = rules.toIdentifier(s.identifier);
      return !!identifier && rules.compareText(identifier, rules.toIdentifier(feature.name), feature.nameCompare)
        && rules.compareText(lower(s.specialization), lower(feature.specialization), feature.specializationCompare);
    };
    const bonuses = [];
    for ( const source of this.#featureSources ) {
      for ( const feature of source.system.activeFeatures ) {
        if ( (feature.type !== item.type) || !feature.value || !matches(feature) ) continue;
        bonuses.push({ traitId: source.id, source: source.name, value: feature.value });
      }
    }
    return bonuses;
  }

  /**
   * Потерянные ЕЖ/ЕУ и пороги последствий (B419, B426). Порог достигнут, если потеряно не меньше value.
   * Первый порог — осталось меньше трети, то же условие, что в #prepareDefenses.
   */
  #preparePools() {
    const setThresholds = (pool, steps) => {
      pool.lost = pool.max - pool.value;
      pool.thresholds = steps.map(([value, key]) => ({ value, key, reached: pool.lost >= value }));
    };
    const lessThanThird = max => Math.floor(2 * max / 3) + 1;
    const hp = this.hp.max;
    const fp = this.fp.max;
    setThresholds(this.hp, [[lessThanThird(hp), "reeling"], [hp, "collapse"], [2 * hp, "death1"],
      [3 * hp, "death2"], [4 * hp, "death3"], [5 * hp, "death4"], [6 * hp, "dead"]]);
    setThresholds(this.fp, [[lessThanThird(fp), "tired"], [fp, "collapse"], [2 * fp, "unconscious"]]);
  }

  /** Уровни умений и заклинаний зависят от атрибутов, поэтому считаются здесь, а не в самом предмете. */
  #prepareItems(cost) {
    cost.advantages = 0;
    cost.disadvantages = 0;
    cost.quirks = 0;
    cost.skills = 0;
    cost.spells = 0;
    for ( const item of this.parent.items ) {
      const s = item.system;
      switch ( item.type ) {
        case "advantage":
          // Бросок самоконтроля с учётом состояний (опьянение, боль), как cr-result в GMentor
          s.crTarget = s.cr ? s.cr + this.bonuses.selfControl : null;
          if ( s.quirk ) cost.quirks += s.cost;
          else if ( s.cost < 0 ) cost.disadvantages += s.cost;
          else cost.advantages += s.cost;
          break;
        case "skill":
        case "spell": {
          const base = this.getAttributeValue(item.type === "spell" ? "iq" : s.attribute);
          const result = rules.skillLevel(base, s.difficulty, s.points);
          s.traitBonuses = this.#traitBonuses(item);
          s.traitBonus = s.traitBonuses.reduce((sum, bonus) => sum + bonus.value, 0);
          s.level = result ? result.level + s.bonus + s.traitBonus : null;
          s.relative = result?.relative ?? null;
          cost[`${item.type}s`] += s.points;
          break;
        }
      }
    }
    // Требования, оружие и транспорт считаются от умений и заклинаний, поэтому после цикла выше.
    // У заклинания не выполнена группа, если не выполнено ни одно требование в ней
    for ( const item of this.parent.itemTypes.spell ) {
      // Лист показывает все требования, выполненные — бледно, как prereq-ok в GMentor
      item.system.prereqStatus = item.system.prereqGroups.map(group => {
        const anyOf = group.anyOf.map(prereq => ({ prereq, met: this.#isPrereqMet(prereq, item) }));
        return { anyOf, met: anyOf.some(entry => entry.met) };
      });
      item.system.unmetPrereqs = item.system.prereqGroups
        .filter((group, index) => !item.system.prereqStatus[index].met);
      // Атака заклинанием: уровень попадания (Врождённая атака, ЛВ−4) и урон; модификаторов оружия у неё нет
      for ( const mode of item.system.weapons ) this.#prepareWeaponMode(mode, []);
    }
    for ( const item of this.parent.itemTypes.equipment ) {
      item.system.unmetPrereqs = item.system.prereqs.filter(prereq => !this.#isPrereqMet(prereq, item));
      const modifiers = this.#applyEquipmentModifiers(item);
      for ( const mode of item.system.weapons ) this.#prepareWeaponMode(mode, modifiers);
      if ( item.system.vehicle ) this.#prepareVehicle(item.system.vehicle);
    }
  }

  /**
   * Модификаторы, лежащие прямо в предмете (equipment_modifier в GMentor): цена и вес меняются, пока модификатор
   * с собой, боевые изменения и пометка у оружия — только у надетого, как в charCalcWeapons.
   * Боеприпас заряжен один — первый надетый: его количество показывается как оставшиеся выстрелы, а остальные
   * лежат про запас и на оружие не действуют (в GMentor действуют все). Цену и вес боеприпас меняет себе
   * (EquipmentData#prepareDerivedData), а не оружию: серебряные пули дороже, а не автомат.
   * @returns {object[]}  Боевые изменения для rules.modifyWeapon
   */
  #applyEquipmentModifiers(item) {
    const s = item.system;
    const combat = [];
    for ( const modifier of this.parent.itemTypes.equipment ) {
      const m = modifier.system;
      if ( !m.isModifier || (m.containerId !== item.id) || (m.state === "stored") ) continue;
      const equipped = m.state === "equipped";
      if ( m.ammunition && equipped ) s.loadedAmmo ??= modifier;
      const active = equipped && (!m.ammunition || (s.loadedAmmo === modifier));
      for ( const change of m.weaponModifiers ) {
        if ( change.type === "cost" ) {
          if ( !m.ammunition ) s.valueFactor *= change.multiplier;
        }
        else if ( change.type === "weight" ) {
          if ( !m.ammunition ) s.weightFactor *= change.multiplier;
        }
        else if ( active ) combat.push(change);
      }
      if ( active && m.label ) s.modifierLabels.push(m.label);
    }
    return combat;
  }

  /**
   * Выполнено ли требование предмета, как checkPrerequisits в GMentor. Умения и заклинания должны быть изучены
   * (уровень посчитан), сам предмет требованием себе не служит. Названия сравниваются по идентификатору,
   * как в бонусах черт, остальное — без учёта регистра. В отличие от GMentor, школа сравнивается с каждой частью
   * составной («Air/Weather» — и Воздух, и Погода), а collegeCount считает разные школы, а не заклинания (M8).
   */
  #isPrereqMet(prereq, item) {
    const lower = text => text.trim().toLowerCase();
    const nameMatches = other => rules.compareText(rules.toIdentifier(other.system.identifier),
      rules.toIdentifier(prereq.name), prereq.nameCompare);
    const learned = type => this.parent.itemTypes[type].filter(other => (other !== item) && (other.system.level !== null));
    const colleges = spell => spell.system.college.split("/").map(lower);
    let found;
    switch ( prereq.type ) {
      case "skill":
        found = learned("skill").some(skill => nameMatches(skill)
          && rules.compareText(lower(skill.system.specialization), lower(prereq.specialization), prereq.specializationCompare)
          && (skill.system.level >= prereq.level));
        break;
      case "spell": {
        const spells = learned("spell").filter(spell => nameMatches(spell)
          && colleges(spell).some(college => rules.compareText(college, lower(prereq.college), prereq.collegeCompare)));
        found = prereq.collegeCount
          ? new Set(spells.flatMap(colleges)).size >= prereq.collegeCount
          : spells.length >= prereq.quantity;
        break;
      }
      case "advantage":
        found = this.parent.itemTypes.advantage.some(advantage => (advantage !== item) && nameMatches(advantage)
          && rules.compareText(lower(advantage.system.notes), lower(prereq.notes), prereq.notesCompare)
          && (advantage.system.levels >= prereq.level));
        break;
      case "attribute": {
        const combined = prereq.combinedWith ? this.getAttributeValue(prereq.combinedWith) : 0;
        found = this.getAttributeValue(prereq.which) + combined >= prereq.value;
        break;
      }
    }
    return found === prereq.has;
  }

  /** Уровень и итоги режима оружия с модификаторами снаряжения, как charCalcWeapons в GMentor. */
  #prepareWeaponMode(mode, modifiers) {
    const st = this.attributes.st.total;
    const best = this.#bestDefault(mode.defaults);
    const modified = rules.modifyWeapon(mode, modifiers, this.damage);
    mode.level = best ? best.level + modified.skill : null;
    mode.levelSource = best?.source ?? null;
    mode.damageText = rules.resolveDamage(modified.damage, this.damage);
    // "Special", "HT-4 aff" бросить нельзя; у составного урона — хотя бы одну часть ("thr-1 cr + Paralysis")
    mode.rollable = rules.damageParts(mode.damageText).some(part => rules.parseDamage(part, this.damage));
    mode.weak = rules.lacksStrength(mode.minSt, st);
    if ( mode.type === "ranged" ) {
      mode.accuracyText = modified.accuracy;
      mode.rangeText = rules.resolveRange(modified.range, st);
      return;
    }
    // Защитные бонусы (щит, Боевые рефлексы) добавляются так же, как к защитам от умений
    for ( const defense of ["parry", "block"] ) {
      const result = rules.weaponDefense(mode[defense], mode.level);
      mode[`${defense}Result`] = result && { ...result, value: result.value + this.bonuses[defense] };
    }
  }

  /**
   * Уровень управления транспортом, как charCalcWeapons в GMentor: лучшее из умолчаний (Вождение, Верховая езда)
   * плюс управляемость ("+1", "-2/-3" — берётся первое число), B462.
   */
  #prepareVehicle(vehicle) {
    const best = this.#bestDefault(vehicle.defaults);
    const handling = parseInt(vehicle.handling) || 0;
    vehicle.level = best ? best.level + handling : null;
    vehicle.levelSource = best?.source ?? null;
  }

  /**
   * Лучший уровень из умолчаний оружия, как getBestDefault в GMentor: умение персонажа или атрибут
   * (не выше 20) плюс модификатор. Отрицательный уровень GMentor не показывает.
   * @returns {{level: number, source: {skill: Item|null, attribute: string|null, modifier: number}}|null}
   */
  #bestDefault(defaults) {
    let best = null;
    for ( const entry of defaults ) {
      const skill = (entry.type === "skill") ? this.#defaultSkill(entry) : null;
      if ( (entry.type === "skill") && !skill ) continue;
      const base = skill ? skill.system.level : Math.min(this.getAttributeValue(entry.type), 20);
      const level = base + entry.modifier;
      if ( best && (level <= best.level) ) continue;
      best = { level, source: { skill, attribute: skill ? null : entry.type, modifier: entry.modifier } };
    }
    return (best?.level >= 0) ? best : null;
  }

  /**
   * Изученное умение для умолчания оружия. Название из библиотеки английское и сравнивается с identifier,
   * введённое вручную — с русским названием. Специализацию проверяем, только если она указана.
   */
  #defaultSkill({ name, specialization }) {
    const lower = text => text.trim().toLowerCase();
    const identifier = rules.toIdentifier(name);
    const matches = skill => ((!!identifier && (rules.toIdentifier(skill.system.identifier) === identifier))
      || (lower(skill.name) === lower(name)))
      && (!specialization || (lower(skill.system.specialization) === lower(specialization)));
    const known = this.parent.itemTypes.skill.filter(skill => (skill.system.level !== null) && matches(skill));
    return known.sort((a, b) => b.system.level - a.system.level)[0] ?? null;
  }

  #prepareEncumbrance() {
    let weight = 0;
    let storedWeight = 0;
    for ( const item of this.parent.itemTypes.equipment ) {
      const itemWeight = item.system.effectiveWeight * item.system.quantity;
      if ( item.system.state === "stored" ) storedWeight += itemWeight;
      else weight += itemWeight;
    }
    const level = rules.encumbranceLevel(weight, this.lift);
    this.encumbrance = {
      weight: Math.round(weight * 100) / 100,
      // «Не с собой» в нагрузку не входит, но показывается отдельно, как в GMentor
      storedWeight: Math.round(storedWeight * 100) / 100,
      level,
      thresholds: rules.ENCUMBRANCE_MULTIPLIERS.map((m, i) => ({ level: i, weight: this.lift * m, active: i === level }))
    };
  }

  /**
   * Вес и цена содержимого контейнеров, как gc-container-weight в GMentor, и превышение вместимости.
   * В нагрузку содержимое уже вошло в #prepareEncumbrance: у каждого предмета своё состояние.
   */
  #prepareContainers() {
    const round = value => Math.round(value * 100) / 100;
    for ( const item of this.parent.itemTypes.equipment ) {
      const s = item.system;
      if ( !s.isContainer ) continue;
      const contents = s.descendants.map(i => i.system);
      const weight = round(contents.reduce((sum, c) => sum + (c.effectiveWeight * c.quantity), 0));
      const value = round(contents.reduce((sum, c) => sum + (c.effectiveValue * c.quantity), 0));
      s.contents = { count: contents.length, weight, value, overCapacity: (s.capacity > 0) && (weight > s.capacity) };
    }
  }

  /**
   * Цена всего снаряжения и стартовые деньги (B25–B27), как calcEquipmentWeightAndValue в GMentor.
   * На снаряжение можно потратить 20% стартовых денег (B26); у бедных и нищих эту долю GMentor не показывает.
   */
  #prepareWealth() {
    const value = this.parent.itemTypes.equipment.reduce((sum, item) => sum + (item.system.effectiveValue * item.system.quantity), 0);
    const starting = rules.startingWealth(this.tl, this.wealthMultiplier);
    this.wealth = {
      multiplier: this.wealthMultiplier,
      starting,
      forEquipment: (this.wealthMultiplier > 0.2) ? starting * 0.2 : null,
      equipmentValue: Math.round(value * 100) / 100
    };
  }

  #prepareDefenses() {
    const level = Math.min(this.encumbrance.level, 4);
    // Меньше трети ЕЖ (B419) и меньше трети ЕУ (B426) делят ход и уклонение пополам, каждое отдельно
    const reeling = this.hp.value < this.hp.max / 3;
    const tired = this.fp.value < this.fp.max / 3;
    const factor = (reeling ? 0.5 : 1) * (tired ? 0.5 : 1);
    const overloaded = this.encumbrance.level > 4;

    // Порядок и округление как moveModifiedByAll в GMentor: нагрузка вниз, затем раны, усталость, поза
    const move = Math.floor(this.move.value * (1 - 0.2 * level)) * factor * this.bonuses.moveMultiplier;
    this.move.current = overloaded ? 0 : Math.max(1, Math.round(move + 0.0001));
    this.dodge = Math.max(1, Math.ceil((Math.floor(this.speed.value) + 3 + this.bonuses.dodge - level) * factor));
    this.exhausted = factor < 1 ? { factor, label: factor === 0.25 ? "¼" : "½" } : null;

    // Парирование и блок от умений (B375–B376)
    this.defenses = [];
    for ( const item of this.parent.itemTypes.skill ) {
      const { defense, defenseMod, level: skill } = item.system;
      if ( (defense === "none") || (skill === null) ) continue;
      this.defenses.push({
        item, type: defense,
        value: Math.floor(skill / 2) + 3 + defenseMod + this.bonuses[defense]
      });
    }
  }

  #preparePoints(cost) {
    const spent = Object.values(cost).reduce((sum, value) => sum + value, 0);
    const total = this.points.total + this.points.earned;
    Object.assign(this.points, { ...cost, spent, available: total - spent });
  }

  /** Значение атрибута для броска или умения: st, dx, iq, ht, will, per. */
  getAttributeValue(key) {
    if ( key in this.attributes ) return this.attributes[key].total;
    return this[key]?.value ?? 10;
  }

  /** Короткие имена для формул: инициатива "@speed + @dx / 100", @st и т.п. Вызывается из GMentorActor. */
  getRollData() {
    const data = { ...this };
    for ( const key of ["st", "dx", "iq", "ht", "will", "per"] ) data[key] = this.getAttributeValue(key);
    data.speed = this.speed.value;
    data.move = this.move.value;
    return data;
  }
}
