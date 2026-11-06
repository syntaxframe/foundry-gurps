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
      addComponent: GMentorItemSheet.#onAddComponent,
      deleteComponent: GMentorItemSheet.#onDeleteComponent,
      toggleComponent: GMentorItemSheet.#onToggleComponent,
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
      enrichedDescription: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        item.system.description, { secrets: item.isOwner, relativeTo: item }
      )
    });
    if ( item.type === "advantage" ) {
      context.trait = this.#traitView(item.system, "");
      context.components = item.system.components.map((component, index) => ({
        ...this.#traitView(component, index),
        expanded: this.#expandedComponents.has(index),
        enabledModifiers: component.modifiers.filter(m => m.enabled).map(m => m.notes ? `${m.name} (${m.notes})` : m.name).join("; ")
      }));
    }
    return context;
  }

  /**
   * Данные для партиала trait-fields.hbs: сама черта (component — пустая строка) или её часть с индексом component.
   * У модификатора — имя в форме и раскрыта ли строка подробностей. У составной черты цена — в частях, свои
   * поля цены скрыты, пока пусты; у части с ценой за уровень уровень — в её строке, в подробностях не дублируется.
   */
  #traitView(trait, component) {
    const prefix = (component === "") ? "system" : `system.components.${component}`;
    const isComponent = component !== "";
    const composite = !isComponent && (trait.components.length > 0);
    const ownCost = trait.basePoints || trait.pointsPerLevel || trait.levels || trait.cr || trait.roundDown;
    return {
      ...trait,
      prefix,
      component,
      isComponent,
      showCost: !composite || !!ownCost,
      showLevels: !(isComponent && trait.pointsPerLevel),
      modifierRows: trait.modifiers.map((modifier, index) => ({
        ...modifier,
        index,
        component,
        field: `${prefix}.modifiers.${index}`,
        expanded: this.#expandedModifiers.has(`${component}:${index}`)
      }))
    };
  }

  /**
   * Массивы модификаторов и частей из формы заменяют сохранённые целиком, а части полей в форме нет
   * (см. withSavedModifiers): дополняем их сохранёнными значениями, иначе обновление их сотрёт.
   * @inheritDoc
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    if ( this.item.type !== "advantage" || !data.system ) return data;
    const source = this.item.system.toObject();
    if ( data.system.modifiers ) data.system.modifiers = withSavedModifiers(source.modifiers, data.system.modifiers);
    // Части приходят так же: у свёрнутой части в форме только название и уровень
    const submitted = data.system.components;
    if ( submitted ) {
      data.system.components = source.components.map((component, index) => {
        const fields = submitted[index] ?? {};
        const merged = { ...component, ...fields };
        if ( fields.modifiers ) merged.modifiers = withSavedModifiers(component.modifiers, fields.modifiers);
        return merged;
      });
    }
    return data;
  }

  // Части и модификаторы хранятся массивами, поэтому меняем их целиком: так проще, чем адресовать элементы по индексу

  static #onAddComponent() {
    const components = [...this.item.system.toObject().components, { name: "" }];
    this.#expandedComponents.add(components.length - 1);
    return this.item.update({ "system.components": components });
  }

  static #onDeleteComponent(event, target) {
    const components = this.item.system.toObject().components;
    components.splice(Number(target.dataset.component), 1);
    // Индексы после удалённой части сдвигаются, раскрытые строки проще свернуть
    this.#expandedComponents.clear();
    this.#expandedModifiers.clear();
    return this.item.update({ "system.components": components });
  }

  /** Раскрыть часть составной черты: её цена, модификаторы и эффекты. */
  static #onToggleComponent(event, target) {
    const index = Number(target.dataset.component);
    if ( this.#expandedComponents.has(index) ) this.#expandedComponents.delete(index);
    else this.#expandedComponents.add(index);
    return this.render();
  }

  static #onAddModifier(event, target) {
    return this.#updateTrait(target.dataset.component, trait => trait.modifiers.push({ name: "", value: 0, enabled: true }));
  }

  static #onDeleteModifier(event, target) {
    // Индексы после удалённого сдвигаются, раскрытые строки проще свернуть
    this.#expandedModifiers.clear();
    return this.#updateTrait(target.dataset.component, trait => trait.modifiers.splice(Number(target.dataset.index), 1));
  }

  /** Раскрыть строку модификатора с пометкой, ссылкой и эффектами. */
  static #onToggleModifier(event, target) {
    const key = `${target.dataset.component ?? ""}:${target.dataset.index}`;
    if ( this.#expandedModifiers.has(key) ) this.#expandedModifiers.delete(key);
    else this.#expandedModifiers.add(key);
    return this.render();
  }

  static #onAddFeature(event, target) {
    const { component, modifier, type } = target.dataset;
    return this.#updateFeatures(component, modifier, features => features.push({ type }));
  }

  static #onDeleteFeature(event, target) {
    const { component, modifier, index } = target.dataset;
    return this.#updateFeatures(component, modifier, features => features.splice(Number(index), 1));
  }

  /** Изменить эффекты черты или её части (modifier — пустая строка) или модификатора с индексом modifier. */
  #updateFeatures(component, modifier, change) {
    return this.#updateTrait(component, trait => change((modifier === "") ? trait.features : trait.modifiers[Number(modifier)].features));
  }

  /**
   * Изменить черту или снаряжение (component пустой) или часть черты с индексом component.
   * Элемент массива по пути обновить нельзя, поэтому отправляем массивы целиком.
   */
  #updateTrait(component, change) {
    const source = this.item.system.toObject();
    if ( !component ) {
      change(source);
      const changes = { "system.features": source.features };
      // У снаряжения модификаторов нет
      if ( source.modifiers ) changes["system.modifiers"] = source.modifiers;
      return this.item.update(changes);
    }
    change(source.components[Number(component)]);
    return this.item.update({ "system.components": source.components });
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

  /** Модификаторы, у которых раскрыта строка с подробностями: «часть:индекс», у самой черты часть пустая. */
  #expandedModifiers = new Set();

  /** Раскрытые части составной черты (индексы). */
  #expandedComponents = new Set();
}

/**
 * Массив модификаторов из формы заменяет сохранённый целиком, а полей эффектов, пометки и ссылки в форме нет,
 * пока строка не раскрыта. Дополняем каждый модификатор сохранёнными значениями, иначе обновление их сотрёт.
 */
function withSavedModifiers(saved, submitted) {
  return saved.map((modifier, index) => ({ ...modifier, ...submitted[index] }));
}
