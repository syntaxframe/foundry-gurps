import * as rules from "../rules.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Где искать подписи флажков для списка модификаторов в результате (showAttackResult)
const RANGED_OPTION_LABELS = ["GMENTOR.Attack.option", "GMENTOR.Attack.vehicleOption"];

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
    classes: ["gmentor", "tool-window", "attack-window", "ranged-attack", "themed", "theme-light"],
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
      rootId: this.id,
      item: this.#item,
      mode,
      ammo: this.#item.system.loadedAmmo ?? null,
      skill: mode.level ?? 10,
      minSt: mode.minSt || 0,
      // Пустые ROF, Bulk и Rcl — как в расчёте и в GMentor
      rateOfFire: mode.rateOfFire || 1,
      bulk: mode.bulk || -1,
      recoil: mode.recoil || 1,
      shotsLeft: this.#shotsInMagazine(),
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

  /**
   * Патроны в магазине: остаток заряженного боеприпаса, без него — ёмкость оружия, как в GMentor.
   * У оружия без ёмкости (заклинание) — null: патроны не считаются.
   */
  #shotsInMagazine() {
    const ammo = this.#item.system.loadedAmmo;
    if ( ammo ) return ammo.system.quantity;
    const capacity = parseInt(this.mode.shots);
    return Number.isFinite(capacity) ? capacity : null;
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

  /**
   * Скорость в м/с и км/ч связаны, как в GMentor; новая ёмкость магазина — перезарядка: патронов в магазине столько же.
   * Остальное только пересчитывает итог.
   */
  #onInput(event) {
    const { name, value } = event.target;
    const form = this.element;
    if ( name === "speed" ) form.elements.speedKmh.value = Math.round(Number(value) * 3.6 * 100) / 100;
    if ( name === "speedKmh" ) form.elements.speed.value = Math.round(Number(value) / 3.6 * 100) / 100;
    if ( (name === "magazine") && Number.isFinite(parseInt(value)) ) form.elements.shotsLeft.value = parseInt(value);
    this.#refresh();
  }

  /** Значения формы числами и флажками. */
  #values() {
    const values = new foundry.applications.ux.FormDataExtended(this.element).object;
    for ( const key of NUMBER_FIELDS ) values[key] = Number(values[key]) || 0;
    values.shots = Math.max(values.shots, 1);
    // Без счётчика патронов (оружие без ёмкости) выстрелы не ограничены
    values.shotsLeft = ("shotsLeft" in values) ? (Number(values.shotsLeft) || 0) : Infinity;
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
    form.elements.shotsLeft?.classList.toggle("warning", values.shotsLeft <= 0);
    form.querySelector("[data-preview=damage]").textContent = attack.damage;
    form.querySelector("[data-preview=target]").textContent = attack.target;
  }

  static async #onSubmit(event, form, formData) {
    const values = this.#values();
    const attack = describeRangedAttack(this.#item, this.mode, values);
    const message = await this.#item.actor.rangedAttack(this.#item, this.#modeIndex, values);
    showAttackResult(form.querySelector(".roll-results"), message, attack, values.skill, RANGED_OPTION_LABELS);
    this.setPosition({ height: "auto" });
    // Патроны в магазине уменьшаются в окне, как в GMentor; заряженный боеприпас списывает rangedAttack
    if ( values.spendAmmo ) form.elements.shotsLeft.value = Math.max(values.shotsLeft - values.shots, 0);
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
  mode = editedMode(mode, values);
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

  const { target, modifiers, capped } = rules.rangedAttackTarget({
    ...values,
    optionModifiers: rules.rangedOptionModifiers(values, bulk),
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

  // Выстрелов больше RoF, меньше минимальной очереди или больше, чем осталось в магазине
  const shots = values.shots;
  return {
    target, modifiers, capped, damage, accuracy, range, recoil, lowSt, aimOptions, halfDamage, shotgun,
    fired: burst * shots,
    shotsWarning: (shots > rof) || (shots < minShots) || (shots > values.shotsLeft)
  };
}

// Данные оружия, которые правятся в строке окна атаки
const WEAPON_FIELDS = ["damageText", "minSt", "accuracyText", "rangeText", "rateOfFire", "bulk", "recoil"];

/**
 * Режим оружия с данными, исправленными в окне атаки, как editable-поля obj-names-short GMentor.
 * Пустое поле оставляет данные оружия. Исправленный урон становится и базовым: по нему Мастер оружия считает кубики.
 * @param {object} mode    Режим оружия с итогами персонажа
 * @param {object} values  Значения окна атаки
 */
export function editedMode(mode, values) {
  const edited = { ...mode };
  for ( const key of WEAPON_FIELDS ) {
    const value = values[key]?.trim();
    if ( value ) edited[key] = value;
  }
  if ( edited.damageText !== mode.damageText ) edited.damage = edited.damageText;
  return edited;
}

/**
 * Результат атаки в окне, как skill-results инструментов GMentor: грани кубиков и сумма, затем то же, что в чате
 * (исход, крит, попадания, урон и ранение), и из чего сложился навык. Новый бросок — сверху.
 * @param {HTMLElement} container   Список результатов окна
 * @param {ChatMessage} message     Сообщение атаки (GMentorActor#rangedAttack, #meleeAttack)
 * @param {object} attack           Итог атаки на момент броска (describeRangedAttack, describeMeleeAttack)
 * @param {number} skill            Уровень оружия из окна
 * @param {string[]} optionLabels   Где искать подписи флажков: «GMENTOR.Attack.option» и т.п.
 */
export function showAttackResult(container, message, attack, skill, optionLabels) {
  const result = document.createElement("div");
  result.className = `roll-result attack-result ${message.getFlag("gmentor", "outcome") ?? ""}`;
  result.dataset.tooltipText = new Date().toLocaleTimeString();

  // ⚀–⚅ идут в Юникоде подряд с U+2680
  const roll = message.rolls[0];
  const head = document.createElement("p");
  head.innerHTML = `<span class="dice"></span> = <span class="total"></span>`;
  head.querySelector(".dice").textContent = roll.dice[0].results.map(die => String.fromCodePoint(0x267F + die.result)).join(" ");
  head.querySelector(".total").textContent = roll.total;
  result.append(head);
  // Содержимое сообщения собрано нашим шаблоном (chat/ranged-attack.hbs), пользовательский текст в нём экранирован
  result.insertAdjacentHTML("beforeend", message.flavor);

  const modifiers = document.createElement("p");
  modifiers.className = "attack-modifiers";
  modifiers.textContent = attackModifiersText(attack, skill, optionLabels);
  result.append(modifiers);
  container.prepend(result);
}

/** «Умение 14 · Тотальная атака, точная +4 · Череп −7 · не выше 9 = 9». */
function attackModifiersText({ modifiers, capped, target }, skill, optionLabels) {
  const parts = [`${game.i18n.localize("GMENTOR.Attack.modifierLabel.skill")} ${skill}`];
  for ( const modifier of modifiers ) parts.push(`${attackModifierLabel(modifier, optionLabels)} ${modifier.value.signedString()}`);
  if ( capped ) parts.push(game.i18n.localize("GMENTOR.Attack.modifierLabel.capped"));
  return `${parts.join(" · ")} = ${target}`;
}

/**
 * Подпись модификатора: локация — её названием, у флажков — их подпись без значения в скобках и английского
 * названия («Плохая поверхность (-2) — Bad Footing» → «Плохая поверхность»), остальное — GMENTOR.Attack.modifierLabel.
 */
function attackModifierLabel({ key, location }, optionLabels) {
  if ( key === "location" ) return game.i18n.localize(`GMENTOR.Attack.location.${location}`);
  const ownKey = `GMENTOR.Attack.modifierLabel.${key}`;
  if ( game.i18n.has(ownKey) ) return game.i18n.localize(ownKey);
  const optionKey = optionLabels.map(prefix => `${prefix}.${key}`).find(labelKey => game.i18n.has(labelKey));
  if ( !optionKey ) return key;
  return game.i18n.localize(optionKey).split(" (")[0].split(" — ")[0];
}
