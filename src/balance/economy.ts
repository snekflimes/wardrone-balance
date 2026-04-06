import type { BalanceConstants, EnemyId, ShopItemConfig } from './model';
import type { WaveDefinition } from './schema';
import { getReferenceWave, getReferenceWaveFromConfig, type ReferenceWavesConfig } from './referenceWaves';
import {
  getFormulaExpression,
  evaluateFormula,
} from './formulaEvaluator';

export interface EconomyUsdRates {
  /** USD за 1 единицу хард-валюты (золото) */
  usdPerHard: number;
  /** USD за 1 единицу софт-валюты (монеты) */
  usdPerSoft: number;
  /** Источник: VIP referenceUsd.vipWeeklyUsd / usdAnchor.vipPriceHard */
  sourceHard: string;
  /** Источник софта: по пакету из магазина (монеты за золото) */
  sourceSoft: string;
}

export interface RewardEconomyComparison {
  refSoftPerUsd: number;
  ourSoftPerUsd: number;
  refAvgRewardPerAttemptSoft: number;
  ourAvgRewardPerAttemptSoft: number;
  refAttemptsPerUsd: number;
  ourAttemptsPerUsd: number;
  refUsdPerAttempt: number;
  ourUsdPerAttempt: number;
  /**
   * Множитель для подстройки `iap_soft` (новое quantity ≈ round(старое × k)):
   * k = (ourAvg/refAvg) × (refSoftPerUsd/ourSoftPerUsd). Чем меньше софта за попытку у нас, тем меньше k
   * (монета дефицитнее) → в долларовых пакетах должно быть меньше монет за те же $.
   */
  parityCoefficient: number;
}

/**
 * Считает курс хард/софт к USD.
 * Вариант A: если есть referencePacks — якорим по референсу (goldPerUsd, softPerUsd из базовых тиров IAP).
 * Вариант B: иначе по VIP и пакету "монеты за золото".
 */
export function getEconomyUsdRates(
  constants: BalanceConstants
): EconomyUsdRates | null {
  const refPacks = constants.economy.referencePacks;
  if (refPacks) {
    const usdPerHard = 1 / refPacks.goldPerUsd;
    const usdPerSoft = 1 / refPacks.softPerUsd;
    return {
      usdPerHard,
      usdPerSoft,
      sourceHard: `Референс: ${refPacks.goldPerUsd} золота / $1`,
      sourceSoft: `Референс: ${refPacks.softPerUsd} монет / $1`,
    };
  }

  const ref = constants.economy.referenceUsd;
  const anchor = constants.economy.usdAnchor;
  if (!ref?.vipWeeklyUsd || !anchor?.vipPriceHard) {
    return null;
  }

  const usdPerHard = ref.vipWeeklyUsd / anchor.vipPriceHard;

  const softPack = constants.economy.shopItems.find(
    (i) => i.type === 'currency_soft' && i.priceHard > 0 && i.quantity > 0
  );
  let usdPerSoft = 0;
  let sourceSoft = '—';
  if (softPack) {
    const softReceived = softPack.quantity;
    if (softReceived > 0) {
      usdPerSoft = (softPack.priceHard * usdPerHard) / softReceived;
      sourceSoft = `${softPack.name}: ${softPack.quantity} монет за ${softPack.priceHard} золота`;
    }
  }
  if (usdPerSoft <= 0) {
    usdPerSoft = usdPerHard / 100;
    sourceSoft = 'по умолчанию: 1 монета = 0.01 золота';
  }

  return {
    usdPerHard,
    usdPerSoft,
    sourceHard: `VIP: $${ref.vipWeeklyUsd.toFixed(2)} / ${anchor.vipPriceHard} золота`,
    sourceSoft,
  };
}

/** Глобальная база награды за бой (одинакова на всех игровых уровнях; до премиума/убийств/бонуса). */
export function getMissionRewardSoft(
  constants: BalanceConstants,
  levelIndex: number
): number {
  const { economy } = constants;
  const expr = getFormulaExpression(constants, 'economy', 'missionReward', 'baseMissionReward');
  if (expr) {
    const scope = {
      baseMissionReward: economy.baseMissionReward,
      /** Старые формулы с pow(baseLevelRewardMultiplier, levelIndex) дают плоскую базу при 1. */
      baseLevelRewardMultiplier: 1,
      levelIndex: levelIndex - 1,
    };
    return Math.round(evaluateFormula(expr, scope));
  }
  return economy.baseMissionReward;
}

