import constantsBundled from '../../balance/constants.json';
import type { EconomyConfig } from './model';
import { getOutgoingSkillDamageMultiplier, getSpreadSpatialDamageMultiplier } from './simulator';

const bundledEconomy = constantsBundled.economy as EconomyConfig;

/** Версия калибровки из репозитория (для отображения в UI прогноза). */
export const FORECAST_CALIBRATION_VERSION =
  bundledEconomy.combatSkill?.forecastCalibrationVersion ?? 0;

export function getForecastLevelRealismMult(levelIndex: number): number {
  const table = bundledEconomy.combatSkill?.forecastCombatRealismByLevel ?? [];
  if (!table.length) return 1;
  const idx = Math.max(0, Math.min(table.length - 1, levelIndex - 1));
  const v = table[idx];
  if (v == null || !Number.isFinite(v)) return 1;
  const byLevel = bundledEconomy.combatSkill?.forecastPlaytestOutgoingBiasByLevel;
  const biasRaw =
    byLevel?.length && byLevel[idx] != null && Number.isFinite(byLevel[idx])
      ? byLevel[idx]
      : bundledEconomy.combatSkill?.forecastPlaytestOutgoingBias;
  const bias = biasRaw != null && Number.isFinite(biasRaw) ? biasRaw : 1;
  return Math.max(0.02, Math.min(1, v * bias));
}

/**
 * Исходящий «реализм» для прогноза попыток: skill/spread только из constants.json,
 * не из localStorage/API. Иначе сохранённый combatSkill ломает калибровку.
 */
export function resolveForecastOutgoingCombatRealism(levelIndex: number): number {
  const skill = bundledEconomy.combatSkill;
  const skillOnly = { combatSkill: skill } as EconomyConfig;
  const base =
    getOutgoingSkillDamageMultiplier(skillOnly) * getSpreadSpatialDamageMultiplier(skillOnly);
  const levelMult = getForecastLevelRealismMult(levelIndex);
  return Math.max(0.02, Math.min(1, base * levelMult));
}

/** Для отладки в UI конструктора уровней. */
export function getForecastCalibrationSummary(maxLevel = 2): string {
  const parts: string[] = [];
  for (let L = 1; L <= maxLevel; L += 1) {
    parts.push(`ур.${L}×${getForecastLevelRealismMult(L).toFixed(3)}`);
  }
  return `калибровка v${FORECAST_CALIBRATION_VERSION}: ${parts.join(', ')}`;
}
