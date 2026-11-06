/**
 * Вопросы при добавлении предмета на персонажа, как в GMentor: сначала выбор модификаторов и самоконтроля
 * (editAdvantage), затем подстановка заглушек «@Кто@» (askForDogs). Работает с данными до создания предмета,
 * поэтому отмена просто ничего не добавляет.
 */

const TEMPLATES = "systems/gmentor/templates/item";

// Заглушка, которую заполняет игрок: «@Кто@», «@Оружие/Инструмент@»
const PLACEHOLDER = /@([^@]+)@/g;

/**
 * Задать вопросы по данным нового предмета.
 * @param {object} data  Данные предмета (toObject или game.items.fromCompendium); меняются на месте
 * @returns {Promise<object|null>}  Данные с ответами или null, если игрок отказался от добавления
 */
export async function setupItemData(data) {
  if ( data.type === "advantage" ) {
    const confirmed = await askModifiers(data);
    if ( !confirmed ) return null;
  }
  await askPlaceholders(data);
  return data;
}

/* -------------------------------------------- */
/*  Модификаторы и самоконтроль                 */
/* -------------------------------------------- */

/**
 * Диалог выбора модификаторов и самоконтроля. Черта без того и другого добавляется без вопросов.
 * У составной черты ещё и части: каждую можно не брать («Созвездия» — список на выбор), модификаторы части —
 * под ней.
 */
async function askModifiers(data) {
  const system = data.system;
  const components = system.components ?? [];
  if ( !system.modifiers.length && !system.cr && !components.length ) return true;
  const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATES}/setup-modifiers.hbs`, {
    price: components.length ? "" : priceLabel(system),
    modifiers: modifierRows(system.modifiers, "modifier", system.reference),
    components: components.map((component, index) => ({
      name: component.name,
      field: `component-${index}`,
      price: priceLabel(component, component.levels),
      modifiers: modifierRows(component.modifiers, `component-${index}-modifier`, component.reference)
    })),
    cr: system.cr,
    crChoices: Object.fromEntries([6, 9, 12, 15].map(cr => [cr, `GMENTOR.SelfControlLevel.${cr}`]))
  });
  const answer = await foundry.applications.api.DialogV2.input({
    window: { title: data.name },
    position: { width: 560 },
    classes: ["gmentor", "item-setup", "themed", "theme-light"],
    content,
    ok: { label: "GMENTOR.AddToCharacter", icon: "fa-solid fa-check" },
    render: (event, dialog) => dialog.element.addEventListener("change", disableGroupmates)
  });
  if ( !answer ) return false;
  system.modifiers.forEach((modifier, index) => modifier.enabled = !!answer[`modifier-${index}`]);
  components.forEach((component, index) => {
    component.modifiers.forEach((modifier, m) => modifier.enabled = !!answer[`component-${index}-modifier-${m}`]);
  });
  if ( components.length ) system.components = components.filter((component, index) => answer[`component-${index}`]);
  if ( system.cr ) system.cr = Number(answer.cr);
  return true;
}

/**
 * Строки модификаторов для окна: field — имя поля формы без индекса, ссылка — только если отличается от ссылки
 * черты. Между группами — разделитель, как перенос строки в окне GMentor. Группа в окне своя у каждой части.
 */
function modifierRows(modifiers, field, reference) {
  let previousGroup;
  return modifiers.map((modifier, index) => {
    const separated = (index > 0) && (modifier.group !== previousGroup);
    previousGroup = modifier.group;
    return {
      ...modifier,
      field: `${field}-${index}`,
      group: modifier.group ? `${field}:${modifier.group}` : "",
      separated,
      cost: modifierCostLabel(modifier),
      reference: modifier.reference !== reference ? modifier.reference : ""
    };
  });
}

/** Включённый в диалоге модификатор выключает остальные из своей группы (правило из AdvantageData). */
function disableGroupmates(event) {
  const box = event.target;
  if ( !box.checked || !box.dataset.group ) return;
  for ( const other of box.form.querySelectorAll(`input[data-group="${CSS.escape(box.dataset.group)}"]`) ) {
    if ( other !== box ) other.checked = false;
  }
}

/**
 * Базовая цена черты, как «Базовая стоимость» в GMentor: «15», «5/ур.», «5 + 10/ур.». С levels — ещё уровень
 * (у части составной черты он уже выбран): «4/ур. × 5».
 */
function priceLabel({ basePoints, pointsPerLevel }, levels) {
  const perLevel = game.i18n.format("GMENTOR.PerLevelPrice", { points: pointsPerLevel });
  if ( !pointsPerLevel ) return String(basePoints);
  const price = basePoints ? `${basePoints} + ${perLevel}` : perLevel;
  return levels ? `${price} × ${levels}` : price;
}

/** Цена модификатора: «+20%», «−4 очк.», «×2». */
function modifierCostLabel({ costType, value }) {
  if ( costType === "multiplier" ) return `×${value}`;
  if ( costType === "points" ) return `${value.signedString()} ${game.i18n.localize("GMENTOR.CostType.points")}`;
  return `${value.signedString()}%`;
}

/* -------------------------------------------- */
/*  Заглушки                                    */
/* -------------------------------------------- */

/** Диалог подстановки заглушек. Незаполненные остаются как есть, их можно исправить позже. */
async function askPlaceholders(data) {
  const placeholders = findPlaceholders(data);
  if ( !placeholders.length ) return;
  const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATES}/setup-placeholders.hbs`, { placeholders });
  const answer = await foundry.applications.api.DialogV2.input({
    window: { title: data.name },
    position: { width: 420 },
    classes: ["gmentor", "item-setup", "themed", "theme-light"],
    content,
    ok: { label: "GMENTOR.Apply", icon: "fa-solid fa-check" }
  });
  if ( !answer ) return;
  const values = new Map(placeholders.map((name, index) => [name, answer[`placeholder-${index}`]?.trim()]));
  const replace = text => text.replace(PLACEHOLDER, (match, name) => values.get(name) || match);
  data.name = replace(data.name);
  // Описание не трогаем: в HTML знак @ бывает и в ссылках Foundry (@UUID[…])
  const { description, ...fields } = data.system;
  data.system = { ...replaceStrings(fields, replace), description };
}

/**
 * Заглушки в названии, пометке, специализации, включённых модификаторах и эффектах, у составной черты —
 * и в её частях. Выключенные модификаторы не спрашиваем, как GMentor: их заглушки игроку не нужны.
 */
function findPlaceholders(data) {
  const system = data.system;
  const texts = [data.name, system.specialization, ...[system, ...(system.components ?? [])].flatMap(traitTexts)];
  const found = new Set();
  for ( const text of texts ) {
    if ( typeof text !== "string" ) continue;
    for ( const [, name] of text.matchAll(PLACEHOLDER) ) found.add(name);
  }
  return [...found];
}

/** Тексты черты, части черты или снаряжения, в которых бывают заглушки. */
function traitTexts(trait) {
  const activeModifiers = (trait.modifiers ?? []).filter(m => m.enabled);
  const features = [...(trait.features ?? []), ...activeModifiers.flatMap(m => m.features)];
  return [trait.name, trait.notes, ...activeModifiers.flatMap(m => [m.name, m.notes]),
    ...features.flatMap(feature => Object.values(feature))];
}

/** Применить replace ко всем строкам в объекте и массивах внутри него. */
function replaceStrings(value, replace) {
  if ( typeof value === "string" ) return replace(value);
  if ( Array.isArray(value) ) return value.map(v => replaceStrings(v, replace));
  if ( value && (typeof value === "object") ) {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, replaceStrings(v, replace)]));
  }
  return value;
}
