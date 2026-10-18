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
 * Эффекты черты: что она даёт персонажу (attribute_bonus, skill_bonus и т.п. в библиотеке GMentor).
 * Применяет их CharacterData. Поле создаётся функцией: один экземпляр поля нельзя вставить в схему дважды.
 */
const features = () => new ArrayField(new TypedSchemaField({
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
  spell: { college: text(), collegeCompare: choice(rules.COMPARE, "is anything"), ...scaled() }
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

  /** Эффекты черты и её включённых модификаторов с итоговой величиной value. */
  #activeFeatures() {
    const enabledModifiers = this.modifiers.filter(m => m.enabled);
    return [this.features, ...enabledModifiers.map(m => m.features)].flat().map(feature => ({
      ...feature,
      value: feature.amount * (feature.perLevel ? this.levels : 1)
    }));
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

export class EquipmentData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      quantity: integer(1, { min: 0 }),
      weight: number(0, { min: 0 }),
      value: number(0, { min: 0 }),
      techLevel: text(),
      state: choice(["equipped", "carried", "stored"], "carried"),
      // Оружие: если урон пуст, предмет оружием не считается
      damage: text(),
      skill: text(),
      reach: text(),
      minSt: text()
    };
  }

  prepareBaseData() {
    this.skillLevel = null;
  }

  get isWeapon() {
    return !!this.damage.trim();
  }
}
