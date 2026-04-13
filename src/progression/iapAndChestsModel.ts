import type {
  BalanceConstants,
  CardRarity,
  ChestConfig,
  CurrencyPackConfig,
  FreeChestConfig,
} from '../balance/model';
import type { SegmentId } from './types';

export interface SegmentUsdProfile {
  segmentId: SegmentId;
  weeklyUsdRange: [number, number];
}

export const DEFAULT_SEGMENT_USD_PROFILES: SegmentUsdProfile[] = [
  { segmentId: 'free', weeklyUsdRange: [0, 0] },
  { segmentId: 'payer', weeklyUsdRange: [6, 10] },
  { segmentId: 'whale', weeklyUsdRange: [51, 100] },
];

function clampFinite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

export function getExpectedWeeklyUsdForSegment(
  segmentId: SegmentId,
  profiles: SegmentUsdProfile[] = DEFAULT_SEGMENT_USD_PROFILES
): number {
  // Если в meta заданы дневные значения — используем их (это “истина” для вкладки «Трафик» и прогноза).
  if (segmentId === 'payer') {
    const v = (profiles as any)?.__constants?.meta?.trafficUsdPerDayPayer;
    // fallback: чаще вызов идёт без __constants, поэтому отдельная функция ниже используется в прогнозе.
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v * 7;
  }
  if (segmentId === 'whale') {
    const v = (profiles as any)?.__constants?.meta?.trafficUsdPerDayWhale;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v * 7;
  }

  const p = profiles.find((x) => x.segmentId === segmentId) ?? profiles[1];
  const [minUsd, maxUsd] = p.weeklyUsdRange;
  return (minUsd + maxUsd) / 2;
}

function findBestIapSoftPackForUsd(constants: BalanceConstants): { packSoft: number; priceUsd: number } | null {
  const iapSoft = constants.economy.shopItems.filter((it) => it.type === 'iap_soft' && (it.priceUsd ?? 0) > 0 && it.quantity > 0);
  if (iapSoft.length === 0) return null;

  // Максимальная эффективность: soft / USD
  let best: { packSoft: number; priceUsd: number } | null = null;
  for (const item of iapSoft) {
    const priceUsd = item.priceUsd ?? 0;
    const packSoft = item.quantity;
    if (priceUsd <= 0 || packSoft <= 0) continue;
    if (!best) {
      best = { packSoft, priceUsd };
      continue;
    }
    const bestRate = best.packSoft / best.priceUsd;
    const thisRate = packSoft / priceUsd;
    if (thisRate > bestRate) best = { packSoft, priceUsd };
  }
  return best;
}

/**
 * Доля недельного доната в «золото» (хард) в прогнозе: остальное конвертируется в софт через iap_soft.
 * Киты сильнее уходят в сундуки за хард; платящие — смешанная модель.
 */
export function getForecastSegmentGoldShare(segmentId: SegmentId): number {
  if (segmentId === 'payer') return 0.3;
  if (segmentId === 'whale') return 0.55;
  return 0;
}

function getExpectedWeeklyUsdForSegmentForecast(
  constants: BalanceConstants,
  segmentId: SegmentId,
  profiles: SegmentUsdProfile[]
): number {
  if (segmentId === 'free') return 0;
  const meta = constants.meta ?? ({} as any);
  const usdPerDay =
    segmentId === 'payer'
      ? meta.trafficUsdPerDayPayer
      : segmentId === 'whale'
        ? meta.trafficUsdPerDayWhale
        : 0;
  if (typeof usdPerDay === 'number' && Number.isFinite(usdPerDay) && usdPerDay > 0) {
    return usdPerDay * 7;
  }
  return getExpectedWeeklyUsdForSegment(segmentId, profiles);
}

export function getSoftIncomeFromSegmentPerWeek(
  constants: BalanceConstants,
  segmentId: SegmentId,
  profiles: SegmentUsdProfile[] = DEFAULT_SEGMENT_USD_PROFILES
): number {
  if (segmentId === 'free') return 0;

  const expectedUsd = getExpectedWeeklyUsdForSegmentForecast(constants, segmentId, profiles);
  const goldShare = getForecastSegmentGoldShare(segmentId);
  const softUsd = expectedUsd * (1 - goldShare);
  const bestPack = findBestIapSoftPackForUsd(constants);
  if (!bestPack) return 0;

  const softPerUsd = bestPack.packSoft / bestPack.priceUsd;
  return Math.max(0, softUsd * softPerUsd);
}

