import * as rules from "../rules.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Числовые поля формы; остальные — флажки и списки
const NUMBER_FIELDS = ["skill", "dr", "distance", "speed", "shots", "energy", "aimRounds", "opticsBonus", "modifier",
  "height", "heightFactor", "sizeMeters", "sizeSm", "blockersCount", "weaponMaster", "visibility", "controlFailure"];

/**
 * Окно дистанционной атаки, как инструмент toolRangedAttack GMentor (B372, B548): обстоятельства (дистанция,
 * скорость, прицеливание, локация, укрытия, видимость, транспорт) дают итоговый навык, а дистанция и Мастер оружия
 * меняют урон. Итог пересчитывается на каждое изменение, бросок делает GMentorActor#rangedAttack.
 */
export default class RangedAttackDialog extends HandlebarsApplicationMixin(ApplicationV2) {
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
    classes: ["gmentor", "tool-window", "ranged-attack", "themed", "theme-light"],
    position: { width: 500 },
    form: { handler: RangedAttackDialog.#onSubmit, closeOnSubmit: false }
  };

  static PARTS = {
    body: { template: "systems/gmentor/templates/actor/ranged-attack.hbs", scrollable: [""] }
  };

  #item;

  #modeIndex;

  /** Режим оружия с итогами персонажа: берём заново, чтобы видеть израсходованные патроны. */
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
    const localized = (keys, prefix) => Object.fromEntries(keys.map(key => [key, `GMENTOR.Attack.${prefix}.${key}`]));
    // Бонус оптики записан после Acc: "4+2" (B278), с ним флажок оптики сразу включён
    const opticsBonus = Number(String(mode.accuracyText).split("+")[1]) || 0;
    return Object.assign(context, {
      item: this.#item,
      mode,
      ammo: this.#item.system.loadedAmmo ?? null,
      skill: mode.level ?? 10,
      energyStep: rules.damageParts(mode.damageText).map(rules.energyStep).find(Boolean) ?? null,
      opticsBonus,
      locations: rules.ATTACK_LOCATIONS.map(({ key, toHit }) => ({
        key, label: `${game.i18n.localize(`GMENTOR.Attack.location.${key}`)} (${toHit})`, selected: key === "torso"
      })),
      aimRounds: Array.fromRange(10),
      heightChoices: { 0: "GMENTOR.Attack.height.level", 1: "GMENTOR.Attack.height.below", "-0.5": "GMENTOR.Attack.height.above" },
      sizeChoices: localized(["human", "meters", "sm"], "size"),
      targetChoices: localized(["normal", "unliving", "homogenous", "diffuse"], "target"),
      visibilityChoices: Object.fromEntries(Array.fromRange(11).map(step => [-step, step === 0
        ? "GMENTOR.Attack.visibilityNormal" : step === 10 ? "GMENTOR.Attack.visibilityDark" : String(-step)])),
      opportunityChoices: localized(Object.keys(rules.OPPORTUNITY_FIRE), "opportunity"),
      options: ["pose", "allOutAttack", "moveAndAttack", "armorGaps", "closeCombat", "badFooting", "offHand",
        "dualWeapons", "popUp"],
      coverOptions: ["lightCover", "partlyHidden", "unfamiliar"],
      unseenOptions: ["unseen", "unseenKnown"],
      vehicleOptions: Object.keys(rules.VEHICLE_ATTACK_OPTIONS)
    });
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.addEventListener("input", event => this.#onInput(event));
    // Раскрытые модификаторы длиннее экрана: подгоняем высоту окна заново, содержимое прокручивается (как в GMentor).
    // Событие toggle не всплывает, поэтому ловим его на погружении
    this.element.addEventListener("toggle", () => this.setPosition({ height: "auto" }), true);
    this.#refresh();
  }

