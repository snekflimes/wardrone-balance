import constantsJson from '../../balance/constants.json';
import { BALANCE_CONSTANTS, type BalanceConstants } from './model';

/**
 * Прогноз попыток в конструкторе уровней:
 * - состав волн — из редактора (referenceWavesConfig);
 * - бой и прогрессия — из constants.json / BALANCE_CONSTANTS, не из localStorage/API.
 *
 * Иначе сохранённые HP врагов, урон оружия и награды раздувают число попыток.
 */
export function balanceForForecastSimulation(runtime: BalanceConstants): BalanceConstants {
  const bundled = constantsJson as unknown as BalanceConstants;
  return {
    ...bundled,
    meta: {
      ...bundled.meta,
      gameLevels: runtime.meta.gameLevels,
    },
    enemies: BALANCE_CONSTANTS.enemies,
    player: BALANCE_CONSTANTS.player,
    weapons: BALANCE_CONSTANTS.weapons,
    weaponVsEnemyModifiers: BALANCE_CONSTANTS.weaponVsEnemyModifiers,
    economy: BALANCE_CONSTANTS.economy,
    cardUpgradeCosts: BALANCE_CONSTANTS.cardUpgradeCosts,
    // Карты из json (не SUPPORT_CARD_REFERENCE), иначе L2 проходится за ~5 попыток.
    supportCards: bundled.supportCards,
  };
}
