import { conditionGroup } from "../conditions.mjs";
import { parseDamage, successOutcome } from "../rules.mjs";

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

  /** Бросок урона по записи GURPS ("sw+2 cut", "2d-1 imp"). */
  async rollDamage(label, damage) {
    const parsed = parseDamage(damage, this.system.damage);
    if ( !parsed ) {
      ui.notifications.warn(game.i18n.format("GMENTOR.Roll.BadDamage", { damage }));
      return null;
    }
    const roll = await new Roll(parsed.formula).evaluate();
    // Урон не может быть меньше 1, у дробящего — меньше 0 (B378). Перед типом бывает делитель брони: "(2) cr"
    const minimum = /\bcr\b/.test(parsed.type) ? 0 : 1;
    const total = Math.max(roll.total, minimum);
    const flavor = `<h3>${label}</h3><p>${game.i18n.localize("GMENTOR.Roll.Damage")}: <strong>${total}</strong> ${parsed.type}</p>`;
    return roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this }), flavor });
  }
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
