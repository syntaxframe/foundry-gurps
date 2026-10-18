import * as rules from "../rules.mjs";

const { ArrayField, BooleanField, HTMLField, NumberField, SchemaField, StringField, TypedSchemaField } = foundry.data.fields;

const integer = (initial = 0, options = {}) =>
  new NumberField({ required: true, nullable: false, integer: true, initial, ...options });
const number = (initial = 0, options = {}) =>
  new NumberField({ required: true, nullable: false, initial, ...options });
const choice = (choices, initial) => new StringField({ required: true, blank: false, choices, initial });
// required: true даёт пустую строку по умолчанию; без него поле может быть undefined
const text = () => new StringField({ required: true });

/** Общая часть всех предметов: описание, ссылка на страницу книги ("B14") и английский идентификатор. */
class BaseItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      // "fast-draw", "combat-reflexes": по нему черты находят умения и заклинания (см. rules.toIdentifier)
      identifier: text(),
      reference: text(),
      description: new HTMLField()
    };
  }
}

/** Величина эффекта черты; perLevel — умножается на уровень черты (per_level в GMentor). */
const scaled = () => ({ amount: number(1), perLevel: new BooleanField() });

/**
 * Эффекты черты или снаряжения: что они дают персонажу (attribute_bonus, skill_bonus и т.п. в библиотеке GMentor).
 * Применяет их CharacterData. Поле создаётся функцией: один экземпляр поля нельзя вставить в схему дважды.
 */
const features = () => new ArrayField(new TypedSchemaField({
  // СП на локацию или группу локаций; с типом урона ("pi", "cr") — только против него (dr_bonus)
  dr: { location: choice(rules.DR_LOCATIONS, "torso"), damageType: text(), ...scaled() },
  attribute: { target: choice(rules.BONUS_TARGETS, "st"), ...scaled() },
  // Пустое условие — общий модификатор реакции, иначе только в указанной ситуации («единоверцы»)
  reaction: { situation: text(), ...scaled() },
  // name — идентификатор умения, specialization сравнивается без учёта регистра
  skill: {
    name: text(),
    nameCompare: choice(rules.COMPARE, "is"),
    specialization: text(),
    specializationCompare: choice(rules.COMPARE, "is anything"),
    ...scaled()
  },
  spell: { college: text(), collegeCompare: choice(rules.COMPARE, "is anything"), ...scaled() },
  // Множитель стартовых денег (wealth_modifier: «Богатый» ×5); perLevel — в степени уровня («Мультимиллионер»)
  wealth: { ...scaled() }
}));

/** Преимущество, недостаток, причуда или перк. Цена считается так же, как в GMentor (advantages.js). */
export class AdvantageData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      // Короткая пометка для строки на листе
      notes: text(),
      basePoints: integer(0),
      pointsPerLevel: integer(0),
      levels: integer(0, { min: 0 }),
      cr: integer(0),
      roundDown: new BooleanField(),
      quirk: new BooleanField(),
      modifiers: new ArrayField(new SchemaField({
        name: text(),
        notes: text(),
        reference: text(),
        enabled: new BooleanField({ initial: true }),
        // Как value меняет цену, см. rules.traitCost
        costType: choice(["percentage", "points", "multiplier"], "percentage"),
        value: number(0),
        affects: choice(["total", "base", "levels"], "total"),
        levels: integer(1, { min: 1 }),
        // Модификаторы одной группы взаимоисключающие, как radiogroup в GMentor (варианты Внешности, Богатства)
        group: text(),
        features: features()
      })),
      features: features()
    };
  }

  prepareDerivedData() {
    this.cost = rules.traitCost(this);
    this.activeFeatures = this.#activeFeatures();
  }

  /**
   * Эффекты черты и её включённых модификаторов с итоговой величиной value. За уровень обычный эффект
   * умножается на уровень, а множитель богатства возводится в степень, как в GMentor: 10 за уровень → 10^ур.
   */
  #activeFeatures() {
    const enabledModifiers = this.modifiers.filter(m => m.enabled);
    return [this.features, ...enabledModifiers.map(m => m.features)].flat().map(feature => {
      if ( !feature.perLevel ) return { ...feature, value: feature.amount };
      const value = (feature.type === "wealth") ? feature.amount ** this.levels : feature.amount * this.levels;
      return { ...feature, value };
    });
  }

  /** @inheritDoc */
  async _preUpdate(changes, options, user) {
    const modifiers = changes.system?.modifiers;
    if ( Array.isArray(modifiers) ) this.#disableGroupmates(modifiers);
    return super._preUpdate(changes, options, user);
  }

  /** Включённый модификатор выключает остальные модификаторы своей группы. */
  #disableGroupmates(modifiers) {
    const before = this._source.modifiers;
    const switchedOn = modifiers.filter((m, i) => m.enabled && m.group && !before[i]?.enabled);
    for ( const on of switchedOn ) {
      for ( const other of modifiers ) {
        if ( (other !== on) && (other.group === on.group) ) other.enabled = false;
      }
    }
  }
}