/** Сколько боёв подряд симулируется на один игровой уровень (не множитель базы в формуле награды). */
export function getWavesPerLevel(constants: BalanceConstants): number {
  const m = constants.meta.wavesPerLevel;
  if (m != null && Number.isFinite(m) && m >= 1) return Math.min(10, Math.floor(m));
  const legacy = (constants.economy as { wavesPerLevel?: number }).wavesPerLevel;
  if (legacy != null && Number.isFinite(legacy) && legacy >= 1) return Math.min(10, Math.floor(legacy));
  return 2;
}

export function getPremiumRewardMultiplier(economy: BalanceConstants['economy']): number {
  const m = economy.premiumRewardMultiplier;
  return m != null && Number.isFinite(m) && m > 0 ? m : 2;
}

export function getVictoryBonusMultiplier(economy: BalanceConstants['economy']): number {
  const v = economy.victoryBonusMultiplier;
  return v != null && Number.isFinite(v) && v >= 0 ? v : 0.75;
}

/** Сумма enemy.reward × count по составу противников в бою. */
export function getKillRewardSoftForWave(constants: BalanceConstants, wave: WaveDefinition): number {
  return wave.enemies.reduce((sum, group) => {
    const enemyCfg = constants.enemies[group.enemyId as EnemyId];
    const per = enemyCfg?.reward ?? 0;
    return sum + per * group.count;
  }, 0);
}

/**
 * Базовая награда за уровень с учётом премиума (без убийств, без бонуса победы).
 */
export function getBaseMissionRewardWithPremiumSoft(
  constants: BalanceConstants,
  levelIndex: number,
  hasPremium: boolean
): number {
  const base = getMissionRewardSoft(constants, levelIndex);
  if (!hasPremium) return base;
  const mult = getPremiumRewardMultiplier(constants.economy);
  return Math.round(base * mult);
}

/**
 * Полная награда за один бой при победе:
 * база×премиум + убийства + victoryBonus×(база×премиум + убийства).
 */
export function getWinRewardSoftForWaveDef(
  constants: BalanceConstants,
  wave: WaveDefinition,
  hasPremium: boolean
): number {
  const basePrem = getBaseMissionRewardWithPremiumSoft(constants, wave.levelIndex, hasPremium);
  const kill = getKillRewardSoftForWave(constants, wave);
  const vb = getVictoryBonusMultiplier(constants.economy);
  const core = basePrem + kill;
  return Math.round(core + vb * core);
}

/** Суммарная награда за уровень при победе во всех боях уровня (референсный состав противников). */
export function getLevelRewardSoft(
  constants: BalanceConstants,
  levelIndex: number,
  opts?: { hasPremium?: boolean; referenceWavesConfig?: ReferenceWavesConfig; wavesCount?: number }
): number {
  const n = opts?.wavesCount ?? getWavesPerLevel(constants);
  const hasPremium = opts?.hasPremium ?? false;
  const cfg = opts?.referenceWavesConfig;
  let total = 0;
  for (let w = 1; w <= n; w++) {
    const wave = cfg
      ? getReferenceWaveFromConfig(cfg, levelIndex, w)
      : getReferenceWave(levelIndex, w);
    total += getWinRewardSoftForWaveDef(constants, wave, hasPremium);
  }
  return total;
}

/** Средняя награда за полный игровой уровень (все бои уровня) по всем уровням 1..gameLevels */
export function getAverageRewardPerLevel(constants: BalanceConstants): number {
  const levels = constants.meta.gameLevels;
  let sum = 0;
  for (let l = 1; l <= levels; l++) {
    sum += getLevelRewardSoft(constants, l);
  }
  return levels > 0 ? sum / levels : 0;
}

/** Средняя награда за один бой по всем уровням и этапам (победа, без премиума, референсный состав). */
function getAverageWaveRewardSoft(constants: BalanceConstants): number {
  const levels = constants.meta.gameLevels;
  const wavesPerLevel = getWavesPerLevel(constants);
  let sum = 0;
  for (let l = 1; l <= levels; l++) {
    for (let w = 1; w <= wavesPerLevel; w++) {
      const wave = getReferenceWave(l, w);
      sum += getWinRewardSoftForWaveDef(constants, wave, false);
    }
  }
  const totalWaves = levels * wavesPerLevel;
  return totalWaves > 0 ? sum / totalWaves : 0;
}

/** Средняя награда за одну игровую сессию. Сессия = economy.missionsPerSession боёв. */
export function getAverageRewardPerSession(
  constants: BalanceConstants,
  missionsPerSession?: number
): number {
  const n = missionsPerSession ?? constants.economy.missionsPerSession ?? 3;
  return getAverageWaveRewardSoft(constants) * n;
}