export function getBestSoftPerUsd(constants: BalanceConstants): number {
  const bestPack = findBestIapSoftPackForUsd(constants);
  if (!bestPack) return 0;
  return bestPack.packSoft / bestPack.priceUsd;
}

export function getBestGoldPerUsd(constants: BalanceConstants): number {
  const iapGold = constants.economy.shopItems.filter((it) => it.type === 'iap_gold' && (it.priceUsd ?? 0) > 0 && it.quantity > 0);
  if (iapGold.length === 0) return 0;
  let best = 0;
  for (const item of iapGold) {
    const usd = item.priceUsd ?? 0;
    const qty = item.quantity ?? 0;
    if (usd <= 0 || qty <= 0) continue;
    best = Math.max(best, qty / usd);
  }
  return best;
}

export function getHardIncomeFromSegmentPerWeek(
  constants: BalanceConstants,
  segmentId: SegmentId,
  profiles: SegmentUsdProfile[] = DEFAULT_SEGMENT_USD_PROFILES
): number {
  if (segmentId === 'free') return 0;
  const expectedUsd = getExpectedWeeklyUsdForSegmentForecast(constants, segmentId, profiles);
  const goldShare = getForecastSegmentGoldShare(segmentId);
  const hardUsd = expectedUsd * goldShare;
  const goldPerUsd = getBestGoldPerUsd(constants);
  if (goldPerUsd <= 0) return 0;
  return Math.max(0, hardUsd * goldPerUsd);
}

export function getIapSoftIncomeForUsd(
  constants: BalanceConstants,
  usd: number
): number {
  if (usd <= 0) return 0;
  const bestPack = findBestIapSoftPackForUsd(constants);
  if (!bestPack) return 0;
  const softPerUsd = bestPack.packSoft / bestPack.priceUsd;
  return Math.max(0, usd * softPerUsd);
}

export function mapCardRarityToChestDropRarity(
  rarity: CardRarity
): keyof NonNullable<ChestConfig['dropChancesPercent']> {
  if (rarity === 'uncommon') return 'uncommon';
  return rarity;
}

function getChestDropChancePercent(chest: ChestConfig, rarityKey: keyof NonNullable<ChestConfig['dropChancesPercent']>): number {
  const drops = chest.dropChancesPercent;
  if (!drops) return 0;
  return drops[rarityKey] ?? 0;
}

export function countSupportCardsOfRarity(constants: BalanceConstants, rarity: CardRarity): number {
  return constants.supportCards.filter((c) => c.rarity === rarity).length;
}

export interface ResolvedFreeChestKeyProgression {
  keysPerWin: number;
  keysPerLoss: number;
  keysToOpenChest: number;
}

/** Дефолт как в референсе: победа 1 ключ, поражение ½, 3 ключа на сундук. */
export function getFreeChestKeyProgression(constants: BalanceConstants): ResolvedFreeChestKeyProgression {
  const c = constants.economy.freeChestKeyProgression;
  return {
    keysPerWin: c?.keysPerWin ?? 1,
    keysPerLoss: c?.keysPerLoss ?? 0.5,
    keysToOpenChest: Math.max(0.001, c?.keysToOpenChest ?? 3),
  };
}

/** Среднее число ключей за попытку при доле побед winRate (0..1). */
export function getExpectedKeysPerAttempt(
  winRate: number,
  progression?: ResolvedFreeChestKeyProgression
): number {
  const p = progression ?? { keysPerWin: 1, keysPerLoss: 0.5, keysToOpenChest: 3 };
  const w = Math.max(0, Math.min(1, winRate));
  return w * p.keysPerWin + (1 - w) * p.keysPerLoss;
}

