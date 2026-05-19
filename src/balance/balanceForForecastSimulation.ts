import constantsJson from '../../balance/constants.json';
import { BALANCE_CONSTANTS, type BalanceConstants, type EnemyConfig, type EnemyId } from './model';

/** Параметры врагов из редактора/runtime поверх бандла (награды, HP, урон). */
function mergeEnemiesForForecast(
  base: BalanceConstants['enemies'],
  runtime: BalanceConstants['enemies'] | undefined
): BalanceConstants['enemies'] {
  const out: BalanceConstants['enemies'] = { ...base };
  if (!runtime) return out;
  for (const id of Object.keys(runtime) as EnemyId[]) {
    const patch = runtime[id];
    if (!patch) continue;
    const prev = out[id];
    out[id] = prev ? ({ ...prev, ...patch } as EnemyConfig) : patch;
  }
  return out;
}

/**
 * Прогноз попыток в конструкторе уровней:
 * - состав волн — из редактора (referenceWavesConfig);
 * - враги и экономика наград — из runtime (конструктор / «Экономика»);
 * - combatSkill.forecast* — база из constants.json (калибровка плейтеста).
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
    enemies: mergeEnemiesForForecast(BALANCE_CONSTANTS.enemies, runtime.enemies),
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
