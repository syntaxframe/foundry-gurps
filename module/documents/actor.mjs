import { conditionGroup } from "../conditions.mjs";
import { ATTACK_LOCATIONS, damageParts, damageRecord, energyDamage, energyStep, hitsFromMargin, missByOneLocation,
  parseDamage, penetratingDamage, randomLocation, spentEnergy, successOutcome, woundingModifier } from "../rules.mjs";
import { describeRangedAttack } from "../sheets/ranged-attack.mjs";
import { describeCasting } from "../sheets/spell-cast.mjs";

export default class GMentorActor extends Actor {
  /** Foundry по умолчанию отдаёт system целиком; модель персонажа добавляет короткие имена (@st, @speed). */
  getRollData() {
    return this.system.getRollData?.() ?? super.getRollData();
  }

  /**
   * Поза бывает только одна: включая новую, снимаем остальные. Работает и с листа, и с HUD токена.
   * @inheritDoc
   */
  async toggleStatusEffect(statusId, options = {}) {
    const activating = !this.statuses.has(statusId) && (options.active !== false);
    if ( activating && (conditionGroup(statusId) === "posture") ) {
      const others = this.effects.filter(e => [...e.statuses].some(s => (s !== statusId) && (conditionGroup(s) === "posture")));
      if ( others.length ) await this.deleteEmbeddedDocuments("ActiveEffect", others.map(e => e.id));
    }
    return super.toggleStatusEffect(statusId, options);
  }

