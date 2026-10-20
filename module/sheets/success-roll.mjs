import { successOutcome } from "../rules.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Потраченное время: от мгновенного (−10) до ×30 (+5), B346
const TIME_MODIFIERS = [-10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];

/**
 * Окно броска характеристики, умения или защиты, как инструмент toolSkillRoll GMentor (B343): уровень,
 * модификатор и потраченное время дают эффективный навык. Бросок делает GMentorActor#rollSuccess,
 * окно после него не закрывается, а результат появляется в нём сверху списка, как skill-results в GMentor.
 */
export default class SuccessRollDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {Actor} options.actor        Кто бросает
   * @param {string} options.label       Что бросаем: «СЛ», название умения
   * @param {number} options.value       Уровень
   * @param {boolean} [options.timeSpent]  Показывать потраченное время (у самоконтроля и защит его нет)
   */
  constructor({ actor, label, value, timeSpent = true, ...options }) {
    super(options);
    this.#actor = actor;
    this.#label = label;
    this.#value = value;
    this.#timeSpent = timeSpent;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["gmentor", "tool-window", "success-roll", "themed", "theme-light"],
    position: { width: 400 },
    form: { handler: SuccessRollDialog.#onSubmit, closeOnSubmit: false }
  };

  static PARTS = {
    body: { template: "systems/gmentor/templates/actor/success-roll.hbs" }
  };

  #actor;

  #label;

  #value;

  #timeSpent;

  /** @override */
  get title() {
    return this.#actor.name;
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, {
      label: this.#label,
      level: this.#value,
      timeSpent: this.#timeSpent,
      timeChoices: Object.fromEntries(TIME_MODIFIERS.map(value => [value, `GMENTOR.SuccessRoll.time.${value}`]))
    });
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.addEventListener("input", () => this.#refresh());
    this.#refresh();
  }

  /** Уровень и сумма модификаторов из формы. */
  #values() {
    const { level, modifier, time } = new foundry.applications.ux.FormDataExtended(this.element).object;
    return { level: Number(level) || 0, modifier: (Number(modifier) || 0) + (Number(time) || 0) };
  }

  #refresh() {
    const { level, modifier } = this.#values();
    this.element.querySelector("[data-preview=target]").textContent = level + modifier;
  }

  static async #onSubmit(event, form, formData) {
    const { level, modifier } = this.#values();
    const message = await this.#actor.rollSuccess(this.#label, level, { modifier });
    this.#showResult(message.rolls[0], level + modifier);
    return message;
  }

  /**
   * Строка результата, как gc-rolled в GMentor: грани кубиков, сумма и исход с запасом.
   * Новый бросок — сверху, прошлые бледнее (стили .roll-results).
   */
  #showResult(roll, target) {
    const { outcome, margin } = successOutcome(roll.total, target);
    const result = document.createElement("p");
    result.className = `roll-result ${outcome}`;
    result.dataset.tooltipText = new Date().toLocaleTimeString();
    // ⚀–⚅ идут в Юникоде подряд с U+2680
    const faces = roll.dice[0].results.map(die => String.fromCodePoint(0x267F + die.result)).join(" ");
    const outcomeText = `${game.i18n.localize(`GMENTOR.Roll.${outcome}`)} (${margin.signedString()})`;
    result.innerHTML = `<span class="dice"></span> = <span class="total"></span> <span class="outcome"></span>`;
    result.querySelector(".dice").textContent = faces;
    result.querySelector(".total").textContent = roll.total;
    result.querySelector(".outcome").textContent = outcomeText;
    this.element.querySelector(".roll-results").prepend(result);
  }
}