/** EV чертежей по всем картам за count открытий платного сундука (для бандлов / стартера в прогнозе). */
export function addExpectedBlueprintsFromPaidChestOpens(
  constants: BalanceConstants,
  chestId: string,
  count: number,
  blueprints: Record<number, number>,
  recordPaidChestOpens?: (chestId: string, count: number) => void
): Record<number, number> {
  if (count <= 0 || !chestId) return blueprints;
  const chest = constants.economy.chests[chestId];
  if (!chest) return blueprints;
  recordPaidChestOpens?.(chestId, count);
  const next = { ...blueprints };
  for (const card of constants.supportCards) {
    const per = getExpectedCopiesOfSingleCardPerChest(constants, chestId, card.rarity);
    if (per > 0) next[card.id] = (next[card.id] ?? 0) + per * count;
  }
  return next;
}

/**
 * Expected-value: сколько копий конкретной карты (одной карточки данного rarity) падает за ОДИН сундук.
 *
 * Логика: Spreadsheet SimulatorChest (взвешенный ролл по всем карточкам).
 */
export function getExpectedCopiesOfSingleCardPerChest(
  constants: BalanceConstants,
  chestId: string,
  targetRarity: CardRarity
): number {
  const chest = constants.economy.chests[chestId];
  if (!chest) return 0;

  // Полная логика из Spreadsheet SimulatorChest:
  // finalWeight(item) = itemBaseWeight * rarityWeight * chestMultiplierByRarity
  // P(item) = finalWeight(item) / sum(finalWeight(all items))
  // E[copies of single item per chest] = cardsPerChest * P(item)
  const rarityWeights = constants.economy.cardRarityWeights ?? {};
  const allCards = constants.supportCards;
  const rarityKey = mapCardRarityToChestDropRarity(targetRarity);
  const chestMultiplierTarget = getChestDropChancePercent(
    chest,
    rarityKey as keyof NonNullable<ChestConfig['dropChancesPercent']>
  );
  const targetRarityWeight = rarityWeights[targetRarity] ?? 1;
  if (chestMultiplierTarget <= 0 || targetRarityWeight <= 0) return 0;

  const countTargetItems = allCards.filter((c) => c.rarity === targetRarity).length;
  if (countTargetItems <= 0) return 0;

  let totalWeight = 0;
  for (const card of allCards) {
    const baseWeight = card.chestBaseWeight ?? 1;
    const rarityWeight = rarityWeights[card.rarity] ?? 1;
    const cardRarityKey = mapCardRarityToChestDropRarity(card.rarity);
    const chestMultiplier = getChestDropChancePercent(
      chest,
      cardRarityKey as keyof NonNullable<ChestConfig['dropChancesPercent']>
    ) || 1;
    totalWeight += Math.max(0, baseWeight * rarityWeight * chestMultiplier);
  }
  if (totalWeight <= 0) return 0;

  const targetSingleItemWeight = 1 * targetRarityWeight * chestMultiplierTarget;
  const targetSingleItemProbability = targetSingleItemWeight / totalWeight;
  return chest.cards * targetSingleItemProbability;
}

export function getExpectedCopiesOfSingleCardPerSoftSpent(
  constants: BalanceConstants,
  chestId: string,
  targetRarity: CardRarity
): number {
  const chest = constants.economy.chests[chestId];
  if (chest.priceSoft <= 0) return 0;
  const expectedCopies = getExpectedCopiesOfSingleCardPerChest(constants, chestId, targetRarity);
  return expectedCopies / chest.priceSoft;
}

/**
 * chestPolicy: выбираем сундук с максимальной эффективностью
 * (expectedCopiesOfSingleCard per 1 soft spent) для конкретной цели по rarity.
 */
export function pickBestChestByRarityEfficiency(
  constants: BalanceConstants,
  targetRarity: CardRarity
): string {
  const chestIds = Object.keys(constants.economy.chests).filter((id) => Boolean(constants.economy.chests[id]));
  if (chestIds.length === 0) {
    return 'common';
  }
  let bestChest = chestIds[0];
  let bestEff = -Infinity;
  for (const chestId of chestIds) {
    const eff = getExpectedCopiesOfSingleCardPerSoftSpent(constants, chestId, targetRarity);
    if (eff > bestEff) {
      bestEff = eff;
      bestChest = chestId;
    }
  }
  return bestChest;
}

