import { CONDITIONS, CONDITION_GROUPS, conditionDescription } from "../conditions.mjs";
import { PROFILE_FIELDS } from "../data/character.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

const TEMPLATES = "systems/gmentor/templates/actor";

/**
 * Характеристики, которые на листе вводятся итогом, как в GMentor.
 * path — хранимое поле (купленный уровень), stat — объект модели, result — имя поля итога в нём.
 */
const ATTRIBUTE_ROWS = ["st", "dx", "iq", "ht"].map(key => ({
  key, path: `system.attributes.${key}.value`, stat: s => s.attributes[key], result: "total", roll: true
}));
const SECONDARY_ROWS = [
  { key: "hp", path: "system.hp.mod", stat: s => s.hp, result: "max" },
  { key: "move", path: "system.move.mod", stat: s => s.move, result: "value" },
  { key: "speed", path: "system.speed.mod", stat: s => s.speed, result: "value", step: 0.25 },
  { key: "will", path: "system.will.mod", stat: s => s.will, result: "value", roll: true },
  { key: "per", path: "system.per.mod", stat: s => s.per, result: "value", roll: true },
  { key: "fp", path: "system.fp.mod", stat: s => s.fp, result: "max" }
];

/** Хранимые поля, от которых зависит максимум ЕЖ и ЕУ (бонусы эффектов здесь не учитываются). */
const POOL_SOURCES = {
  hp: ["system.attributes.st.value", "system.hp.mod"],
  fp: ["system.attributes.ht.value", "system.fp.mod"]
};

/** «Раны» можно вводить выражением, как в GMentor: "3+4+2". Пустое поле — 0, некорректное — null. */
function evaluateLost(text) {
  const expression = String(text ?? "").trim();
  if ( !expression ) return 0;
  if ( !/^[\d\s+\-*/().]+$/.test(expression) ) return null;
  try {
    const result = Roll.safeEval(expression);
    return Number.isFinite(result) ? Math.round(result) : null;
  } catch {
    return null;
  }
}