  /**
   * Бросок 3d6 на успех против значения target (атрибут, умение, защита).
   * @param {string} label             Что бросаем, для чата
   * @param {number} target            Эффективный навык до модификатора
   * @param {object} [options]
   * @param {boolean} [options.askModifier]  Спросить модификатор перед броском (Shift+клик)
   */
  async rollSuccess(label, target, { askModifier = false } = {}) {
    let modifier = 0;
    if ( askModifier ) {
      modifier = await askForModifier(label);
      if ( modifier === null ) return null;
    }
    const effective = target + modifier;
    const roll = await new Roll("3d6").evaluate();
    const { outcome, margin } = successOutcome(roll.total, effective);
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/gmentor/templates/chat/success-roll.hbs",
      { label, target, modifier, effective, outcome, margin, outcomeLabel: `GMENTOR.Roll.${outcome}` }
    );
    return roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this }), flavor: content });
  }

  /**
   * Сотворение заклинания с условиями из окна сотворения (SpellCastDialog), как toolSpellCast в GMentor.
   * При очень высокой мане любой провал критический (M5), критический провал — бросок по таблице B236.
   * Сколько энергии потрачено, зависит от исхода (rules.spentEnergy); списывает её кнопка в сообщении.
   */
  async castSpell(spell, values) {
    const casting = describeCasting(spell, values);
    const roll = await new Roll("3d6").evaluate();
    let { outcome, margin } = successOutcome(roll.total, casting.target);
    if ( (values.mana === "veryHigh") && (outcome === "failure") ) outcome = "critFailure";
    const rolls = [roll];
    let critical = "";
    if ( outcome === "critSuccess" ) critical = game.i18n.localize("GMENTOR.SpellCast.critSuccess");
    if ( outcome === "critFailure" ) {
      const critRoll = await new Roll("3d6").evaluate();
      rolls.push(critRoll);
      critical = game.i18n.format("GMENTOR.SpellCast.critFailureRoll", {
        total: critRoll.total, effect: game.i18n.localize(`GMENTOR.SpellCast.critFailure.${critRoll.total}`)
      });
    }
    const energy = spentEnergy(casting.energy, outcome, values.hpInstead);
    const content = await foundry.applications.handlebars.renderTemplate("systems/gmentor/templates/chat/spell-cast.hbs", {
      spell, casting, outcome, margin, critical, energy, outcomeLabel: `GMENTOR.Roll.${outcome}`,
      spendable: (energy.fp + energy.hp) > 0
    });
    const messageData = await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: content,
      flags: { gmentor: { energy: { ...energy, spent: false } } }
    }, { create: false });
    messageData.rolls = rolls;
    return ChatMessage.implementation.create(messageData);
  }

  /**
   * Дистанционная атака с условиями из окна атаки (RangedAttackDialog), как toolRangedAttack в GMentor (B372):
   * число попаданий по отдаче, промах на 1 по мелкой цели — в соседнюю локацию (B400), критические исходы (B556),
   * урон каждого снаряда против DR и множитель ранения локации. Выстрелы списываются с заряженного боеприпаса.
   * @param {Item} item       Оружие или заклинание
   * @param {number} index    Индекс режима в item.system.weapons
   * @param {object} values   Значения окна атаки
   */
  async rangedAttack(item, index, values) {
    const mode = item.system.weapons[index];
    const attack = describeRangedAttack(item, mode, values);
    const text = (key, data) => game.i18n.format(`GMENTOR.Attack.${key}`, data);
    const roll = await new Roll("3d6").evaluate();
    const rolls = [roll];
    let { outcome, margin } = successOutcome(roll.total, attack.target);
    const notes = [];

    let location = ATTACK_LOCATIONS.find(entry => entry.key === values.location)?.location ?? "torso";
    // Промах на 1 по мелкой цели попадает в соседнюю одним снарядом; 17 и 18 — всегда провал
    let missByOne = null;
    if ( (outcome === "failure") && (margin === -1) && (roll.total < 17) ) {
      missByOne = missByOneLocation(location);
      if ( missByOne ) {
        location = missByOne;
        outcome = "success";
      }
    }
    if ( location === "random" ) {
      const locationRoll = await new Roll("3d6").evaluate();
      rolls.push(locationRoll);
      location = randomLocation(locationRoll.total);
      notes.push(text("randomLocation", { total: locationRoll.total }));
    }

    let critical = "";
    if ( (outcome === "critSuccess") || (outcome === "critFailure") ) {
      const critRoll = await new Roll("3d6").evaluate();
      rolls.push(critRoll);
      let table = "critMiss";
      if ( outcome === "critSuccess" ) table = ["face", "skull"].includes(location) ? "critHead" : "critHit";
      critical = `${text("critRoll", { total: critRoll.total })}. ${text(`${table}.${critRoll.total}`)}`;
    }

    let hitText = "";
    const hits = [];
    let total = 0;
    let wound = null;
    const hit = (outcome === "success") || (outcome === "critSuccess");
    if ( hit ) {
      if ( attack.halfDamage ) notes.push(text("halfDamage"));
      if ( attack.shotgun ) notes.push(text("shotgun"));
      const count = missByOne ? 1 : hitsFromMargin(margin, attack.recoil, attack.fired);
      const locationLabel = text(`hitLocation.${location}`);
      const plural = new Intl.PluralRules(game.i18n.lang).select(count);
      hitText = text(`hits.${plural}`, { count, damage: attack.damage, location: locationLabel });
      for ( let i = 0; i < count; i++ ) {
        const parts = await this.#rollProjectile(attack.damage, values.dr, rolls);
        total += parts.reduce((sum, part) => sum + (part.penetrating ?? 0), 0);
        hits.push(parts);
      }
      wound = this.#woundText(attack.damage, location, values.targetType);
    }

    // Выстрелы списываются при любом исходе, как «Вычитать патроны» в GMentor
    const ammo = item.system.loadedAmmo;
    let ammoWarning = "";
    if ( values.spendAmmo && ammo ) {
      const left = ammo.system.quantity;
      if ( left === 0 ) ammoWarning = text("ammoOut");
      else if ( left < values.shots ) ammoWarning = text("ammoShort", { count: left });
      await ammo.update({ "system.quantity": Math.max(left - values.shots, 0) });
    }

    const content = await foundry.applications.handlebars.renderTemplate("systems/gmentor/templates/chat/ranged-attack.hbs", {
      title: text("rollTitle", { weapon: item.name, target: attack.target }),
      outcome, margin, outcomeLabel: `GMENTOR.Roll.${outcome}`,
      missByOne: missByOne && text("missByOne", { location: text(`hitLocation.${missByOne}`) }),
      critical, ammoWarning, hitText, notes, hits,
      total: (hits.length > 1) && text("total", { total }),
      wound
    });
    const messageData = await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this }), flavor: content },
      { create: false });
    messageData.rolls = rolls;
    return ChatMessage.implementation.create(messageData);
  }

  /**
   * Урон одного снаряда по частям: часть с кубиками бросается и проходит DR, остальное ("Paralysis") — текстом.
   * Урон не меньше 1, у дробящего — 0 (B378), после DR — не меньше 0. Броски добавляются в rolls.
   * @returns {Promise<object[]>}  [{text, rolled, damage, dr, penetrating, type}] или [{text}]
   */
  async #rollProjectile(damage, dr, rolls) {
    const parts = [];
    for ( const part of damageParts(damage) ) {
      const record = damageRecord(part);
      if ( !record ) {
        parts.push({ text: part });
        continue;
      }
      const roll = await new Roll(`${record.dice}d${record.sides}${record.adds ? record.adds.signedString() : ""}`).evaluate();
      rolls.push(roll);
      const minimum = (record.type === "cr") ? 0 : 1;
      const result = penetratingDamage(Math.max(roll.total, minimum), record, dr);
      parts.push({ ...result, rolled: roll.total, multiplier: record.multiplier, type: record.type });
    }
    return parts;
  }

  /** Множитель ранения и пометки локации словами, как toolLocationsTexts в GMentor. */
  #woundText(damage, location, targetType) {
    const record = damageParts(damage).map(damageRecord).find(Boolean);
    if ( !record ) return null;
    const { multiplier, notes, maxInjury } = woundingModifier(record.type, location, targetType);
    const text = (key, data) => game.i18n.format(`GMENTOR.Attack.${key}`, data);
    const lines = [];
    if ( multiplier > 1 ) lines.push(text("multiply", { value: multiplier }));
    if ( multiplier < 1 ) lines.push(text("divide", { value: Math.round(1 / multiplier * 1000) / 1000 }));
    if ( maxInjury ) lines.push(text("maxInjury", { value: maxInjury }));
    if ( !lines.length && !notes.length ) return null;
    return { lines, notes: notes.map(note => text(`wound.${note}`)).join("; ") };
  }

  /**
   * Списывает энергию сотворения из сообщения в чате: ЕУ и ЕЖ, если часть платилась здоровьем.
   * Сообщение помечается, чтобы не списать дважды.
   */
  async spendCastingEnergy(message) {
    const energy = message.getFlag("gmentor", "energy");
    if ( !energy || energy.spent ) return;
    await this.update({
      "system.fp.value": this.system.fp.value - energy.fp,
      "system.hp.value": this.system.hp.value - energy.hp
    });
    if ( message.isOwner ) await message.setFlag("gmentor", "energy", { ...energy, spent: true });
  }

  /**
   * Бросок урона по записи GURPS ("sw+2 cut", "2d-1 imp"). Составной урон заклинаний ("thr-1 cr +1d burn/point")
   * бросается по частям одним сообщением, части без броска ("Paralysis") идут текстом. Урон за энергию
   * ("1d burn/point") зависит от того, сколько энергии вложено, — спрашиваем перед броском.
   */
  async rollDamage(label, damage) {
    let parts = damageParts(damage);
    const step = parts.map(energyStep).find(Boolean);
    if ( step ) {
      const energy = await askForEnergy(label, step);
      if ( energy === null ) return null;
      parts = parts.map(part => energyDamage(part, energy));
      label = game.i18n.format("GMENTOR.Roll.WithEnergy", { label, energy });
    }
    const rolls = [];
    const results = [];
    for ( const part of parts ) {
      const parsed = parseDamage(part, this.system.damage);
      if ( !parsed ) {
        results.push(part);
        continue;
      }
      const roll = await new Roll(parsed.formula).evaluate();
      // Урон не может быть меньше 1, у дробящего — меньше 0 (B378). Перед типом бывает делитель брони: "(2) cr"
      const minimum = /\bcr\b/.test(parsed.type) ? 0 : 1;
      results.push(`<strong>${Math.max(roll.total, minimum)}</strong> ${parsed.type}`.trim());
      rolls.push(roll);
    }
    if ( !rolls.length ) {
      ui.notifications.warn(game.i18n.format("GMENTOR.Roll.BadDamage", { damage }));
      return null;
    }
    const flavor = `<h3>${label}</h3><p>${game.i18n.localize("GMENTOR.Roll.Damage")}: ${results.join(" + ")}</p>`;
    // toMessage оставляет в сообщении только свой бросок: готовим данные (режим сообщения, звук) и кладём все
    const messageData = await rolls[0].toMessage({ speaker: ChatMessage.getSpeaker({ actor: this }), flavor },
      { create: false });
    messageData.rolls = rolls;
    return ChatMessage.implementation.create(messageData);
  }
}

/** Диалог с полем энергии, вложенной в заклинание; step — за сколько очков даётся урон. Null, если окно закрыли. */
async function askForEnergy(label, step) {
  const result = await foundry.applications.api.DialogV2.input({
    window: { title: label },
    content: `<div class="form-group"><label>${game.i18n.localize("GMENTOR.Roll.Energy")}</label>
      <input type="number" name="energy" value="${step}" min="${step}" step="${step}" autofocus></div>`,
    ok: { label: "GMENTOR.Roll.Roll", icon: "fa-solid fa-dice" }
  });
  return result ? Math.max(Number(result.energy) || step, step) : null;
}

/** Диалог с полем модификатора. Возвращает число или null, если окно закрыли. */
async function askForModifier(label) {
  const result = await foundry.applications.api.DialogV2.input({
    window: { title: label },
    content: `<div class="form-group"><label>${game.i18n.localize("GMENTOR.Roll.Modifier")}</label>
      <input type="number" name="modifier" value="0" step="1" autofocus></div>`,
    ok: { label: "GMENTOR.Roll.Roll", icon: "fa-solid fa-dice" }
  });
  return result ? Number(result.modifier) || 0 : null;
}
