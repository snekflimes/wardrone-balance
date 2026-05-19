import type { BalanceConstants, EnemyConfig, EnemyId, GameFormulas } from './model';
import { BALANCE_CONSTANTS } from './model';

/** На случай неполного runtime: дополняем врагов дефолтами. */
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

function mergeWeaponsForForecast(
  base: BalanceConstants['weapons'],
  runtime: BalanceConstants['weapons'] | undefined
): BalanceConstants['weapons'] {
  if (!runtime) return base;
  return {
    ...base,
    ...runtime,
    machineGun: { ...base.machineGun, ...(runtime.machineGun ?? {}) },
    hydra70: { ...base.hydra70, ...(runtime.hydra70 ?? {}) },
    hellfire: { ...base.hellfire, ...(runtime.hellfire ?? {}) },
    growth: runtime.growth ?? base.growth,
  };
}

function mergeWeaponVsEnemyModifiersForForecast(
  base: BalanceConstants['weaponVsEnemyModifiers'],
  runtime: BalanceConstants['weaponVsEnemyModifiers'] | undefined
): BalanceConstants['weaponVsEnemyModifiers'] {
  if (!runtime) return base;
  return {
    machineGun: { ...base.machineGun, ...(runtime.machineGun ?? {}) },
    hydra70: { ...base.hydra70, ...(runtime.hydra70 ?? {}) },
    hellfire: { ...base.hellfire, ...(runtime.hellfire ?? {}) },
  };
}

/**
 * Масштабирование урона оружия — дефолтные формулы; числа (baseDamage, рост) — из вкладки «Оружие и карты».
 * Экономика (baseMissionReward и т.д.) — из сохранённого конструктора формул.
 */
function mergeFormulasForForecast(
  base: GameFormulas | undefined,
  runtime: GameFormulas | undefined
): GameFormulas | undefined {
  if (!runtime && !base) return undefined;
  const b = base ?? {};
  const r = runtime ?? {};
  return {
    ...b,
    ...r,
    economy: r.economy ?? b.economy,
    builders: {
      ...b.builders,
      ...r.builders,
      economy: r.builders?.economy ?? b.builders?.economy,
      weapons: b.builders?.weapons,
    },
    weapons: b.weapons,
  };
}

/**
 * Баланс для прогноза попыток: state из редактора после сохранения, без отката к урезанному бандлу.
 *
 * Отдельно от balance передаются в simulateProgressionForecast:
 * - referenceWavesConfig — «Уровни»;
 * - segmentId, energy*, maxAttemptsPerLevel — «Прогноз»;
 * - playerLevel — шапка приложения.
 */
export function balanceForForecastSimulation(runtime: BalanceConstants): BalanceConstants {
  const base = BALANCE_CONSTANTS;
  const baseEconomy = base.economy;

  return {
    ...runtime,
    meta: { ...base.meta, ...runtime.meta },
    player: { ...base.player, ...runtime.player },
    weapons: mergeWeaponsForForecast(base.weapons, runtime.weapons),
    enemies: mergeEnemiesForForecast(base.enemies, runtime.enemies),
    weaponVsEnemyModifiers: mergeWeaponVsEnemyModifiersForForecast(
      base.weaponVsEnemyModifiers,
      runtime.weaponVsEnemyModifiers
    ),
    economy: {
      ...baseEconomy,
      ...runtime.economy,
      combatSkill: {
        ...baseEconomy.combatSkill,
        ...runtime.economy.combatSkill,
      },
    },
    cardUpgradeCosts: {
      ...base.cardUpgradeCosts,
      ...runtime.cardUpgradeCosts,
    },
    supportCards: runtime.supportCards ?? base.supportCards,
    formulas: mergeFormulasForForecast(base.formulas, runtime.formulas),
  };
}

/** Краткая сводка для подсказок в UI прогноза. */
export const FORECAST_BALANCE_INPUT_HINTS: { label: string; source: string }[] = [
  { label: 'Состав волн', source: '«Уровни» (referenceWavesConfig)' },
  { label: 'Враги: HP, урон, награда', source: '«Уровни» → таблица юнитов' },
  { label: 'Оружие: урон, патроны, рост, цены апгрейда', source: '«Оружие и карты»' },
  { label: 'Карты поддержки (урон, мана, таблицы уровней)', source: '«Оружие и карты»' },
  { label: 'База миссии, бонус победы, сундуки, логин, магазин', source: '«Экономика»' },
  { label: 'Цена VIP / премиум (донат, не HP в бою)', source: '«Экономика»' },
  { label: 'HP вертолёта / пехоты в бою', source: '«Формулы» → Игрок / вертолёт (player.*)' },
  { label: 'Формула baseMissionReward', source: '«Формулы» → экономика' },
  { label: 'Промахи, разброс, global плейтеста', source: '«Прогноз» / «Формулы» → бой' },
  { label: 'Волн на уровень, длительность волны', source: '«Формулы» → meta' },
  { label: 'Энергия, лимит попыток/день', source: '«Прогноз» и meta.forecastMaxAttemptsPerDay' },
  { label: 'Сегмент (free/payer/whale)', source: '«Прогноз»' },
];
