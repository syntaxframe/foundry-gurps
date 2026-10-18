import * as rules from "../rules.mjs";

const { ArrayField, BooleanField, HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;

const integer = (initial = 0, options = {}) =>
  new NumberField({ required: true, nullable: false, integer: true, initial, ...options });
const number = (initial = 0, options = {}) =>
  new NumberField({ required: true, nullable: false, initial, ...options });
const choice = (choices, initial) => new StringField({ required: true, blank: false, choices, initial });
// required: true даёт пустую строку по умолчанию; без него поле может быть undefined
const text = () => new StringField({ required: true });

/** Общая часть всех предметов: описание и ссылка на страницу книги ("B14"). */
class BaseItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      reference: text(),
      description: new HTMLField()
    };
  }
}

/** Преимущество, недостаток, причуда или перк. Цена считается так же, как в GMentor (advantages.js). */
export class AdvantageData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      basePoints: integer(0),
      pointsPerLevel: integer(0),
      levels: integer(0, { min: 0 }),
      cr: integer(0),
      roundDown: new BooleanField(),
      quirk: new BooleanField(),
      modifiers: new ArrayField(new SchemaField({
        name: text(),
        value: integer(0),
        enabled: new BooleanField({ initial: true })
      }))
    };
  }

  prepareDerivedData() {
    this.cost = rules.traitCost(this);
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