/** Сундук с максимальной EV копий карты данной редкости на 1 хард (если priceHard > 0). */
export function pickBestChestByRarityHardEfficiency(
  constants: BalanceConstants,
  targetRarity: CardRarity
): string {
  const chestIds = Object.keys(constants.economy.chests).filter((id) => Boolean(constants.economy.chests[id]));
  if (chestIds.length === 0) return 'common';
  let bestChest = chestIds[0];
  let bestEff = -Infinity;
  for (const chestId of chestIds) {
    const chest = constants.economy.chests[chestId];
    const ph = chest?.priceHard ?? 0;
    if (ph <= 0) continue;
    const eff = getExpectedCopiesOfSingleCardPerChest(constants, chestId, targetRarity) / ph;
    if (eff > bestEff) {
      bestEff = eff;
      bestChest = chestId;
    }
  }
  return bestChest;
}

export function getExpectedChestsToGetCards(
  constants: BalanceConstants,
  chestId: string,
  targetRarity: CardRarity,
  cardsNeeded: number
): number {
  if (cardsNeeded <= 0) return 0;
  const expectedPerChest = getExpectedCopiesOfSingleCardPerChest(constants, chestId, targetRarity);
  if (expectedPerChest <= 0) return Infinity;
  return cardsNeeded / expectedPerChest;
}

type FreeChestDrop =
  | { kind: 'pack'; pack: CurrencyPackConfig; weight: number }
  | { kind: 'blueprint'; rarity: CardRarity; weight: number };

function getFreeChestDropPool(constants: BalanceConstants, chest: FreeChestConfig): FreeChestDrop[] {
  const packsById = new Map((constants.economy.currencyPacks ?? []).map((p) => [p.id, p]));
  const rarityWeights = constants.economy.cardRarityWeights ?? {};
  const drops: FreeChestDrop[] = [];

  for (const packId of chest.packIds ?? []) {
    const pack = packsById.get(packId);
    if (!pack) continue;
    drops.push({ kind: 'pack', pack, weight: Math.max(0, pack.baseWeight ?? 0) });
  }
  for (const rarity of chest.blueprintRarities ?? []) {
    drops.push({
      kind: 'blueprint',
      rarity,
      weight: Math.max(0, rarityWeights[rarity] ?? 0),
    });
  }
  return drops;
}

export function getExpectedBlueprintCopiesOfSingleCardPerFreeChest(
  constants: BalanceConstants,
  freeChestId: string,
  targetRarity: CardRarity
): number {
  const chest = (constants.economy.freeChests ?? []).find((c) => c.id === freeChestId);
  if (!chest) return 0;
  const pool = getFreeChestDropPool(constants, chest);
  const totalWeight = pool.reduce((s, d) => s + d.weight, 0);
  if (totalWeight <= 0) return 0;

  const rarityWeight = pool
    .filter((d): d is Extract<FreeChestDrop, { kind: 'blueprint' }> => d.kind === 'blueprint' && d.rarity === targetRarity)
    .reduce((s, d) => s + d.weight, 0);
  if (rarityWeight <= 0) return 0;

  const cardsOfRarity = countSupportCardsOfRarity(constants, targetRarity);
  if (cardsOfRarity <= 0) return 0;

  const pRarity = rarityWeight / totalWeight;
  // В бесплатном сундуке строго один дроп; для blueprint-дропа даётся 1 чертёж.
  return pRarity / cardsOfRarity;
}

export function getExpectedFreeChestCurrencyPerOpen(
  constants: BalanceConstants,
  freeChestId: string
): { soft: number; hard: number } {
  const chest = (constants.economy.freeChests ?? []).find((c) => c.id === freeChestId);
  if (!chest) return { soft: 0, hard: 0 };
  const pool = getFreeChestDropPool(constants, chest);
  const totalWeight = pool.reduce((s, d) => s + d.weight, 0);
  if (totalWeight <= 0) return { soft: 0, hard: 0 };

  let soft = 0;
  let hard = 0;
  for (const drop of pool) {
    if (drop.kind !== 'pack') continue;
    const p = drop.weight / totalWeight;
    if (drop.pack.currency === 'soft') soft += p * drop.pack.amount;
    else hard += p * drop.pack.amount;
  }
  return { soft, hard };
}

