import { registerConditions } from "./module/conditions.mjs";
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
    "systems/gmentor/templates/actor/learned-values.hbs"
  ]);
});
