import constantsBundled from '../../balance/constants.json';
import type { EconomyConfig } from './model';
import { getOutgoingCombatRealismMultiplier } from './simulator';

const bundledEconomy = constantsBundled.economy as EconomyConfig;

/** Версия калибровки из репозитория (для отображения в UI прогноза). */
export const FORECAST_CALIBRATION_VERSION =
  bundledEconomy.combatSkill?.forecastCalibrationVersion ?? 0;

/** Значение по умолчанию: якорь старой калибровки ур.1 (0.109 × playtest bias 1.35). */
export function getDefaultForecastOutgoingRealismGlobal(): number {
  const table = bundledEconomy.combatSkill?.forecastCombatRealismByLevel ?? [];
  const bias = bundledEconomy.combatSkill?.forecastPlaytestOutgoingBias;
  const b = bias != null && Number.isFinite(bias) && bias > 0 ? bias : 1;
  const l1 = table[0];
  if (l1 != null && Number.isFinite(l1) && l1 > 0) {
    return Math.max(0.02, Math.min(1, l1 * b));
  }
  const legacy = bundledEconomy.combatSkill?.forecastOutgoingRealismGlobal;
  if (legacy != null && Number.isFinite(legacy) && legacy > 0) return legacy;
  return 0.15;
}

/**
 * @deprecated Таблица forecastCombatRealismByLevel не используется в прогнозе с v11+.
 */
export function getForecastLevelRealismMult(_levelIndex: number): number {
  return 1;
}

function resolveGlobalMult(economy?: EconomyConfig): number {
  const skill = economy?.combatSkill ?? bundledEconomy.combatSkill;
  const g = skill?.forecastOutgoingRealismGlobal;
  if (g != null && Number.isFinite(g) && g > 0) return Math.max(0.02, Math.min(1, g));
  return getDefaultForecastOutgoingRealismGlobal();
}

/**
 * Исходящий «реализм» для прогноза: промахи/разброс × единый global (все уровни одинаково).
 */
export function resolveForecastOutgoingCombatRealism(
  _levelIndex: number,
  economy?: EconomyConfig
): number {
  const econ = economy ?? bundledEconomy;
  const skillOnly = { combatSkill: econ.combatSkill ?? bundledEconomy.combatSkill } as EconomyConfig;
  const base = getOutgoingCombatRealismMultiplier(skillOnly);
  return Math.max(0.02, Math.min(1, base * resolveGlobalMult(economy)));
}

/** Для отладки в UI конструктора уровней. */
export function getForecastCalibrationSummary(maxLevel = 2, economy?: EconomyConfig): string {
  const mult = resolveForecastOutgoingCombatRealism(1, economy);
  const g = resolveGlobalMult(economy);
  const base = getOutgoingCombatRealismMultiplier({
    combatSkill: (economy ?? bundledEconomy).combatSkill ?? bundledEconomy.combatSkill,
  } as EconomyConfig);
  return (
    `калибровка v${FORECAST_CALIBRATION_VERSION}: база×${base.toFixed(3)} × global ${g.toFixed(3)} ` +
    `= ${mult.toFixed(3)} (ур.1–${maxLevel} одинаково)`
  );
}
