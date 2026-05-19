import constantsJson from '../../balance/constants.json';
import { BALANCE_CONSTANTS, type BalanceConstants } from './model';

/**
 * Прогноз попыток в конструкторе уровней:
 * - состав волн — из редактора (referenceWavesConfig);
 * - бой: HP/урон/калибровка — из constants.json / BALANCE_CONSTANTS;
 * - экономика наград (база боя, бонус победы, сундуки, логин) — из runtime (вкладка «Экономика»).
 *
 * Иначе сохранённые HP врагов и combatSkill из localStorage раздувают число попыток.
 */
export function balanceForForecastSimulation(runtime: BalanceConstants): BalanceConstants {
  const bundled = constantsJson as unknown as BalanceConstants;
  const baseEconomy = BALANCE_CONSTANTS.economy;
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
    economy: {
      ...baseEconomy,
      ...runtime.economy,
      combatSkill: {
        ...baseEconomy.combatSkill,
        ...runtime.economy.combatSkill,
      },
    },
    cardUpgradeCosts: BALANCE_CONSTANTS.cardUpgradeCosts,
    // Карты из json (не SUPPORT_CARD_REFERENCE), иначе L2 проходится за ~5 попыток.
    supportCards: bundled.supportCards,
  };
}
