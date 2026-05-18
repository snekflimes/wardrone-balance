import { BALANCE_CONSTANTS, type BalanceConstants } from './model';

/**
 * Прогноз попыток в конструкторе уровней: состав волн — из редактора,
 * базовые статы врагов и VIP — из constants.json (не из localStorage/API).
 */
export function balanceForForecastSimulation(runtime: BalanceConstants): BalanceConstants {
  return {
    ...runtime,
    enemies: BALANCE_CONSTANTS.enemies,
    player: BALANCE_CONSTANTS.player,
    weaponVsEnemyModifiers: BALANCE_CONSTANTS.weaponVsEnemyModifiers,
  };
}