  /** Скорость в м/с и км/ч связаны, как в GMentor; остальное только пересчитывает итог. */
  #onInput(event) {
    const { name, value } = event.target;
    const form = this.element;
    if ( name === "speed" ) form.elements.speedKmh.value = Math.round(Number(value) * 3.6 * 100) / 100;
    if ( name === "speedKmh" ) form.elements.speed.value = Math.round(Number(value) / 3.6 * 100) / 100;
    this.#refresh();
  }

  /** Значения формы числами и флажками. */
  #values() {
    const values = new foundry.applications.ux.FormDataExtended(this.element).object;
    for ( const key of NUMBER_FIELDS ) values[key] = Number(values[key]) || 0;
    values.shots = Math.max(values.shots, 1);
    // Число перекрывающих и стрельба по возможности действуют вместе со своими флажками
    values.blockers = values.blockersOn ? values.blockersCount : 0;
    if ( !values.opportunityFire ) Object.assign(values, { opportunity: null, opportunityCheck: false });
    return values;
  }

  /** Показывает поля по выбору, подписи прицеливания и предупреждения, пересчитывает итог. */
  #refresh() {
    const values = this.#values();
    const attack = describeRangedAttack(this.#item, this.mode, values);
    const form = this.element;
    const show = (selector, visible) => form.querySelectorAll(selector).forEach(element => element.hidden = !visible);
    show(".optics-settings", values.optics);
    show(".optics-warning", values.optics && (values.opticsBonus > attack.accuracy));
    show(".brace-note", values.brace);
    show(".speed-note", values.speed > 0);
    show(".height-distance", values.heightFactor !== 0);
    show(".size-meters", values.sizeMode === "meters");
    show(".size-sm", values.sizeMode === "sm");
    show(".weapon-master-level", values.weaponMasterOn);
    show(".opportunity-settings", values.opportunityFire);
    show(".low-st", attack.lowSt < 0);
    form.querySelector(".low-st-value").textContent = attack.lowSt;
    form.querySelector(".blockers-value").textContent = -4 * values.blockersCount;

    // Подсказка о выбранной локации, как location-hints в GMentor
    const location = rules.ATTACK_LOCATIONS.find(entry => entry.key === values.location)?.location;
    const hintKey = `GMENTOR.Attack.locationHint.${location}`;
    const hint = form.querySelector(".location-hint");
    hint.textContent = game.i18n.has(hintKey) ? game.i18n.localize(hintKey) : "";
    hint.hidden = !hint.textContent;

    // Подписи прицеливания с итоговым бонусом: Acc, Acc+1, Acc+2 и оптика
    for ( const option of form.elements.aimRounds.options ) {
      const rounds = Number(option.value);
      option.textContent = rounds ? game.i18n.format("GMENTOR.Attack.aimRound", {
        rounds: roundsText(rounds), bonus: rules.aimBonus(rounds, attack.accuracy, attack.aimOptions)
      }) : game.i18n.localize("GMENTOR.Attack.aimNone");
    }

    form.elements.distance.classList.toggle("info", attack.halfDamage);
    form.elements.distance.classList.toggle("warning", (attack.range.max !== null) && (values.distance >= attack.range.max));
    form.elements.shots.classList.toggle("warning", attack.shotsWarning);
    form.querySelector("[data-preview=damage]").textContent = attack.damage;
    // Остаток боеприпаса меняется после каждого броска, окно при этом не перерисовывается
    const ammoLeft = form.querySelector("[data-preview=ammo]");
    if ( ammoLeft ) ammoLeft.textContent = this.#item.system.loadedAmmo?.system.quantity ?? 0;
    form.querySelector("[data-preview=target]").textContent = attack.target;
  }

  static async #onSubmit(event, form, formData) {
    await this.#item.actor.rangedAttack(this.#item, this.#modeIndex, this.#values());
    this.#refresh();
  }
}

/** «2 раунда» по правилам множественного числа языка. */
function roundsText(rounds) {
  const plural = new Intl.PluralRules(game.i18n.lang).select(rounds);
  return game.i18n.format(`GMENTOR.Attack.rounds.${plural}`, { rounds });
}

/**
 * Итог атаки для окна и броска: навык, урон снаряда по обстоятельствам и данные оружия для броска.
 * Повторяет calcIt инструмента GMentor.
 * @param {Item} item     Оружие или заклинание персонажа
 * @param {object} mode    Режим оружия с итогами персонажа (CharacterData#prepareWeaponMode)
 * @param {object} values  Значения окна атаки
 */
export function describeRangedAttack(item, mode, values) {
  const actor = item.actor;
  const parsedAccuracy = parseInt(mode.accuracyText);
  const accuracy = Number.isFinite(parsedAccuracy) ? parsedAccuracy : 1;
  const range = rules.parseRange(mode.rangeText);
  const { rof, burst: weaponBurst, minShots } = rules.parseRateOfFire(mode.rateOfFire);
  const bulk = parseInt(mode.bulk) || -1;
  const recoil = parseInt(mode.recoil) || 1;
  const lowSt = Math.min(actor.system.attributes.st.total - (parseInt(mode.minSt) || 0), 0);

  // Дальше 1/2D урон вдвое меньше; дробь вплотную бьёт одним зарядом из половины дробин (B409)
  const halfDamage = (range.half !== null) && (values.distance > range.half);
  const shotgun = (weaponBurst > 1) && (range.half !== null) && (values.distance < range.half * 0.1);
  const burst = shotgun ? 1 : weaponBurst;

  // Движение и атака, высунуться и атаковать — без прицеливания
  const aimOptions = { optics: values.optics, opticsBonus: values.opticsBonus, variable: values.opticsVariable === "1" };
  const canAim = !values.moveAndAttack && !values.popUp;
  const aim = canAim ? rules.aimBonus(values.aimRounds, accuracy, aimOptions) : 0;

  let size = 0;
  if ( values.sizeMode === "meters" ) size = rules.sizeModifier(values.sizeMeters || 2);
  if ( values.sizeMode === "sm" ) size = values.sizeSm;

  const target = rules.rangedAttackTarget({
    ...values,
    modifier: values.modifier + rules.rangedOptionsModifier(values, bulk),
    aim,
    burst,
    size,
    lowSt: values.lowStPenalty ? lowSt : 0,
    unseen: values.unseen || values.unseenKnown
  });

  // Мастер оружия: +1 или +2 за кубик базового урона (B99), а не за кубики после перевода прибавки (thr+3 → 1d+1)
  const adds = values.weaponMasterOn ? values.weaponMaster * rules.damageDice(mode.damage, actor.system.damage) : 0;
  const changes = { adds, halfDamage, shotgunFactor: shotgun ? Math.floor(weaponBurst / 2) : 1, armorGaps: values.armorGaps };
  // Урон за энергию — по вложенной энергии; изменения — к каждой части составного урона
  const damage = rules.damageParts(mode.damageText).map(part => {
    const withEnergy = rules.energyStep(part) ? rules.energyDamage(part, values.energy) : part;
    return rules.rangedDamage(withEnergy, changes);
  }).join(" + ");

  // Выстрелов больше RoF, меньше минимальной очереди или больше, чем осталось в заряженном боеприпасе
  const ammo = item.system.loadedAmmo;
  const shots = values.shots;
  return {
    target, damage, accuracy, range, recoil, lowSt, aimOptions, halfDamage, shotgun,
    fired: burst * shots,
    shotsWarning: (shots > rof) || (shots < minShots) || (!!ammo && (shots > ammo.system.quantity))
  };
}