/** Общие поля умения и заклинания. Уровень считает персонаж (см. CharacterData#prepareItems). */
class LearnedData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      difficulty: choice(Object.keys(rules.DIFFICULTY), "A"),
      points: integer(1, { min: 0 }),
      bonus: integer(0)
    };
  }

  prepareBaseData() {
    // Без персонажа (предмет в боковой панели) уровень посчитать нельзя
    this.level = null;
    this.relative = null;
    this.traitBonuses = [];
    this.traitBonus = 0;
  }
}

export class SkillData extends LearnedData {
  static ATTRIBUTES = ["st", "dx", "iq", "ht", "will", "per"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      attribute: choice(SkillData.ATTRIBUTES, "dx"),
      specialization: text(),
      techLevel: text(),
      defense: choice(["none", "parry", "block"], "none"),
      defenseMod: integer(0)
    };
  }
}

export class SpellData extends LearnedData {
  static defineSchema() {
    const schema = super.defineSchema();
    // Заклинания бывают только трудными или очень трудными (B235)
    schema.difficulty = choice(["H", "VH"], "H");
    return {
      ...schema,
      college: text(),
      spellClass: text(),
      castingCost: text(),
      maintain: text(),
      castingTime: text(),
      duration: text()
    };
  }
}

/** От чего считается уровень оружия (default в GMentor): умение или атрибут с модификатором. */
export const WEAPON_DEFAULT_TYPES = ["skill", ...SkillData.ATTRIBUTES];

/** От чего считается уровень оружия или управления транспортом: лучший из вариантов (default в GMentor). */
const skillDefaults = () => new ArrayField(new SchemaField({
  type: choice(WEAPON_DEFAULT_TYPES, "skill"),
  // Название умения: английское из библиотеки (сравнивается с identifier) или русское
  name: text(),
  specialization: text(),
  modifier: integer(0)
}));

/**
 * Режим оружия: у топора — замах и укол, у копья — ближний бой и бросок. Значения — текст, как в книге
 * ("0U", "x1/x1.5", "10B"), их разбирают функции rules. Уровень и итоги считает персонаж.
 */
const weaponMode = fields => ({
  usage: text(),
  damage: text(),
  minSt: text(),
  ...fields,
  defaults: skillDefaults()
});

/** Поля транспорта (B462–B465) в порядке таблицы; текст, как в книге: "27†", "4/9*", "2DE2W". */
export const VEHICLE_FIELDS = ["strengthHealth", "handling", "stability", "health", "move", "loadedWeight", "load",
  "sizeModifier", "occupants", "dr", "range", "locations", "stall", "draft"];

/**
 * Изменения, которые модификатор снаряжения вносит в оружие, где лежит (equipment_modifier в GMentor).
 * Боевые применяет rules.modifyWeapon, цену и вес — CharacterData#prepareItems.
 */
const weaponModifiers = () => new ArrayField(new TypedSchemaField({
  // Урон +N; perDice — за каждый кубик (глушитель −1 за кубик)
  damage: { amount: number(0), perDice: new BooleanField() },
  armorDivisor: { value: number(2, { min: 0 }) },
  // Новый тип урона ("pi") или сдвиг проникающего: "++", "--"
  damageType: { value: text() },
  accuracy: { amount: number(0) },
  // Прицел: бонус пишется к точности через «+» (B278)
  scope: { amount: number(0) },
  range: { multiplier: number(1, { min: 0 }) },
  skill: { amount: number(0) },
  cost: { multiplier: number(1, { min: 0 }) },
  weight: { multiplier: number(1, { min: 0 }) }
}));

/**
 * Требования предмета (prereq_list в GMentor): все должны выполняться, иначе предмет подсвечивается.
 * Сейчас только умение (скафандр требует умения «Скафандр»); has: false — умения быть не должно.
 * Проверяет CharacterData#checkPrerequisites.
 */
const prerequisites = () => new ArrayField(new TypedSchemaField({
  skill: {
    has: new BooleanField({ initial: true }),
    name: text(),
    nameCompare: choice(rules.COMPARE, "is"),
    specialization: text(),
    specializationCompare: choice(rules.COMPARE, "is anything")
  }
}));

