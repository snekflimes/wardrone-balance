import constantsBundled from '../../balance/constants.json';
import type { EconomyConfig } from './model';
import { getOutgoingCombatRealismMultiplier } from './simulator';

const bundledEconomy = constantsBundled.economy as EconomyConfig;

/** Версия калибровки из репозитория (для отображения в UI прогноза). */
export const FORECAST_CALIBRATION_VERSION =
  bundledEconomy.combatSkill?.forecastCalibrationVersion ?? 0;

/**
 * @deprecated Таблица forecastCombatRealismByLevel больше не используется в прогнозе:
 * одинаковые правила боя на всех уровнях (только промахи/разброс из combatSkill).
 */
export function getForecastLevelRealismMult(_levelIndex: number): number {
  return 1;
}

/**
 * Исходящий «реализм» для прогноза попыток: промахи и разброс из constants.json,
 * без поуровневой подгонки и playtest-bias. Номер уровня на множитель не влияет.
 */
export function resolveForecastOutgoingCombatRealism(_levelIndex: number): number {
  const skill = bundledEconomy.combatSkill;
  const skillOnly = { combatSkill: skill } as EconomyConfig;
  return getOutgoingCombatRealismMultiplier(skillOnly);
}

/** Для отладки в UI конструктора уровней. */
export function getForecastCalibrationSummary(_maxLevel = 2): string {
  const mult = resolveForecastOutgoingCombatRealism(1);
  return `калибровка v${FORECAST_CALIBRATION_VERSION}: единый реализм урона ×${mult.toFixed(3)} (все уровни)`;
}
