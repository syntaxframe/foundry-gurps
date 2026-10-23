import * as rules from "../rules.mjs";
import { editedMode, showAttackResult } from "./ranged-attack.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Числовые поля формы; остальные — флажки и списки
const NUMBER_FIELDS = ["skill", "dr", "energy", "modifier", "evaluate", "pose", "deceptive", "shieldDb", "weaponMaster",
  "visibility"];

// Варианты тотальной атаки взаимоисключающие (B365)
const ALL_OUT_ATTACKS = ["determined", "double", "strong"];

// Удар голыми руками: способ "Punch" в библиотеке, у нас переведён (tools/lib/weapons.mjs)
const BARE_HANDS_USAGES = ["Punch", "Удар"];

/**
 * Окно контактной атаки, как инструмент toolMeleeAttack GMentor (B369, B547): локация, маневры и обстоятельства
 * дают итоговый навык, Мастер оружия и сильная тотальная атака — прибавку к урону. Двойная тотальная атака
 * и скоростной удар добавляют атаку. Итог пересчитывается на каждое изменение, бросок делает GMentorActor#meleeAttack.
 */
export default class MeleeAttackDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {Item} options.item    Оружие или заклинание персонажа
   * @param {number} options.mode  Индекс режима в item.system.weapons
   */
  constructor({ item, mode, ...options }) {
    super(options);
    this.#item = item;
    this.#modeIndex = mode;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["gmentor", "tool-window", "attack-window", "themed", "theme-light"],
    position: { width: 500 },
    form: { handler: MeleeAttackDialog.#onSubmit, closeOnSubmit: false }
  };

  static PARTS = {
    body: { template: "systems/gmentor/templates/actor/melee-attack.hbs", scrollable: [""] }
  };

  #item;

  #modeIndex;

  get mode() {
    return this.#item.system.weapons[this.#modeIndex];
  }

  /** @override */
  get title() {
    return this.#item.name;
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const mode = this.mode;
    const localized = (keys, prefix) => Object.fromEntries(keys.map(key => [key, `GMENTOR.${prefix}.${key}`]));
    return Object.assign(context, {
      rootId: this.id,
      mode,
      skill: mode.level ?? 10,
      minSt: mode.minSt || 0,
      bareHands: BARE_HANDS_USAGES.includes(mode.usage),
      energyStep: rules.damageParts(mode.damageText).map(rules.energyStep).find(Boolean) ?? null,
      locations: rules.ATTACK_LOCATIONS.map(({ key, toHit }) => ({
        key, label: `${game.i18n.localize(`GMENTOR.Attack.location.${key}`)} (${toHit})`, selected: key === "torso"
      })),
      evaluateChoices: localized(["0", "1", "2", "3"], "MeleeAttack.evaluate"),
      poseChoices: { 0: "GMENTOR.MeleeAttack.pose.standing", "-2": "GMENTOR.MeleeAttack.pose.kneeling",
        "-4": "GMENTOR.MeleeAttack.pose.lying" },
      targetChoices: localized(["normal", "unliving", "homogenous", "diffuse"], "Attack.target"),
      visibilityChoices: Object.fromEntries(Array.fromRange(11).map(step => [-step, step === 0
        ? "GMENTOR.Attack.visibilityNormal" : step === 10 ? "GMENTOR.Attack.visibilityDark" : String(-step)])),
      allOutAttacks: ALL_OUT_ATTACKS,
      options: ["moveAndAttack", "armorGaps", "badFooting", "grappled", "offHand", "dualWeapons"],
      laterOptions: ["intoCloseCombat", "wildSwing", "fromAbove", "largeShield"],
      unseenOptions: ["unseen", "unseenKnown"],
      mountOptions: ["mountAttacked", "mountSpeed"]
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

  /** Включённый вариант тотальной атаки снимает остальные, как в GMentor; остальное только пересчитывает итог. */
  #onInput(event) {
    const { name, checked } = event.target;
    if ( ALL_OUT_ATTACKS.includes(name) && checked ) {
      for ( const other of ALL_OUT_ATTACKS ) {
        if ( other !== name ) this.element.elements[other].checked = false;
      }
    }
    this.#refresh();
  }

  /** Значения формы числами и флажками. */
  #values() {
    const values = new foundry.applications.ux.FormDataExtended(this.element).object;
    for ( const key of NUMBER_FIELDS ) values[key] = Number(values[key]) || 0;
    // Числа при флажках действуют только вместе с ними
    if ( !values.deceptiveOn ) values.deceptive = 0;
    if ( !values.shieldOn ) values.shieldDb = 0;
    if ( !values.weaponMasterOn ) values.weaponMaster = 0;
    if ( !values.rapidStrike ) values.trainedByMaster = false;
    return values;
  }

  /** Показывает поля по выбору, пересчитывает итог. */
  #refresh() {
    const values = this.#values();
    const attack = describeMeleeAttack(this.#item, this.mode, values);
    const form = this.element;
    const show = (selector, visible) => form.querySelectorAll(selector).forEach(element => element.hidden = !visible);
    show(".low-st", attack.lowSt < 0);
    show(".deceptive-settings", values.deceptiveOn);
    show(".trained-by-master", values.rapidStrike);
    show(".shield-settings", values.shieldOn);
    show(".weapon-master-level", values.weaponMasterOn);
    form.querySelector(".low-st-value").textContent = attack.lowSt;
    form.querySelector(".rapid-strike-value").textContent = values.trainedByMaster ? -3 : -6;
    form.querySelector(".deceptive-value").textContent = -2 * values.deceptive;

    // Подсказка о выбранной локации, как location-hints в GMentor
    const location = rules.ATTACK_LOCATIONS.find(entry => entry.key === values.location)?.location;
    const hintKey = `GMENTOR.Attack.locationHint.${location}`;
    const hint = form.querySelector(".location-hint");
    hint.textContent = game.i18n.has(hintKey) ? game.i18n.localize(hintKey) : "";
    hint.hidden = !hint.textContent;

    form.querySelector("[data-preview=damage]").textContent = attack.damage;
    form.querySelector("[data-preview=attacks]").textContent = attack.attacks > 1
      ? game.i18n.format("GMENTOR.MeleeAttack.attacks", { count: attack.attacks }) : "";
    form.querySelector("[data-preview=target]").textContent = attack.target;
  }

  static async #onSubmit(event, form, formData) {
    const values = this.#values();
    const attack = describeMeleeAttack(this.#item, this.mode, values);
    const messages = await this.#item.actor.meleeAttack(this.#item, this.#modeIndex, values);
    const results = form.querySelector(".roll-results");
    for ( const message of messages ) showAttackResult(results, message, attack, values.skill, ["GMENTOR.MeleeAttack.option"]);
    this.setPosition({ height: "auto" });
  }
}

/**
 * Итог контактной атаки для окна и броска: навык, урон удара и число атак. Повторяет calcIt инструмента GMentor.
 * @param {Item} item     Оружие или заклинание персонажа
 * @param {object} mode    Режим оружия с итогами персонажа (CharacterData#prepareWeaponMode)
 * @param {object} values  Значения окна атаки
 */
export function describeMeleeAttack(item, mode, values) {
  const actor = item.actor;
  mode = editedMode(mode, values);
  const lowSt = Math.min(actor.system.attributes.st.total - (parseInt(mode.minSt) || 0), 0);
  const { target, modifiers, capped } = rules.meleeAttackTarget({ ...values, lowSt: values.lowStPenalty ? lowSt : 0 });

  // Мастер оружия: +1 или +2 за кубик базового урона (B99); сильная тотальная атака: +2 или +1 за кубик (B365)
  const baseDice = rules.damageDice(mode.damage, actor.system.damage);
  let adds = values.weaponMaster * baseDice;
  if ( values.strong ) adds += Math.max(baseDice, 2);
  const changes = { adds, convertDice: !values.keepAdds, armorGaps: values.armorGaps };
  // Урон за энергию — по вложенной энергии; изменения — к каждой части составного урона
  const damage = rules.damageParts(mode.damageText).map(part => {
    const withEnergy = rules.energyStep(part) ? rules.energyDamage(part, values.energy) : part;
    return rules.meleeDamage(withEnergy, changes);
  }).join(" + ");

  // Двойная тотальная атака и скоростной удар — ещё по атаке (B365, B370)
  const attacks = 1 + (values.double ? 1 : 0) + (values.rapidStrike ? 1 : 0);
  return { target, modifiers, capped, damage, lowSt, attacks };
}