/** Средняя награда за попытку (1 попытка = 1 уровень) в нашем проекте. */
export function getAverageAttemptRewardSoft(constants: BalanceConstants): number {
  const override = constants.economy.ourAvgRewardPerAttemptSoftOverride;
  if (override != null && Number.isFinite(override) && override > 0) return override;
  return getAverageRewardPerLevel(constants);
}

/**
 * Сколько монет даёт $1 по нашим IAP `iap_soft`: среднее quantity/priceUsd по тирам, совпадающим с `referencePacks.cashTiers`.
 */
export function getOurIapSoftPerUsd(constants: BalanceConstants): number | null {
  const packs = constants.economy.shopItems.filter(
    (i) => i.type === 'iap_soft' && (i.priceUsd ?? 0) > 0 && (i.quantity ?? 0) > 0
  );
  if (packs.length === 0) return null;
  const tiers = constants.economy.referencePacks?.cashTiers;
  if (tiers && tiers.length > 0) {
    const ratios: number[] = [];
    for (const t of tiers) {
      const p = packs.find((x) => Math.abs((x.priceUsd ?? 0) - t.usd) < 0.02);
      if (p) ratios.push(p.quantity / (p.priceUsd ?? 1));
    }
    if (ratios.length > 0) {
      return ratios.reduce((a, b) => a + b, 0) / ratios.length;
    }
  }
  return packs.reduce((m, p) => Math.max(m, p.quantity / (p.priceUsd ?? 1)), 0);
}

/**
 * Сравнение экономики награды за попытку:
 * - сколько попыток эквивалентно $1
 * - USD-стоимость одной попытки
 * - коэффициент паритета (our/ref)
 */
export function getRewardEconomyComparison(
  constants: BalanceConstants,
  opts?: { ourAvgRewardPerAttemptSoft?: number }
): RewardEconomyComparison | null {
  const rates = getEconomyUsdRates(constants);
  const refSoftPerUsd = constants.economy.referencePacks?.softPerUsd;
  const refAvgReward = constants.economy.referenceAvgRewardPerAttemptSoft;
  if (!rates || !refSoftPerUsd || !refAvgReward || refSoftPerUsd <= 0 || refAvgReward <= 0) {
    return null;
  }

  const ourSoftPerUsdFromIap = getOurIapSoftPerUsd(constants);
  const fallbackSoftPerUsd = rates.usdPerSoft > 0 ? 1 / rates.usdPerSoft : 0;
  const ourSoftPerUsd = ourSoftPerUsdFromIap ?? fallbackSoftPerUsd;
  const ourAvgReward =
    opts?.ourAvgRewardPerAttemptSoft != null &&
    Number.isFinite(opts.ourAvgRewardPerAttemptSoft) &&
    opts.ourAvgRewardPerAttemptSoft > 0
      ? opts.ourAvgRewardPerAttemptSoft
      : getAverageAttemptRewardSoft(constants);
  if (ourSoftPerUsd <= 0 || ourAvgReward <= 0) return null;

  const refAttemptsPerUsd = refSoftPerUsd / refAvgReward;
  const ourAttemptsPerUsd = ourSoftPerUsd / ourAvgReward;
  const refUsdPerAttempt = refAvgReward / refSoftPerUsd;
  const ourUsdPerAttempt = ourAvgReward / ourSoftPerUsd;
  // Совпадает с (ourAvg/refAvg) * (refSoftPerUsd/ourSoftPerUsd) — см. JSDoc у parityCoefficient.
  const parityCoefficient = refUsdPerAttempt > 0 ? ourUsdPerAttempt / refUsdPerAttempt : 0;

  return {
    refSoftPerUsd,
    ourSoftPerUsd,
    refAvgRewardPerAttemptSoft: refAvgReward,
    ourAvgRewardPerAttemptSoft: ourAvgReward,
    refAttemptsPerUsd,
    ourAttemptsPerUsd,
    refUsdPerAttempt,
    ourUsdPerAttempt,
    parityCoefficient,
  };
}

/** Пример: сколько софта получает игрок за день (только миссии), грубая оценка по средней награде за бой. */
export function getDailyFreeSoftEstimate(constants: BalanceConstants): number {
  const missionsDaily = 6;
  return missionsDaily * getAverageWaveRewardSoft(constants);
}

/** Цена позиции магазина в USD (по золоту, по монетам или по priceUsd для IAP) */
export function getShopItemUsd(
  item: ShopItemConfig,
  rates: EconomyUsdRates | null
): number {
  if (item.priceUsd != null && item.priceUsd > 0) {
    return item.priceUsd;
  }
  if (!rates) return 0;
  if (item.priceHard > 0) {
    return item.priceHard * rates.usdPerHard;
  }
  if (item.priceSoft > 0) {
    return item.priceSoft * rates.usdPerSoft;
  }
  return 0;
}
