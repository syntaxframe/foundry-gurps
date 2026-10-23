import { energyStep, modifyDamage } from "../rules.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Окно броска урона, как инструмент toolDiceRoll GMentor: запись урона крупно, кнопки ±1d, ±1 и смены размера
 * кубика, бросок. Урон за энергию ("1d burn/point") получает поле вложенной энергии. Бросок делает
 * GMentorActor#rollDamage, окно не закрывается и показывает результаты у себя, новый сверху.
 */
export default class DamageRollDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {Actor} options.actor     Кто бросает
   * @param {string} options.label    Что бросаем: «Укол», название оружия
   * @param {string} options.damage   Запись урона: "2d+1 cut"
   */
  constructor({ actor, label, damage, ...options }) {
    super(options);
    this.#actor = actor;
    this.#label = label;
    this.#damage = damage;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["gmentor", "tool-window", "damage-roll", "themed", "theme-light"],
    position: { width: 400 },
    form: { handler: DamageRollDialog.#onSubmit, closeOnSubmit: false },
    actions: {
      modifyDamage: DamageRollDialog.#onModifyDamage,
      clearResults: DamageRollDialog.#onClearResults
    }
  };

  static PARTS = {
    body: { template: "systems/gmentor/templates/actor/damage-roll.hbs" }
  };

  #actor;

  #label;

  #damage;

  /** @override */
  get title() {
    return this.#actor.name;
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, { damage: this.#damage });
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.addEventListener("input", () => this.#refresh());
    this.#refresh();
  }

  get #damageInput() {
    return this.element.querySelector("[name=damage]");
  }

  /** Поле энергии — только у урона за энергию; шаг поля — за сколько очков даётся урон. */
  #refresh() {
    const step = energyStep(this.#damageInput.value);
    const energyLine = this.element.querySelector("[data-energy]");
    energyLine.hidden = !step;
    if ( !step ) return;
    const input = energyLine.querySelector("input");
    input.min = input.step = step;
    if ( Number(input.value) < step ) input.value = step;
  }

  /** Кнопки −1d, +1d, −1, +1 и размер кубика: data-dice, data-adds, data-next-size. */
  static #onModifyDamage(event, target) {
    const { dice, adds, nextSize } = target.dataset;
    const input = this.#damageInput;
    input.value = modifyDamage(input.value, {
      dice: Number(dice) || 0, adds: Number(adds) || 0, nextSize: nextSize !== undefined
    });
    this.#refresh();
  }

  static #onClearResults() {
    this.element.querySelector(".roll-results").replaceChildren();
  }

  static async #onSubmit(event, form, formData) {
    const { damage, energy } = formData.object;
    const options = energyStep(damage) ? { energy: Math.max(Number(energy) || 0, energyStep(damage)) } : {};
    const message = await this.#actor.rollDamage(this.#label, damage, options);
    if ( message ) this.#showResult(message);
    return message;
  }

  /**
   * Строка результата, как gc-rolled в GMentor: у каждой брошенной части грани кубиков и итог с типом урона,
   * остальные части текстом. Новый бросок — сверху, прошлые бледнее (стили .roll-results).
   */
  #showResult(message) {
    const rolls = [...message.rolls];
    const result = document.createElement("p");
    result.className = "roll-result";
    result.dataset.tooltipText = new Date().toLocaleTimeString();
    message.getFlag("gmentor", "damage").forEach(({ text, total, type }, index) => {
      if ( index > 0 ) result.append(" + ");
      if ( text !== undefined ) {
        result.append(text);
        return;
      }
      const roll = rolls.shift();
      const dice = document.createElement("span");
      dice.className = "dice";
      dice.textContent = faces(roll);
      const totalElement = document.createElement("span");
      totalElement.className = "total";
      totalElement.textContent = total;
      const adds = roll.total - roll.dice[0].total;
      result.append(dice, adds ? ` ${adds.signedString()} = ` : " = ", totalElement, type ? ` ${type}` : "");
    });
    this.element.querySelector(".roll-results").prepend(result);
  }
}

/** Грани брошенных кубиков: у d6 — ⚀–⚅ (в Юникоде подряд с U+2680), у остальных — числа. */
function faces(roll) {
  const die = roll.dice[0];
  return die.results.map(({ result }) => (die.faces === 6 ? String.fromCodePoint(0x267F + result) : result)).join(" ");
}
