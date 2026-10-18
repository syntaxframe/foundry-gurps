import { BONUS_TARGETS, COMPARE } from "../rules.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

const TEMPLATES = "systems/gmentor/templates/item";

/** Типы эффектов черты (см. features в items.mjs). Поля нового эффекта заполняет схема. */
const FEATURE_TYPES = ["attribute", "reaction", "skill", "spell"];

/** Один лист на все типы предметов: поля тела берутся из шаблона templates/item/<тип>.hbs. */
export default class GMentorItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    // standard-form включает стандартную вёрстку Foundry для .form-group (подпись и поле в строку)
    classes: ["gmentor", "item", "standard-form", "themed", "theme-light"],
    position: { width: 600, height: "auto" },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      addModifier: GMentorItemSheet.#onAddModifier,
      deleteModifier: GMentorItemSheet.#onDeleteModifier,
      toggleModifier: GMentorItemSheet.#onToggleModifier,
      addFeature: GMentorItemSheet.#onAddFeature,
      deleteFeature: GMentorItemSheet.#onDeleteFeature
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
        cr: { 0: "—", 6: "6", 9: "9", 12: "12", 15: "15" },
        costType: { percentage: "GMENTOR.CostType.percentage", points: "GMENTOR.CostType.points",
          multiplier: "GMENTOR.CostType.multiplier" },
        affects: { total: "GMENTOR.Affects.total", base: "GMENTOR.Affects.base", levels: "GMENTOR.Affects.levels" },
        bonusTarget: Object.fromEntries(BONUS_TARGETS.map(key => [key, `GMENTOR.BonusTarget.${key}`])),
        compare: Object.fromEntries(COMPARE.map(key => [key, `GMENTOR.Compare.${key.replaceAll(" ", "-")}`]))
      },
      featureTypes: FEATURE_TYPES,
      expandedModifiers: Object.fromEntries([...this.#expandedModifiers].map(index => [index, true])),
      enrichedDescription: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        item.system.description, { secrets: item.isOwner, relativeTo: item }
      )
    });
    return context;
  }

  /**
   * Массив модификаторов из формы заменяет сохранённый целиком, а полей эффектов, пометки и ссылки в форме нет.
   * Дополняем каждый модификатор сохранёнными значениями, иначе обновление их сотрёт.
   * @inheritDoc
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const submitted = data.system?.modifiers;
    if ( submitted ) {
      data.system.modifiers = this.item.system.toObject().modifiers.map((m, i) => ({ ...m, ...submitted[i] }));
    }
    return data;
  }

  // Модификаторы хранятся массивом, поэтому меняем его целиком: так проще, чем адресовать элементы по индексу

  static #onAddModifier() {
    const modifiers = [...this.item.system.toObject().modifiers, { name: "", value: 0, enabled: true }];
    return this.item.update({ "system.modifiers": modifiers });
  }

  static #onDeleteModifier(event, target) {
    const modifiers = this.item.system.toObject().modifiers;
    modifiers.splice(Number(target.dataset.index), 1);
    // Индексы после удалённого сдвигаются, раскрытые строки проще свернуть
    this.#expandedModifiers.clear();
    return this.item.update({ "system.modifiers": modifiers });
  }

  /** Раскрыть строку модификатора с пометкой, ссылкой и эффектами. */
  static #onToggleModifier(event, target) {
    const index = Number(target.dataset.index);
    if ( this.#expandedModifiers.has(index) ) this.#expandedModifiers.delete(index);
    else this.#expandedModifiers.add(index);
    return this.render();
  }

  static #onAddFeature(event, target) {
    return this.#updateFeatures(target.dataset.modifier, features => features.push({ type: target.dataset.type }));
  }

  static #onDeleteFeature(event, target) {
    return this.#updateFeatures(target.dataset.modifier, features => features.splice(Number(target.dataset.index), 1));
  }

  /**
   * Изменить эффекты черты (modifier — пустая строка) или модификатора с индексом modifier.
   * Элемент массива по пути обновить нельзя, поэтому массив модификаторов отправляем целиком.
   */
  #updateFeatures(modifier, change) {
    const source = this.item.system.toObject();
    if ( modifier === "" ) {
      change(source.features);
      return this.item.update({ "system.features": source.features });
    }
    change(source.modifiers[Number(modifier)].features);
    return this.item.update({ "system.modifiers": source.modifiers });
  }

  /** Модификаторы, у которых раскрыта строка с подробностями (индексы). */
  #expandedModifiers = new Set();
}
