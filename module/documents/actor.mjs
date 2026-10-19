import { conditionGroup } from "../conditions.mjs";
import { damageParts, energyDamage, energyStep, parseDamage, spentEnergy, successOutcome } from "../rules.mjs";
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
