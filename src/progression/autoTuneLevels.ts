import { balanceForForecastSimulation } from '../balance/balanceForForecastSimulation';
import { getWavesPerLevel } from '../balance/economy';
import type { BalanceConstants, EnemyId } from '../balance/model';
import type { ReferenceWavesConfig } from '../balance/referenceWaves';
import { simulateProgressionForecast } from './progressionSimulator';
import { fullWeaponAndSupportUpgradePolicy } from './fullUpgradePolicy';
import type { SegmentId } from './types';

export interface AutoTuneOptions {
  segmentId: SegmentId;
  playerLevel: number;
  initialSoft: number;
  maxAttemptsPerLevel?: number;
  maxAttemptsPerWave?: number;
  energyPerLevel: number;
  energyPerAttempt: number;
  energyStart?: number;
  energyRegenIntervalSec?: number;
  energyRegenIntervalSecPremium?: number;
  energyRegenPerHour?: number;
  mode?: 'pass_rate' | 'attempt_range';
  targetsByLevel: Record<number, number>;
  attemptRangesByLevel?: Record<number, { min: number; max: number }>;
}

export interface AutoTuneResult {
  tunedConfig: ReferenceWavesConfig;
  scoreByLevel: Record<number, number>;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function deepCloneConfig(cfg: ReferenceWavesConfig): ReferenceWavesConfig {
  return JSON.parse(JSON.stringify(cfg)) as ReferenceWavesConfig;
}

function levelScoreFromAttempts(
  passed: boolean,
  attemptsTotal: number,
  wavesPerLevel: number
): number {
  // 100% = прошёл уровень с 1 попытки на каждую волну.
  // Чем больше попыток, тем ниже score.
  const idealAttempts = Math.max(1, wavesPerLevel);
  if (!passed) return 0;
  const attempts = Math.max(idealAttempts, attemptsTotal);
  return clamp((idealAttempts / attempts) * 100, 0, 100);
}

function scaleLevelWaves(
  config: ReferenceWavesConfig,
  levelIndex: number,
  multiplier: number
): ReferenceWavesConfig {
  const next = deepCloneConfig(config);
  const waves = next[levelIndex] ?? {};
  for (const waveIdxStr of Object.keys(waves)) {
    const waveIdx = Number(waveIdxStr);
    const wave = waves[waveIdx] ?? {};
    let waveTotal = 0;
    let strongestEnemy: EnemyId | null = null;
    let strongestBaseCount = 0;
    for (const enemyId of Object.keys(wave) as EnemyId[]) {
      const baseCount = wave[enemyId] ?? 0;
      if (baseCount <= 0) continue;
      if (baseCount > strongestBaseCount) {
        strongestBaseCount = baseCount;
        strongestEnemy = enemyId;
      }
      // Позволяем уходить в 0 для тонкой настройки ранних уровней.
      const scaled = Math.max(0, Math.round(baseCount * multiplier));
      wave[enemyId] = scaled;
      waveTotal += scaled;
    }
    // Волна не должна становиться полностью пустой.
    if (waveTotal <= 0 && strongestEnemy) {
      wave[strongestEnemy] = 1;
    }
  }
  return next;
}

function hasAnyEnemiesOnLevel(config: ReferenceWavesConfig, levelIndex: number): boolean {
  return Object.values(config[levelIndex] ?? {}).some((wave) =>
    Object.values(wave ?? {}).some((count) => (count ?? 0) > 0)
  );
}

function seedLevelFromPrevious(
  config: ReferenceWavesConfig,
  levelIndex: number,
  seedMultiplier = 1.12
): ReferenceWavesConfig {
  const next = deepCloneConfig(config);
  const prev = next[levelIndex - 1];
  if (!prev) return next;

  const seededLevel: ReferenceWavesConfig[number] = {};
  for (const [waveIdxStr, waveEnemies] of Object.entries(prev)) {
    const waveIdx = Number(waveIdxStr);
    const seededWave: Partial<Record<EnemyId, number>> = {};
    for (const [enemyId, count] of Object.entries(waveEnemies ?? {}) as Array<[EnemyId, number]>) {
      const baseCount = count ?? 0;
      if (baseCount <= 0) continue;
      seededWave[enemyId] = Math.max(1, Math.round(baseCount * seedMultiplier));
    }
    seededLevel[waveIdx] = seededWave;
  }
  next[levelIndex] = seededLevel;
  return next;
}

function getLevelResult(
  constants: BalanceConstants,
  config: ReferenceWavesConfig,
  options: AutoTuneOptions,
  levelIndex: number
): { score: number; attempts: number; passed: boolean } {
  const forecast = simulateProgressionForecast(constants, {
    segmentId: options.segmentId,
    playerLevel: options.playerLevel,
    initialSoft: options.initialSoft,
    maxAttemptsPerLevel: options.maxAttemptsPerLevel ?? options.maxAttemptsPerWave,
    energyPerLevel: options.energyPerLevel,
    energyPerAttempt: options.energyPerAttempt,
    energyStart: options.energyStart,
    energyRegenIntervalSec: options.energyRegenIntervalSec,
    energyRegenIntervalSecPremium: options.energyRegenIntervalSecPremium,
    energyRegenPerHour: options.energyRegenPerHour,
    upgradePolicy: fullWeaponAndSupportUpgradePolicy,
    referenceWavesConfig: config,
  });
  const row = forecast.levels.find((l) => l.levelIndex === levelIndex);
  if (!row) return { score: 0, attempts: 0, passed: false };
  const wavesPerLevel = getWavesPerLevel(constants);
  return {
    score: levelScoreFromAttempts(row.passed, row.attemptsTotal, wavesPerLevel),
    attempts: row.attemptsTotal,
    passed: row.passed,
  };
}

export function autoTuneReferenceWaves(
  constants: BalanceConstants,
  initialConfig: ReferenceWavesConfig,
  options: AutoTuneOptions
): AutoTuneResult {
  const forecastConstants = balanceForForecastSimulation(constants);
  let working = deepCloneConfig(initialConfig);
  const scoreByLevel: Record<number, number> = {};

  for (let levelIndex = 1; levelIndex <= constants.meta.gameLevels; levelIndex += 1) {
    const mode = options.mode ?? 'pass_rate';
    const target = clamp(options.targetsByLevel[levelIndex] ?? 50, 0, 100);
    const targetRange = options.attemptRangesByLevel?.[levelIndex] ?? { min: 2, max: 6 };
    // Если по уровню нет волн/юнитов, просто фиксируем score и идём дальше.
    if (!hasAnyEnemiesOnLevel(working, levelIndex)) {
      // Если уровень пустой, но есть предыдущий, создаём стартовый состав и тюним дальше.
      if (levelIndex > 1 && hasAnyEnemiesOnLevel(working, levelIndex - 1)) {
        working = seedLevelFromPrevious(working, levelIndex);
      }
    }
    if (!hasAnyEnemiesOnLevel(working, levelIndex)) {
      scoreByLevel[levelIndex] = 0;
      continue;
    }

    let lo = 0.1;
    let hi = 8;
    let bestConfig = working;
    let bestErr = Number.POSITIVE_INFINITY;
    let bestScore = 0;
    let bestAttempts = 0;
    let bestMid = Number.POSITIVE_INFINITY;

    // Для attempt_range заранее расширяем границы, если целевой диапазон
    // не попадает в стартовое окно [lo, hi].
    if (mode === 'attempt_range') {
      const maxExpands = 6;
      for (let i = 0; i < maxExpands; i += 1) {
        const hiProbe = getLevelResult(forecastConstants, scaleLevelWaves(working, levelIndex, hi), options, levelIndex);
        if (hiProbe.passed && hiProbe.attempts < targetRange.min) {
          lo = hi;
          hi *= 2;
          continue;
        }
        break;
      }
      for (let i = 0; i < maxExpands; i += 1) {
        const loProbe = getLevelResult(constants, scaleLevelWaves(working, levelIndex, lo), options, levelIndex);
        if (!loProbe.passed || loProbe.attempts > targetRange.max) {
          hi = lo;
          lo = Math.max(0.01, lo / 2);
          continue;
        }
        break;
      }
    }

    for (let iter = 0; iter < 12; iter += 1) {
      const mid = (lo + hi) / 2;
      const candidate = scaleLevelWaves(working, levelIndex, mid);
      const result = getLevelResult(forecastConstants, candidate, options, levelIndex);
      const score = result.score;
      const attempts = result.attempts;

      const err = mode === 'pass_rate'
        ? Math.abs(score - target)
        : (() => {
            // Для attempt_range считаем отклонение по попыткам даже если уровень не пройден:
            // это убирает "залипание" на слишком лёгких конфигурациях (например всегда 2 попытки),
            // когда единственная альтернатива — failed с жёстким штрафом 1000.
            // Непрохождение всё равно штрафуем, но мягко.
            let attemptsErr = 0;
            if (attempts < targetRange.min) attemptsErr = targetRange.min - attempts;
            else if (attempts > targetRange.max) attemptsErr = attempts - targetRange.max;
            const failPenalty = result.passed ? 0 : 0.5;
            const strictEarlyLevelsPenalty =
              levelIndex <= 3 && (!result.passed || attempts < targetRange.min || attempts > targetRange.max)
                ? 1000
                : 0;
            return attemptsErr + failPenalty + strictEarlyLevelsPenalty;
          })();

      if (err < bestErr || (err === bestErr && mid < bestMid)) {
        bestErr = err;
        bestConfig = candidate;
        bestScore = score;
        bestAttempts = attempts;
        bestMid = mid;
      }

      if (mode === 'pass_rate') {
        // score выше target -> уровень слишком лёгкий, увеличиваем врагов
        if (score > target) lo = mid;
        else hi = mid;
      } else {
        // attempt_range: мало попыток => слишком легко => увеличиваем врагов
        if (!result.passed || attempts > targetRange.max) {
          hi = mid;
        } else if (attempts < targetRange.min) {
          lo = mid;
        } else {
          // В диапазоне, оставляем как есть.
          lo = mid;
          hi = mid;
        }
      }
    }

    working = bestConfig;
    scoreByLevel[levelIndex] = mode === 'pass_rate'
      ? Math.round(bestScore * 10) / 10
      : bestAttempts;
  }

  return {
    tunedConfig: working,
    scoreByLevel,
  };
}

