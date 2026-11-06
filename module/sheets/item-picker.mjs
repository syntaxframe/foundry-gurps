import { toIdentifier } from "../rules.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Окно выбора предмета из библиотеки (компендиума) с поиском по русскому и английскому названию
 * и фильтром по папке, как библиотечная панель GMentor. Библиотек бывает несколько: системная
 * и импортированные из GCS (см. ItemPicker.librariesFor). После выбора окно остаётся открытым,
 * чтобы добавить несколько записей подряд.
 */
export default class ItemPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {string} options.type  Тип предмета
   * @param {CompendiumCollection[]} options.packs  Библиотеки этого типа, первая — по умолчанию
   * @param {(uuid: string) => Promise<Item|null>} options.onPick  Добавить выбранную запись; null — игрок отказался
   * @param {() => Promise} options.onBlank  Создать пустой предмет
   */
  constructor({ type, packs, onPick, onBlank, ...options }) {
    super(options);
    this.#type = type;
    this.#packs = packs;
    this.#pack = packs.find(pack => pack.collection === ItemPicker.#lastLibrary.get(type)) ?? packs[0];
    this.#onPick = onPick;
    this.#onBlank = onBlank;
  }

  /** Последняя выбранная библиотека по типу предмета (до перезагрузки страницы). */
  static #lastLibrary = new Map();

  /**
   * Библиотеки для типа предмета: системная (CONFIG.GMENTOR.libraries) и компендиумы, импортированные
   * из библиотек GCS (флаг gmentor.itemType). Пустой список — библиотек нет.
   * @param {string} type
   * @returns {CompendiumCollection[]}
   */
  static librariesFor(type) {
    const system = game.packs.get(CONFIG.GMENTOR.libraries[type]);
    const imported = game.packs.filter(pack => pack.metadata.flags?.gmentor?.itemType === type)
      .sort((a, b) => ItemPicker.#libraryName(a).localeCompare(ItemPicker.#libraryName(b), game.i18n.lang));
    return [system, ...imported].filter(Boolean);
  }

  /** Название библиотеки: у импортированной — название файла GCS («Shadowrun»), у системной — компендиума. */
  static #libraryName(pack) {
    return pack.metadata.flags?.gmentor?.library ?? pack.title;
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

  #type;
  #packs;
  #pack;
  #onPick;
  #onBlank;

  /** @override */
  get title() {
    return game.i18n.format("GMENTOR.PickerTitle", { type: game.i18n.localize(`TYPES.Item.${this.#type}`) });
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
      // Папка и все её родители: фильтр по папке показывает и содержимое вложенных
      folders: this.#folderChain(entry.folder).join(" "),
      summary: this.#summary(entry)
    }));
    entries.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    const folders = this.#folderOptions();
    return Object.assign(context, {
      entries,
      // Одна библиотека — выбирать нечего; без папок фильтр не показываем
      libraries: this.#packs.length > 1
        ? this.#packs.map(pack => ({ value: pack.collection, label: ItemPicker.#libraryName(pack) }))
        : null,
      library: this.#pack.collection,
      folders: folders.length ? folders : null
    });
  }

  /** id папки и её родителей. */
  #folderChain(folderId) {
    const folder = this.#pack.folders.get(folderId);
    return folder ? [folder.id, ...folder.ancestors.map(ancestor => ancestor.id)] : [];
  }

  /** Папки деревом: вложенные — сразу после родителя, с отступом. */
  #folderOptions() {
    const options = [];
    const add = (parentId, depth) => {
      const children = this.#pack.folders.filter(folder => (folder.folder?.id ?? null) === parentId)
        .sort((a, b) => a.sort - b.sort);
      for ( const folder of children ) {
        options.push({ value: folder.id, label: `${"\u00a0\u00a0".repeat(depth)}${folder.name}` });
        add(folder.id, depth + 1);
      }
    };
    add(null, 0);
    return options;
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
    this.element.querySelector("select[name=library]")?.addEventListener("change", event => this.#switchLibrary(event.target.value));
    // Фильтруем уже отрисованный список, без перерисовки: поиск должен откликаться на каждую букву
    const filter = () => this.#filter(search.value, folder?.value ?? "");
    search.addEventListener("input", filter);
    folder?.addEventListener("change", filter);
    search.focus();
  }

  /** Другая библиотека: список и папки перерисовываются. */
  #switchLibrary(collection) {
    this.#pack = this.#packs.find(pack => pack.collection === collection) ?? this.#pack;
    ItemPicker.#lastLibrary.set(this.#type, this.#pack.collection);
    this.render();
  }

  /** Строка подходит, если запрос есть в русском названии или в английском идентификаторе. */
  #filter(query, folder) {
    const text = query.trim().toLowerCase();
    const identifier = toIdentifier(query);
    for ( const row of this.element.querySelectorAll(".picker-entry") ) {
      const matchesText = !text || row.dataset.name.includes(text) || (!!identifier && row.dataset.identifier.includes(identifier));
      const matchesFolder = !folder || row.dataset.folders.split(" ").includes(folder);
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
