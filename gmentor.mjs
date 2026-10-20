import GMentorTokenRuler from "./module/canvas/token-ruler.mjs";
import { onRenderChatMessage } from "./module/chat.mjs";
import { registerConditions } from "./module/conditions.mjs";
import { importLibraryFromFile } from "./module/gcs-import.mjs";
import CharacterData from "./module/data/character.mjs";
import { AdvantageData, EquipmentData, SkillData, SpellData } from "./module/data/items.mjs";
import GMentorActor from "./module/documents/actor.mjs";
import CharacterSheet from "./module/sheets/character-sheet.mjs";
import GMentorItemSheet from "./module/sheets/item-sheet.mjs";

Hooks.once("init", () => {
  // Модели данных: Foundry создаёт их для поля system у документов соответствующего типа
  CONFIG.Actor.documentClass = GMentorActor;
  CONFIG.Actor.dataModels.character = CharacterData;
  Object.assign(CONFIG.Item.dataModels, {
    advantage: AdvantageData,
    skill: SkillData,
    spell: SpellData,
    equipment: EquipmentData
  });

  // Библиотеки, из которых кнопка «+» на листе предлагает предметы: тип предмета → id компендиума
  CONFIG.GMENTOR = {
    libraries: {
      advantage: "gmentor.advantages", skill: "gmentor.skills", spell: "gmentor.spells", equipment: "gmentor.equipment"
    }
  };

  // Линейка перемещения: цвет пути по шагу, Движению и рывку
  CONFIG.Token.rulerClass = GMentorTokenRuler;

  CONFIG.Actor.trackableAttributes.character = { bar: ["hp", "fp"], value: [] };
  registerConditions();

  const { Actors, Items } = foundry.documents.collections;
  Actors.registerSheet("gmentor", CharacterSheet, {
    types: ["character"], makeDefault: true, label: "GMENTOR.Sheet.Character", themes: null
  });
  Items.registerSheet("gmentor", GMentorItemSheet, { makeDefault: true, label: "GMENTOR.Sheet.Item", themes: null });

  foundry.applications.handlebars.loadTemplates([
    "systems/gmentor/templates/actor/item-row.hbs",
    "systems/gmentor/templates/actor/list-header.hbs",
    "systems/gmentor/templates/actor/learned-values.hbs",
    "systems/gmentor/templates/actor/weapon-modes.hbs",
    "systems/gmentor/templates/item/features.hbs",
    "systems/gmentor/templates/item/setup-modifiers.hbs",
    "systems/gmentor/templates/item/setup-placeholders.hbs"
  ]);
});

// Кнопка «Списать энергию» в сообщении о сотворении заклинания
Hooks.on("renderChatMessageHTML", onRenderChatMessage);

// Кнопка «Импорт библиотеки GCS» на вкладке компендиумов: создавать компендиумы мира может только ведущий
Hooks.on("renderCompendiumDirectory", (directory, html) => {
  if ( !game.user.isGM || html.querySelector(".gmentor-import-library") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gmentor-import-library";
  button.innerHTML = `<i class="fa-solid fa-file-import" inert></i><span>${game.i18n.localize("GMENTOR.Import.libraryTitle")}</span>`;
  button.addEventListener("click", importLibraryFromFile);
  html.querySelector(".header-actions")?.append(button);
});
