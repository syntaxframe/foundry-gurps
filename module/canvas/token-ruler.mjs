import { movementBands } from "../rules.mjs";

/**
 * Линейка перемещения токена: клетки и отрезки пути окрашиваются по тому, сколько персонаж проходит за ход
 * (rules.movementBands): шаг, полное Движение, рывок, дальше — не успевает.
 */
export default class GMentorTokenRuler extends foundry.canvas.placeables.tokens.TokenRuler {
  static BAND_COLORS = { step: 0x4e98e0, move: 0x3cb043, sprint: 0xf0b400, beyond: 0xd9392b };

  /** @override */
  _getGridHighlightStyle(waypoint, offset) {
    return this.#withBandColor(super._getGridHighlightStyle(waypoint, offset), waypoint);
  }

  /** @override */
  _getSegmentStyle(waypoint) {
    return this.#withBandColor(super._getSegmentStyle(waypoint), waypoint);
  }

  #withBandColor(style, waypoint) {
    const move = this.token.actor?.system.move?.current;
    if ( move === undefined ) return style;
    return { ...style, color: GMentorTokenRuler.BAND_COLORS[this.#band(waypoint.measurement.cost, move)] };
  }

  /** Стоимость пути с начала хода — в тех же единицах сцены, что и Движение (ярды). */
  #band(cost, move) {
    const bands = movementBands(move);
    return ["step", "move", "sprint"].find(band => cost <= bands[band]) ?? "beyond";
  }
}
