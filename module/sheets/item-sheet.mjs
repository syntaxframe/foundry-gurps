import { VEHICLE_FIELDS, WEAPON_DEFAULT_TYPES } from "../data/items.mjs";
import { BONUS_TARGETS, COMPARE, COST_REDUCTION_ATTRIBUTES, DR_LOCATIONS } from "../rules.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

const TEMPLATES = "systems/gmentor/templates/item";

/** Типы эффектов черты и снаряжения (см. features в items.mjs). Поля нового эффекта заполняет схема. */
const FEATURE_TYPES = ["attribute", "dr", "reaction", "skill", "spell", "wealth", "costReduction"];

/** Текстовые поля режимов оружия в порядке таблицы на листе персонажа (см. weaponMode в items.mjs). */
const WEAPON_FIELDS = {
  melee: ["usage", "damage", "reach", "parry", "block", "minSt"],
  ranged: ["usage", "damage", "accuracy", "range", "rateOfFire", "shots", "ammo", "bulk", "recoil", "minSt"]
};

/**
 * Поля изменений модификатора оружия по типам (см. weaponModifiers в items.mjs). Числовые поля — по имени,
 * perDice — флажок, damageType — текстовое поле value.
 */
const WEAPON_MODIFIER_FIELDS = {
  damage: ["amount", "perDice"],
  armorDivisor: ["value"],
  damageType: ["damageType"],
  accuracy: ["amount"],
  scope: ["amount"],
  range: ["multiplier"],
  skill: ["amount"],
  cost: ["multiplier"],
  weight: ["multiplier"]
};

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
      deleteFeature: GMentorItemSheet.#onDeleteFeature,
      addWeapon: GMentorItemSheet.#onAddWeapon,
      deleteWeapon: GMentorItemSheet.#onDeleteWeapon,
      addWeaponDefault: GMentorItemSheet.#onAddWeaponDefault,
      deleteWeaponDefault: GMentorItemSheet.#onDeleteWeaponDefault,
      addWeaponModifier: GMentorItemSheet.#onAddWeaponModifier,
      deleteWeaponModifier: GMentorItemSheet.#onDeleteWeaponModifier,
      addVehicle: GMentorItemSheet.#onAddVehicle,
      deleteVehicle: GMentorItemSheet.#onDeleteVehicle,
      addVehicleDefault: GMentorItemSheet.#onAddVehicleDefault,
      deleteVehicleDefault: GMentorItemSheet.#onDeleteVehicleDefault,
      addPrereq: GMentorItemSheet.#onAddPrereq,
      deletePrereq: GMentorItemSheet.#onDeletePrereq
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
        costAttribute: Object.fromEntries(COST_REDUCTION_ATTRIBUTES.map(key => [key, `GMENTOR.BonusTarget.${key}`])),
        compare: Object.fromEntries(COMPARE.map(key => [key, `GMENTOR.Compare.${key.replaceAll(" ", "-")}`])),
        drLocation: Object.fromEntries(DR_LOCATIONS.map(key => [key, `GMENTOR.Location.${key}`])),
        defaultType: Object.fromEntries(WEAPON_DEFAULT_TYPES.map(key =>
          [key, key === "skill" ? "GMENTOR.Skill" : `GMENTOR.Attribute.${key}`]))
      },
      featureTypes: FEATURE_TYPES,
      weaponModes: Object.keys(WEAPON_FIELDS),
      weaponFields: WEAPON_FIELDS,
      vehicleFields: VEHICLE_FIELDS,
      weaponModifierTypes: Object.keys(WEAPON_MODIFIER_FIELDS),
      weaponModifierFields: WEAPON_MODIFIER_FIELDS,
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

  // Режимы оружия тоже массив: добавление и удаление отправляют его целиком

  static #onAddWeapon(event, target) {
    return this.#updateWeapons(weapons => weapons.push({ type: target.dataset.type }));
  }

  static #onDeleteWeapon(event, target) {
    return this.#updateWeapons(weapons => weapons.splice(Number(target.dataset.index), 1));
  }

  static #onAddWeaponDefault(event, target) {
    return this.#updateWeapons(weapons => weapons[Number(target.dataset.index)].defaults.push({}));
  }

  static #onDeleteWeaponDefault(event, target) {
    const { index, default: entry } = target.dataset;
    return this.#updateWeapons(weapons => weapons[Number(index)].defaults.splice(Number(entry), 1));
  }

  static #onAddWeaponModifier(event, target) {
    const changes = [...this.item.system.toObject().weaponModifiers, { type: target.dataset.type }];
    return this.item.update({ "system.weaponModifiers": changes });
  }

  static #onDeleteWeaponModifier(event, target) {
    const changes = this.item.system.toObject().weaponModifiers;
    changes.splice(Number(target.dataset.index), 1);
    return this.item.update({ "system.weaponModifiers": changes });
  }

  // Транспорт — один объект с умолчаниями; пустой объект схема заполнит пустыми полями

  static #onAddVehicle() {
    return this.item.update({ "system.vehicle": {} });
  }

  static #onDeleteVehicle() {
    return this.item.update({ "system.vehicle": null });
  }

  static #onAddVehicleDefault() {
    const defaults = [...this.item.system.toObject().vehicle.defaults, {}];
    return this.item.update({ "system.vehicle.defaults": defaults });
  }

  static #onDeleteVehicleDefault(event, target) {
    const defaults = this.item.system.toObject().vehicle.defaults;
    defaults.splice(Number(target.dataset.default), 1);
    return this.item.update({ "system.vehicle.defaults": defaults });
  }

  static #onAddPrereq(event, target) {
    const prereqs = [...this.item.system.toObject().prereqs, { type: target.dataset.type }];
    return this.item.update({ "system.prereqs": prereqs });
  }

  static #onDeletePrereq(event, target) {
    const prereqs = this.item.system.toObject().prereqs;
    prereqs.splice(Number(target.dataset.index), 1);
    return this.item.update({ "system.prereqs": prereqs });
  }

  #updateWeapons(change) {
    const weapons = this.item.system.toObject().weapons;
    change(weapons);
    return this.item.update({ "system.weapons": weapons });
  }

  /** Модификаторы, у которых раскрыта строка с подробностями (индексы). */
  #expandedModifiers = new Set();
}