export class EquipmentData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      notes: text(),
      quantity: integer(1, { min: 0 }),
      weight: number(0, { min: 0 }),
      value: number(0, { min: 0 }),
      techLevel: text(),
      legalityClass: text(),
      // Как в GMentor, новый предмет надет: эффекты (броня, щит) действуют только у надетого
      state: choice(["equipped", "carried", "stored"], "equipped"),
      // Контейнер (рюкзак, ножны): в него кладут другие предметы. Вместимость в кг, 0 — без ограничения
      isContainer: new BooleanField(),
      capacity: number(0, { min: 0 }),
      // id контейнера на том же персонаже, в котором лежит предмет; пусто — верхний уровень
      containerId: text(),
      // Модификатор оружия (качество, прицел, особые стрелы): кладётся внутрь оружия и меняет его.
      // label — пометка у оружия («Отл. качество»)
      isModifier: new BooleanField(),
      label: text(),
      weaponModifiers: weaponModifiers(),
      // Боеприпас (ammunition в GMentor): количество надетого боеприпаса в оружии — оставшиеся выстрелы
      ammunition: new BooleanField(),
      prereqs: prerequisites(),
      // Транспорт или ездовое животное (transport в GMentor); null — не транспорт
      vehicle: new SchemaField({
        ...Object.fromEntries(VEHICLE_FIELDS.map(key => [key, text()])),
        defaults: skillDefaults()
      }, { required: true, nullable: true, initial: null }),
      weapons: new ArrayField(new TypedSchemaField({
        melee: weaponMode({ reach: text(), parry: text(), block: text() }),
        ranged: weaponMode({
          accuracy: text(), range: text(), rateOfFire: text(), shots: text(), bulk: text(), recoil: text(),
          // Калибр или тип боеприпаса: "5.56mm", "12G"
          ammo: text()
        })
      })),
      features: features()
    };
  }

  /** Раньше оружие описывалось полями самого предмета, теперь это первый режим. */
  static migrateData(source) {
    if ( source.damage?.trim() && !source.weapons ) {
      const defaults = source.skill?.trim() ? [{ type: "skill", name: source.skill, specialization: "", modifier: 0 }] : [];
      source.weapons = [{ type: "melee", damage: source.damage, reach: source.reach ?? "", minSt: source.minSt ?? "", defaults }];
    }
    return super.migrateData(source);
  }

  prepareBaseData() {
    // Вес и цену содержимого считает персонаж (CharacterData#prepareContainers), как и множители
    // от модификаторов, лежащих в предмете (пластиковое оружие легче, отличное качество дороже)
    this.contents = null;
    this.weightFactor = 1;
    this.valueFactor = 1;
    this.modifierLabels = [];
    // Заряженный боеприпас (предмет в оружии) и невыполненные требования
    this.loadedAmmo = null;
    this.unmetPrereqs = [];
  }

  /** Вес одной штуки с учётом модификаторов. Округление убирает погрешность дробей (0.1 × 3). */
  get effectiveWeight() {
    return Math.round(this.weight * this.weightFactor * 10000) / 10000;
  }

  /** Цена одной штуки с учётом модификаторов. */
  get effectiveValue() {
    return Math.round(this.value * this.valueFactor * 100) / 100;
  }

  prepareDerivedData() {
    // Эффект без уровней — сама величина. Снаряжение действует, только пока надето (globalModifiersOn в GMentor)
    const equipped = this.state === "equipped";
    this.activeFeatures = equipped ? this.features.map(feature => ({ ...feature, value: feature.amount })) : [];
    // Цена и вес особых боеприпасов (серебряные пули) меняют сам боеприпас, где бы он ни лежал
    if ( this.ammunition ) {
      for ( const change of this.weaponModifiers ) {
        if ( change.type === "cost" ) this.valueFactor *= change.multiplier;
        else if ( change.type === "weight" ) this.weightFactor *= change.multiplier;
      }
    }
  }

  /** Предметы персонажа, лежащие в этом контейнере или оружии (модификаторы), на всех уровнях вложенности. */
  get descendants() {
    const actor = this.parent.actor;
    if ( !actor ) return [];
    const result = [];
    const visit = id => {
      for ( const item of actor.itemTypes.equipment ) {
        // Проверка result — защита от зацикливания в испорченных данных
        if ( (item.system.containerId !== id) || result.includes(item) ) continue;
        result.push(item);
        visit(item.id);
      }
    };
    visit(this.parent.id);
    return result;
  }

  /**
   * Состояние контейнера переходит на содержимое, как в GMentor: убрал рюкзак — убрал всё, что в нём.
   * Так же оружие передаёт состояние лежащим в нём модификаторам.
   * Обновляет только тот клиент, который изменил контейнер.
   * @inheritDoc
   */
  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if ( (userId !== game.user.id) || !("state" in (changed.system ?? {})) ) return;
    const updates = this.descendants.filter(item => item.system.state !== this.state)
      .map(item => ({ _id: item.id, "system.state": this.state }));
    if ( updates.length ) this.parent.actor.updateEmbeddedDocuments("Item", updates);
  }

  /**
   * Удалённый контейнер (или оружие с модификаторами) не уносит содержимое с собой, в GMentor уносит:
   * предметы перекладываются уровнем выше.
   * @inheritDoc
   */
  _onDelete(options, userId) {
    super._onDelete(options, userId);
    const actor = this.parent.actor;
    if ( (userId !== game.user.id) || !actor ) return;
    const updates = actor.itemTypes.equipment.filter(item => item.system.containerId === this.parent.id)
      .map(item => ({ _id: item.id, "system.containerId": this.containerId }));
    if ( updates.length ) actor.updateEmbeddedDocuments("Item", updates);
  }
}
