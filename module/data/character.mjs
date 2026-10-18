import * as rules from "../rules.mjs";

const { HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;

const integer = (initial = 0, options = {}) =>
  new NumberField({ required: true, nullable: false, integer: true, initial, ...options });

/** Купленные отклонения вторичной характеристики от базы (как HP/FP/Will/Per в GMentor) */
const secondary = () => new SchemaField({ mod: integer(0) });

/** Шкала с текущим значением; max считается в prepareDerivedData. */
const pool = () => new SchemaField({ value: integer(10), mod: integer(0) });

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
   * Бонусы от преимуществ и снаряжения. Их заполняют Active Effects (ключи вида system.bonuses.st),
   * которые Foundry применяет между prepareBaseData и prepareDerivedData.
   */
  prepareBaseData() {
    this.bonuses = {
      st: 0, dx: 0, iq: 0, ht: 0, hp: 0, fp: 0, will: 0, per: 0, speed: 0, move: 0,
      dodge: 0, parry: 0, block: 0, sm: 0, fright: 0, strikingSt: 0, liftingSt: 0, dr: 0,
      // От состояний: множитель движения (поза, увечье) и штраф к броскам самоконтроля
      moveMultiplier: 1, selfControl: 0
    };
  }

  prepareDerivedData() {
    const b = this.bonuses;
    const sm = this.sm + b.sm;
    const sizeModifier = rules.sizeCostModifier(sm);
    const cost = { attributes: 0 };

    // Основные атрибуты
    for ( const [key, attr] of Object.entries(this.attributes) ) {
      attr.total = attr.value + b[key];
      attr.cost = rules.attributeCost(key, attr.value, key === "st" ? sizeModifier : 1);
      cost.attributes += attr.cost;
    }
    const { st, dx, iq, ht } = this.attributes;

    // Вторичные характеристики (B15–B17)
    this.hp.max = st.total + this.hp.mod + b.hp;
    this.hp.cost = Math.round(this.hp.mod * 2 * sizeModifier);
    this.fp.max = ht.total + this.fp.mod + b.fp;
    this.fp.cost = this.fp.mod * 3;
    this.will.value = iq.total + this.will.mod + b.will;
    this.will.cost = this.will.mod * 5;
    this.will.fright = this.will.value + b.fright;
    this.per.value = iq.total + this.per.mod + b.per;
    this.per.cost = this.per.mod * 5;
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
    // СП по локациям: естественная плюс бонус на всё тело. Броня по локациям — позже
    this.locations = rules.LOCATIONS.map(l => ({ ...l, dr: l.dr + b.dr }));
    this.lift = rules.basicLift(st.total + b.liftingSt) / 2; // в кг: в русском издании 1 фунт = 0.5 кг

    this.#prepareItems(cost);
    this.#prepareEncumbrance();
    this.#prepareDefenses();
    this.#preparePoints(cost);
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
          s.level = result ? result.level + s.bonus : null;
          s.relative = result?.relative ?? null;
          cost[`${item.type}s`] += s.points;
          break;
        }
      }
    }
    // Уровень оружия берём из умения с тем же названием: умения уже посчитаны в цикле выше
    for ( const item of this.parent.itemTypes.equipment ) {
      const skill = this.findSkill(item.system.skill);
      item.system.skillLevel = skill?.system.level ?? null;
    }
  }

  #prepareEncumbrance() {
    let weight = 0;
    for ( const item of this.parent.itemTypes.equipment ) {
      if ( item.system.state !== "stored" ) weight += item.system.weight * item.system.quantity;
    }
    const level = rules.encumbranceLevel(weight, this.lift);
    this.encumbrance = {
      weight: Math.round(weight * 100) / 100,
      level,
      thresholds: rules.ENCUMBRANCE_MULTIPLIERS.map((m, i) => ({ level: i, weight: this.lift * m, active: i === level }))
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

  /** Поиск умения по названию без учёта регистра. */
  findSkill(name) {
    const target = name?.trim().toLowerCase();
    if ( !target ) return null;
    return this.parent.itemTypes.skill.find(i => i.name.trim().toLowerCase() === target) ?? null;
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
