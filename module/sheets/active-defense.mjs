import * as rules from "../rules.mjs";
import { showSuccessResult } from "./success-roll.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Числовые поля формы; остальные — флажки и списки
const NUMBER_FIELDS = ["level", "modifier", "shieldDb", "parryNumber", "pose", "height"];

// Взаимоисключающие флажки, как в GMentor: чем атаковали и как уходят от атаки
const EXCLUSIVE_GROUPS = [["firearms", "flail", "nunchaku"], ["retreat", "drop"]];

// Щит в списке окна: DB от 0 до 4 (B287)
const MAX_SHIELD_DB = 4;

/**
 * Окно активной защиты, как инструмент toolActiveDefence GMentor (B374): уклонение, парирование или блок,
 * щит, отступление и обстоятельства атаки дают итоговый уровень. Бросок делает GMentorActor#rollSuccess,
 * окно не закрывается и показывает результат у себя, как окно броска. Стили — общие с окнами атаки.
 */
export default class ActiveDefenseDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {Actor} options.actor     Кто защищается
   * @param {string} options.defense  dodge | parry | block
   * @param {string} options.label    Подпись броска: «Парирование (Меч)»
   * @param {number} options.value    Уровень защиты с бонусами персонажа
   */
  constructor({ actor, defense, label, value, ...options }) {
    super(options);
    this.#actor = actor;
    this.#defense = defense;
    this.#label = label;
    this.#value = value;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["gmentor", "tool-window", "attack-window", "active-defense", "themed", "theme-light"],
    position: { width: 460 },
    form: { handler: ActiveDefenseDialog.#onSubmit, closeOnSubmit: false }
  };

  static PARTS = {
    body: { template: "systems/gmentor/templates/actor/active-defense.hbs", scrollable: [""] }
  };

  #actor;

  #defense;

  #label;

  #value;

  /** @override */
  get title() {
    return this.#actor.name;
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    // DB щита уже входит в защиту персонажа: в окне он отдельным полем, как в GMentor («Фиксим проблему со щитами»)
    const shieldDb = Math.min(shieldDefenseBonus(this.#actor, this.#defense), MAX_SHIELD_DB);
    const localized = (keys, prefix) => Object.fromEntries(keys.map(key => [key, `GMENTOR.ActiveDefense.${prefix}.${key}`]));
    return Object.assign(context, {
      defense: this.#defense,
      defenses: rules.ACTIVE_DEFENSES,
      level: this.#value - shieldDb,
      shieldDb,
      shieldChoices: localized(Array.fromRange(MAX_SHIELD_DB + 1).map(String), "shield"),
      poseChoices: localized(["0", "-2", "-3"], "pose"),
      heightChoices: localized(["-3", "-2", "-1", "0", "1", "2", "3"], "height"),
      attackOptions: ["firearms", "flail", "nunchaku"],
      moreOptions: Object.keys(rules.DEFENSE_OPTIONS).map(key => ({ key, parryOnly: rules.PARRY_ONLY_OPTIONS.includes(key) }))
    });
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.addEventListener("input", event => this.#onInput(event));
    // Раскрытые модификаторы длиннее экрана: подгоняем высоту окна заново. Событие toggle не всплывает
    this.element.addEventListener("toggle", () => this.setPosition({ height: "auto" }), true);
    this.#refresh();
  }

  /** Включённый флажок из взаимоисключающей группы снимает остальные, как в GMentor. */
  #onInput(event) {
    const { name, checked } = event.target;
    const group = EXCLUSIVE_GROUPS.find(keys => keys.includes(name));
    if ( group && checked ) {
      for ( const other of group ) {
        if ( other !== name ) this.element.elements[other].checked = false;
      }
    }
    this.#refresh();
  }

  /** Значения формы числами и флажками. */
  #values() {
    const values = new foundry.applications.ux.FormDataExtended(this.element).object;
    for ( const key of NUMBER_FIELDS ) values[key] = Number(values[key]) || 0;
    return values;
  }

  /** Показывает поля выбранной защиты, пересчитывает итог. */
  #refresh() {
    const values = this.#values();
    const form = this.element;
    const parry = values.defense === "parry";
    const dodge = values.defense === "dodge";
    const show = (selector, visible) => form.querySelectorAll(selector).forEach(element => element.hidden = !visible);
    show(".parry-only", parry);
    show(".dodge-only", dodge);
    show(".multiple-parry", parry && (values.parryNumber > 1));
    show(".shield-settings", !values.firearms);
    if ( !dodge ) form.elements.drop.checked = false;
    form.querySelector(".retreat-value").textContent = dodge ? "+3" : "+1";
    // От пуль парировать и блокировать нельзя (B374): подсвечиваем выбор, как GMentor
    for ( const defense of ["parry", "block"] ) {
      form.querySelector(`[data-defense=${defense}]`).classList.toggle("warning", values.firearms && (values.defense === defense));
    }
    form.querySelector("[data-preview=target]").textContent = rules.activeDefenseTarget(values).target;
  }

  static async #onSubmit(event, form, formData) {
    const values = this.#values();
    const { target } = rules.activeDefenseTarget(values);
    const label = (values.defense === this.#defense) ? this.#label : game.i18n.localize(`GMENTOR.ActiveDefense.type.${values.defense}`);
    const notes = result => defenseNotes(result, values);
    const message = await this.#actor.rollSuccess(label, values.level, { modifier: target - values.level, notes });
    const roll = message.rolls[0];
    showSuccessResult(form.querySelector(".roll-results"), roll, target, notes(rules.successOutcome(roll.total, target)));
    this.setPosition({ height: "auto" });
    return message;
  }
}

/**
 * DB щитов (B287): бонус к этой защите от надетого снаряжения. Щит в библиотеке даёт DB эффектами на уклонение,
 * парирование и блок; бонусы черт (Боевые рефлексы) — не щит. GMentor здесь берёт весь бонус к защите.
 */
function shieldDefenseBonus(actor, defense) {
  let bonus = 0;
  for ( const item of actor.itemTypes.equipment ) {
    for ( const feature of item.system.activeFeatures ) {
      if ( (feature.type === "attribute") && (feature.target === defense) ) bonus += feature.value;
    }
  }
  return Math.max(bonus, 0);
}

/** Пометки к исходу, как в GMentor: от скольких снарядов увернулся, рука как цель при парировании без оружия. */
function defenseNotes({ outcome, margin }, values) {
  const notes = [];
  const success = (outcome === "success") || (outcome === "critSuccess");
  if ( values.firearms && success ) {
    const dodged = rules.dodgedProjectiles(outcome, margin);
    notes.push(dodged === "all" ? game.i18n.localize("GMENTOR.ActiveDefense.dodgedAll")
      : game.i18n.format("GMENTOR.ActiveDefense.dodged", { count: dodged }));
  }
  if ( (values.defense === "parry") && values.bareOnWeapon && success ) {
    notes.push(game.i18n.localize("GMENTOR.ActiveDefense.armTarget"));
  }
  return notes;
}
