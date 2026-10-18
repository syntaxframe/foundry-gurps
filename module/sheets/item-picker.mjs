import { toIdentifier } from "../rules.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Окно выбора предмета из библиотеки (компендиума) с поиском по русскому и английскому названию
 * и фильтром по папке, как библиотечная панель GMentor. После выбора окно остаётся открытым,
 * чтобы добавить несколько записей подряд.
 */
export default class ItemPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {CompendiumCollection} options.pack  Библиотека
   * @param {(uuid: string) => Promise<Item|null>} options.onPick  Добавить выбранную запись; null — игрок отказался
   * @param {() => Promise} options.onBlank  Создать пустой предмет
   */
  constructor({ pack, onPick, onBlank, ...options }) {
    super(options);
    this.#pack = pack;
    this.#onPick = onPick;
    this.#onBlank = onBlank;
  }

  static DEFAULT_OPTIONS = {
    classes: ["gmentor", "item-picker", "themed", "theme-light"],
    position: { width: 560, height: 640 },
    window: { resizable: true },
    actions: {
      pick: ItemPicker.#onPickAction,
      blank: ItemPicker.#onBlankAction
    }
  };

  static PARTS = {
    body: { template: "systems/gmentor/templates/actor/item-picker.hbs", scrollable: [".picker-list"] }
  };

  #pack;
  #onPick;
  #onBlank;

  /** @override */
  get title() {
    return this.#pack.title;
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const index = await this.#pack.getIndex({ fields: ["folder", "system.identifier", "system.basePoints",
      "system.pointsPerLevel", "system.notes", "system.attribute", "system.difficulty", "system.techLevel", "system.value"] });
    const entries = index.contents.map(entry => ({
      uuid: entry.uuid,
      name: entry.name,
      search: entry.name.toLowerCase(),
      identifier: entry.system?.identifier ?? "",
      notes: entry.system?.notes ?? "",
      folder: entry.folder ?? "",
      summary: this.#summary(entry)
    }));
    entries.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    const folders = this.#pack.folders.contents.toSorted((a, b) => a.sort - b.sort);
    return Object.assign(context, {
      entries,
      // Без папок фильтр не показываем
      folders: folders.length ? Object.fromEntries(folders.map(f => [f.id, f.name])) : null
    });
  }

  /**
   * Короткая справка справа: цена черты («5 + 10/ур.»), атрибут и сложность умения («ЛВ/С»),
   * ТУ и цена снаряжения («ТУ3 · $520»).
   */
  #summary(entry) {
    const system = entry.system ?? {};
    if ( entry.type === "equipment" ) {
      const techLevel = system.techLevel ? `${game.i18n.localize("GMENTOR.TL")}${system.techLevel}` : "";
      return [techLevel, `$${system.value ?? 0}`].filter(Boolean).join(" · ");
    }
    if ( entry.type === "skill" ) {
      const attribute = game.i18n.localize(`GMENTOR.AttributeAbbr.${system.attribute}`);
      return `${attribute}/${game.i18n.localize(`GMENTOR.DifficultyAbbr.${system.difficulty}`)}`;
    }
    const base = system.basePoints ?? 0;
    const perLevel = system.pointsPerLevel ?? 0;
    if ( !perLevel ) return String(base);
    const levelPrice = game.i18n.format("GMENTOR.PerLevelPrice", { points: perLevel });
    return base ? `${base} + ${levelPrice}` : levelPrice;
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const search = this.element.querySelector("input[name=search]");
    const folder = this.element.querySelector("select[name=folder]");
    // Фильтруем уже отрисованный список, без перерисовки: поиск должен откликаться на каждую букву
    const filter = () => this.#filter(search.value, folder?.value ?? "");
    search.addEventListener("input", filter);
    folder?.addEventListener("change", filter);
    search.focus();
  }

  /** Строка подходит, если запрос есть в русском названии или в английском идентификаторе. */
  #filter(query, folder) {
    const text = query.trim().toLowerCase();
    const identifier = toIdentifier(query);
    for ( const row of this.element.querySelectorAll(".picker-entry") ) {
      const matchesText = !text || row.dataset.name.includes(text) || (!!identifier && row.dataset.identifier.includes(identifier));
      const matchesFolder = !folder || (row.dataset.folder === folder);
      row.hidden = !(matchesText && matchesFolder);
    }
  }

  static async #onPickAction(event, target) {
    const row = target.closest(".picker-entry");
    const item = await this.#onPick(row.dataset.uuid);
    // Отмечаем добавленное, чтобы было видно, что клик сработал
    if ( item ) row.classList.add("added");
  }

  static async #onBlankAction() {
    await this.close();
    return this.#onBlank();
  }
}
