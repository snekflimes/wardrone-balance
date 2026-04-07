import type { SegmentId } from './types';

export type EnergyRegenForecastInput = {
  segmentId: SegmentId;
  /** Секунд на 1 ед. энергии (референс: 600 для бесплатника). */
  energyRegenIntervalSec?: number;
  /** Секунд на 1 ед. энергии с VIP/премиумом (референс: 300). Платящий и кит. */
  energyRegenIntervalSecPremium?: number;
  /** @deprecated Используйте energyRegenIntervalSec (= 3600 / regenPerHour). */
  energyRegenPerHour?: number;
};

/** Интервал (сек/ед.) для выбранного сегмента прогноза. */
export function effectiveEnergyRegenIntervalSec(input: EnergyRegenForecastInput): number {
  const free = input.energyRegenIntervalSec;
  const prem = input.energyRegenIntervalSecPremium ?? free;
  if (free != null && Number.isFinite(free) && free > 0) {
    if (input.segmentId === 'free') return Math.max(1, free);
    const p = prem != null && Number.isFinite(prem) && prem > 0 ? prem : free;
    return Math.max(1, p);
  }
  const perHour = input.energyRegenPerHour ?? 0;
  if (perHour > 0) {
    const sec = 3600 / perHour;
    if (input.segmentId === 'free') return Math.max(1, sec);
    return Math.max(1, sec / 2);
  }
  return Number.POSITIVE_INFINITY;
}

/** Сколько единиц энергии восстанавливается за час (как в старой модели симулятора). */
export function resolveEnergyRegenPerHour(input: EnergyRegenForecastInput): number {
  const interval = effectiveEnergyRegenIntervalSec(input);
  if (!Number.isFinite(interval) || interval <= 0) return 0;
  return 3600 / interval;
}
