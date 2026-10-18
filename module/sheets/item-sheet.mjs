const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

const TEMPLATES = "systems/gmentor/templates/item";

/** Один лист на все типы предметов: поля тела берутся из шаблона templates/item/<тип>.hbs. */
export default class GMentorItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    // standard-form включает стандартную вёрстку Foundry для .form-group (подпись и поле в строку)
    classes: ["gmentor", "item", "standard-form", "themed", "theme-light"],
    position: { width: 520, height: "auto" },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      addModifier: GMentorItemSheet.#onAddModifier,
      deleteModifier: GMentorItemSheet.#onDeleteModifier
    }
  };

  static PARTS = {
    header: { template: `${TEMPLATES}/header.hbs` },
    body: { template: `${TEMPLATES}/advantage.hbs` },
    description: { template: `${TEMPLATES}/description.hbs` }
  };

  /** @inheritDoc */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    parts.body = { ...parts.body, template: `${TEMPLATES}/${this.item.type}.hbs` };
    return parts;
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    Object.assign(context, {
      item,
      system: item.system,
      choices: {
        attribute: Object.fromEntries(["st", "dx", "iq", "ht", "will", "per"]
          .map(k => [k, `GMENTOR.Attribute.${k}`])),
        difficulty: Object.fromEntries(item.system.schema.fields.difficulty?.choices
          ?.map(k => [k, `GMENTOR.Difficulty.${k}`]) ?? []),
        defense: { none: "GMENTOR.Defense.none", parry: "GMENTOR.Defense.parry", block: "GMENTOR.Defense.block" },
        state: { equipped: "GMENTOR.State.equipped", carried: "GMENTOR.State.carried", stored: "GMENTOR.State.stored" },
        cr: { 0: "—", 6: "6", 9: "9", 12: "12", 15: "15" }
      },
      enrichedDescription: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        item.system.description, { secrets: item.isOwner, relativeTo: item }
      )
    });
    return context;
  }

  // Модификаторы хранятся массивом, поэтому меняем его целиком: так проще, чем адресовать элементы по индексу

  static #onAddModifier() {
    const modifiers = [...this.item.system.toObject().modifiers, { name: "", value: 0, enabled: true }];
    return this.item.update({ "system.modifiers": modifiers });
  }

  static #onDeleteModifier(event, target) {
    const modifiers = this.item.system.toObject().modifiers;
    modifiers.splice(Number(target.dataset.index), 1);
    return this.item.update({ "system.modifiers": modifiers });
  }
}
