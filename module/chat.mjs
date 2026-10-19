/**
 * Кнопки в сообщениях чата. Сообщение — готовый HTML, поэтому обработчики вешаются при каждой отрисовке.
 */
export function onRenderChatMessage(message, html) {
  const spend = html.querySelector("[data-action=spendCastingEnergy]");
  if ( !spend ) return;
  // Энергию списывают один раз: после этого кнопка остаётся надписью
  if ( message.getFlag("gmentor", "energy")?.spent ) {
    spend.disabled = true;
    spend.textContent = game.i18n.localize("GMENTOR.SpellCast.spentDone");
    return;
  }
  spend.addEventListener("click", async () => {
    const actor = ChatMessage.getSpeakerActor(message.speaker);
    if ( !actor?.isOwner ) return ui.notifications.warn(game.i18n.localize("GMENTOR.SpellCast.notOwner"));
    spend.disabled = true;
    await actor.spendCastingEnergy(message);
  });
}
