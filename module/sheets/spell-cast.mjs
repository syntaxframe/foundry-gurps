import * as rules from "../rules.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Уровень маны помним до перезагрузки: обычно он один на всю сцену, как cookie c_manna в GMentor
let lastMana = "normal";

/**
 * Окно сотворения заклинания, как инструмент toolSpellCast GMentor: обстоятельства (дистанция, мана,
 * действующие заклинания, сопротивление) дают итоговый навык, а уровень заклинания — ритуал, скидку
 * на стоимость и время (M9). Итог пересчитывается на каждое изменение, бросок делает GMentorActor#castSpell.
 */
export default class SpellCastDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {Item} options.spell  Заклинание персонажа
   */
  constructor({ spell, ...options }) {
    super(options);
    this.#spell = spell;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["gmentor", "spell-cast", "themed", "theme-light"],
    position: { width: 440 },
    form: { handler: SpellCastDialog.#onSubmit, closeOnSubmit: true }
  };

  static PARTS = {
    body: { template: "systems/gmentor/templates/actor/spell-cast.hbs" }
  };

  #spell;

  /** @override */
  get title() {
    return this.#spell.name;
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const s = this.#spell.system;
    const choices = (keys, prefix) => Object.fromEntries(keys.map(key => [key, `GMENTOR.SpellCast.${prefix}.${key}`]));
    return Object.assign(context, {
      spell: this.#spell,
      level: s.level ?? 0,
      type: rules.spellCastType(s.spellClass),
      mana: lastMana,
      baseCost: rules.baseSpellCost(s.castingCost) ?? 0,
      typeChoices: choices(rules.SPELL_CAST_TYPES, "type"),
      manaChoices: choices(rules.MANA_LEVELS, "mana"),
      infoRangeChoices: Object.fromEntries(rules.INFO_RANGE_MODIFIERS.map((modifier, index) =>
        [modifier, `GMENTOR.SpellCast.infoRange.${index}`]))
    });
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.addEventListener("input", () => this.#refresh());
    this.#refresh();
  }

  /**
   * Значения формы числами и флажками. У обычного и областного заклинания свои поля расстояния и видимости,
   * как в GMentor; в расчёт идут поля выбранного типа.
   */
  #values() {
    const values = new foundry.applications.ux.FormDataExtended(this.element).object;
    for ( const key of ["level", "modifier", "hpInstead", "activeSpells", "concentrating", "range", "areaRange",
      "infoRange", "ignored", "resistance", "sm", "radius", "baseCost"] ) values[key] = Number(values[key]) || 0;
    if ( values.type === "area" ) Object.assign(values, { range: values.areaRange, unseen: values.areaUnseen });
    return values;
  }

  /** Показывает поля выбранного типа и пересчитывает итог, ритуал, стоимость и время. */
  #refresh() {
    const values = this.#values();
    lastMana = values.mana;
    for ( const field of this.element.querySelectorAll("[data-types]") ) {
      field.hidden = !field.dataset.types.split(" ").includes(values.type);
    }
    this.element.querySelector(".resistance").hidden = !values.resisted;
    const preview = describeCasting(this.#spell, values);
    for ( const [key, text] of Object.entries(preview) ) {
      const element = this.element.querySelector(`[data-preview=${key}]`);
      if ( element ) element.textContent = text;
    }
  }

  static async #onSubmit(event, form, formData) {
    return this.#spell.actor.castSpell(this.#spell, this.#values());
  }
}

/**
 * Итог сотворения словами подсказки GMentor для окна и сообщения в чате: «уменьшается на 1»,
 * «умножается на 2 за размер цели и не меняется», «удваивается». Стоимость дополняется числом энергии.
 * @returns {{target: number, ritual: string, cost: string, time: string, energy: number}}
 */
export function describeCasting(spell, values) {
  const text = (key, data) => game.i18n.format(`GMENTOR.SpellCast.${key}`, data);
  const effects = rules.castingEffects(values.level, values);
  const energy = rules.spellEnergy(values.baseCost, { ...values, costReduction: effects.costReduction });

  let cost = effects.costReduction ? text("costReduced", { value: effects.costReduction }) : text("costSame");
  if ( (values.type === "regular") && (values.sm > 0) ) cost = text("costSize", { factor: values.sm + 1, cost });
  if ( (values.type === "area") && (values.radius > 1) ) cost = text("costArea", { factor: values.radius, cost });
  if ( values.baseCost > 0 ) cost += ` — ${text("energy", { value: energy })}`;

  let time;
  if ( values.type === "blocking" ) time = text("timeBlocking");
  else if ( effects.timeFactor === 2 ) time = text("timeDoubled");
  else if ( effects.timeFactor === 1 ) time = text("timeSame");
  else if ( effects.timeFactor === 0.5 ) time = text("timeHalved");
  else time = text("timeDivided", { factor: 1 / effects.timeFactor });
  if ( spell.system.castingTime ) time += ` (${spell.system.castingTime})`;

  return {
    target: rules.spellCastTarget(values),
    ritual: text(`ritual.${effects.ritual}`),
    cost,
    time,
    energy
  };
}