export default class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    // Лист всегда светлый, как GMentor, независимо от темы интерфейса Foundry
    classes: ["gmentor", "character", "themed", "theme-light"],
    position: {},
    window: { resizable: true },
    // Сохраняем при каждом изменении поля, как в GMentor: пересчёт сразу виден на листе
    form: { submitOnChange: true },
    actions: {
      roll: CharacterSheet.#onRoll,
      rollDamage: CharacterSheet.#onRollDamage,
      createItem: CharacterSheet.#onCreateItem,
      editItem: CharacterSheet.#onEditItem,
      deleteItem: CharacterSheet.#onDeleteItem,
      addCondition: CharacterSheet.#onAddCondition,
      removeCondition: CharacterSheet.#onRemoveCondition,
      toggleConditionDescription: CharacterSheet.#onToggleConditionDescription
    }
  };

  static PARTS = {
    header: { template: `${TEMPLATES}/header.hbs` },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    stats: { template: `${TEMPLATES}/stats.hbs`, scrollable: [""] },
    traits: { template: `${TEMPLATES}/traits.hbs`, scrollable: [""] },
    skills: { template: `${TEMPLATES}/skills.hbs`, scrollable: [""] },
    equipment: { template: `${TEMPLATES}/equipment.hbs`, scrollable: [""] },
    notes: { template: `${TEMPLATES}/notes.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [{ id: "stats" }, { id: "traits" }, { id: "skills" }, { id: "equipment" }, { id: "notes" }],
      initial: "stats",
      labelPrefix: "GMENTOR.Tab"
    }
  };

  /**
   * Размер окна при открытии — почти весь экран, но не больше 1200×1000. В DEFAULT_OPTIONS его не задать:
   * размер экрана известен только в момент открытия. Явно переданные размеры не трогаем.
   * @inheritDoc
   */
  _initializeApplicationOptions(options) {
    const { width, height } = options.position ?? {};
    options = super._initializeApplicationOptions(options);
    options.position.width = width ?? Math.min(1200, window.innerWidth - 100);
    options.position.height = height ?? Math.min(1000, window.innerHeight - 60);
    return options;
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;
    const byKind = items => items.sort((a, b) => a.sort - b.sort);
    const advantages = byKind(actor.itemTypes.advantage);
    Object.assign(context, {
      actor,
      system,
      profile: this.#prepareProfile(),
      conditions: this.#prepareConditions(),
      temporary: Object.fromEntries([...this.#temporary].map(key => [key, true])),
      attributeRows: ATTRIBUTE_ROWS.map(row => this.#prepareRow(row)),
      secondaryRows: SECONDARY_ROWS.map(row => this.#prepareRow(row)),
      // Бросаем то же, что показано на плитке, чтобы округление урона совпадало
      damageTiles: [
        { label: "GMENTOR.Thrust", value: system.damage.thr },
        { label: "GMENTOR.Swing", value: system.damage.sw },
        { label: "GMENTOR.Punch", value: system.damage.punch },
        { label: "GMENTOR.Kick", value: system.damage.kick }
      ].map(tile => ({ ...tile, damage: `${tile.value} cr` })),
      advantages: advantages.filter(i => (i.system.cost >= 0) && !i.system.quirk),
      disadvantages: advantages.filter(i => (i.system.cost < 0) && !i.system.quirk),
      quirks: advantages.filter(i => i.system.quirk),
      skills: byKind(actor.itemTypes.skill),
      spells: byKind(actor.itemTypes.spell),
      equipment: byKind(actor.itemTypes.equipment),
      weapons: actor.itemTypes.equipment.filter(i => i.system.isWeapon && (i.system.state === "equipped")),
      enrichedNotes: await foundry.applications.ux.TextEditor.implementation.enrichHTML(system.notes, {
        secrets: actor.isOwner, relativeTo: actor
      })
    });
    return context;
  }

  /**
   * Поля блока profile в порядке GMentor. Имя, ТУ и МР лежат вне system.profile, поэтому вставлены вручную.
   * @returns {{name: string, value: string|number, label: string, type: string}[]}
   */
  #prepareProfile() {
    const { name, system } = this.actor;
    const text = key => ({ name: `system.profile.${key}`, value: system.profile[key], label: `GMENTOR.Profile.${key}`, type: "text" });
    const fields = PROFILE_FIELDS.map(text);
    fields.unshift({ name: "name", value: name, label: "GMENTOR.Profile.name", type: "text" });
    // ТУ — после «Мира», МР — перед «Заметками», как в GMentor
    fields.splice(3, 0, { name: "system.tl", value: system.tl, label: "GMENTOR.TL", type: "number" });
    fields.splice(-1, 0, { name: "system.sm", value: system.sm, label: "GMENTOR.SM", type: "number", tooltip: "GMENTOR.SMHint" });
    fields.at(-1).type = "textarea";
    return fields;
  }

  #prepareRow({ key, path, stat, result, roll = false, step = 1 }) {
    const system = this.actor.system;
    const data = stat(system);
    // Пометка рядом со стоимостью, как move_add и will_add в GMentor
    let note = null;
    if ( (key === "move") && (system.move.current !== system.move.value) ) {
      note = { label: "GMENTOR.MoveNow", value: system.move.current };
    }
    if ( (key === "will") && (system.will.fright !== system.will.value) ) {
      note = { label: "GMENTOR.Fright", value: system.will.fright, roll: true };
    }
    return {
      key, path, roll, step, note,
      temporary: this.#temporary.has(key),
      value: data[result],
      cost: data.cost,
      warning: !!data.warning,
      abbr: `GMENTOR.Char.${key}.abbr`,
      name: `GMENTOR.Char.${key}.name`
    };
  }

  /**
   * Перед сохранением переводим итоги характеристик в купленные уровни, а «Раны» и «Потерю усталости» —
   * в текущие ЕЖ/ЕУ. Форма отправляется целиком, поэтому смещение считаем от текущих данных персонажа.
   * @inheritDoc
   */
  _processFormData(event, form, formData) {
    const data = formData.object;
    const actor = this.actor;
    for ( const row of [...ATTRIBUTE_ROWS, ...SECONDARY_ROWS] ) {
      if ( !(row.path in data) ) continue;
      const offset = row.stat(actor.system)[row.result] - foundry.utils.getProperty(actor, row.path);
      data[row.path] -= offset;
    }
    for ( const [key, sources] of Object.entries(POOL_SOURCES) ) {
      const pool = actor.system[key];
      // На сколько изменится максимум: ЕЖ = СЛ + куплено, ЕУ = ЗД + куплено
      const delta = sources.reduce((sum, path) =>
        sum + ((path in data) ? data[path] - foundry.utils.getProperty(actor, path) : 0), 0);
      const field = `${key}Lost`;
      const lost = (field in data) ? evaluateLost(data[field]) : null;
      delete data[field];
      // Правили потери — пересчитываем текущее значение. Иначе сдвигаем его вместе с максимумом, чтобы раны не менялись
      if ( (lost !== null) && (lost !== pool.lost) ) data[`system.${key}.value`] = pool.max + delta - lost;
      else if ( delta ) data[`system.${key}.value`] = pool.value + delta;
    }
    return super._processFormData(event, form, formData);
  }

  /** @inheritDoc */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    // Каждой части-вкладке передаём её описание, чтобы шаблон знал, активна ли она
    if ( partId in context.tabs ) context.tab = context.tabs[partId];
    return context;
  }

  /* -------------------------------------------- */
  /*  Действия                                    */
  /* -------------------------------------------- */

  /** Получить предмет по data-item-id ближайшего родителя кнопки. */
  #getItem(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return this.actor.items.get(id);
  }

  /** Бросок 3d6 на успех: data-target — значение, data-label — подпись. Shift+клик спрашивает модификатор. */
  static #onRoll(event, target) {
    const { label, value } = target.dataset;
    return this.actor.rollSuccess(label, Number(value), { askModifier: event.shiftKey });
  }

  static #onRollDamage(event, target) {
    const { label, damage } = target.dataset;
    return this.actor.rollDamage(label, damage);
  }

  static #onCreateItem(event, target) {
    const { type, ...system } = target.dataset;
    const name = game.i18n.format("DOCUMENT.New", { type: game.i18n.localize(CONFIG.Item.typeLabels[type]) });
    // Остальные data-атрибуты кнопки идут в system: так кнопка «Недостаток» создаёт предмет с basePoints < 0.
    // JSON.parse превращает "-10" в число и "true" в булево; обычные строки оставляем как есть
    for ( const [key, value] of Object.entries(system) ) {
      try { system[key] = JSON.parse(value); } catch { /* строка */ }
    }
    return this.actor.createEmbeddedDocuments("Item", [{ name, type, system }], { renderSheet: true });
  }

  static #onEditItem(event, target) {
    return this.#getItem(target)?.sheet.render({ force: true });
  }

  static #onDeleteItem(event, target) {
    return this.#getItem(target)?.deleteDialog();
  }

  /** Диалог выбора состояний по группам, как «Добавить временное состояние» в GMentor. */
  static async #onAddCondition() {
    const actor = this.actor;
    const html = await foundry.applications.handlebars.renderTemplate(`${TEMPLATES}/conditions-dialog.hbs`, {
      groups: CONDITION_GROUPS.map(group => ({
        group,
        label: `GMENTOR.ConditionGroup.${group}`,
        radio: group === "posture",
        conditions: CONDITIONS.filter(c => c.flags.gmentor.group === group).map(c => ({
          ...c, notes: `GMENTOR.Condition.${c.id}.notes`, active: actor.statuses.has(c.id),
          description: conditionDescription(c.id)
        }))
      })),
      standing: !CONDITIONS.some(c => (c.flags.gmentor.group === "posture") && actor.statuses.has(c.id))
    });
    const data = await foundry.applications.api.DialogV2.input({
      window: { title: "GMENTOR.ConditionsAdd" },
      position: { width: 720 },
      classes: ["gmentor", "conditions-dialog", "themed", "theme-light"],
      content: html,
      ok: { label: "GMENTOR.Apply", icon: "fa-solid fa-check" },
      // Кнопка ⓘ раскрывает полное описание под строкой, как в GMentor
      render: (event, dialog) => dialog.element.addEventListener("click", ev => {
        const button = ev.target.closest(".condition-info");
        if ( button ) button.closest(".condition-item").classList.toggle("expanded");
      })
    });
    if ( !data ) return;
    // Приводим статусы к отмеченным: поза — радиокнопка, остальное — флажки
    for ( const { id, flags } of CONDITIONS ) {
      const active = flags.gmentor.group === "posture" ? data.posture === id : !!data[id];
      if ( active !== actor.statuses.has(id) ) await actor.toggleStatusEffect(id, { active });
    }
  }

  /** Раскрыть описание состояния на листе. Запоминаем, чтобы оно не сворачивалось при перерисовке. */
  static #onToggleConditionDescription(event, target) {
    const row = target.closest("[data-effect-id]");
    const id = row.dataset.effectId;
    if ( this.#expanded.has(id) ) this.#expanded.delete(id);
    else this.#expanded.add(id);
    row.classList.toggle("expanded", this.#expanded.has(id));
  }

  static #onRemoveCondition(event, target) {
    const id = target.closest("[data-effect-id]")?.dataset.effectId;
    return this.actor.effects.get(id)?.delete();
  }

  /** Активные статусы персонажа: состояния GMentor и служебные статусы ядра (например, «Мёртв»). */
  #prepareConditions() {
    this.#temporary = new Set();
    const conditions = [];
    for ( const effect of this.actor.effects ) {
      if ( !effect.statuses.size ) continue;
      const statusId = [...effect.statuses][0];
      const gm = CONFIG.statusEffects[statusId]?.flags?.gmentor;
      if ( effect.active ) {
        for ( const change of effect.system.changes ) this.#temporary.add(change.key.replace("system.bonuses.", ""));
      }
      conditions.push({
        id: effect.id,
        name: effect.name,
        img: effect.img,
        notes: gm ? game.i18n.localize(`GMENTOR.Condition.${statusId}.notes`) : "",
        reference: gm?.reference ?? "",
        description: gm ? conditionDescription(statusId) : null,
        expanded: this.#expanded.has(effect.id)
      });
    }
    return conditions;
  }

  /** Бонусы, которые сейчас меняют состояния: такие значения подсвечиваются, как temporal в GMentor. */
  #temporary = new Set();

  /** Состояния, у которых на листе раскрыто описание (id эффектов). */
  #expanded = new Set();
}
