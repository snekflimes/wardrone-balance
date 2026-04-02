import type { BalanceConstants, SupportCardConfig } from '../balance/model';
import { weaponOnlyUpgradePolicy } from './weaponUpgradePolicy';
import type { ProgressionState, UpgradePolicy } from './types';
import {
  getExpectedCopiesOfSingleCardPerChest,
  pickBestChestByRarityEfficiency,
} from './iapAndChestsModel';
import { getUpgradeCosts } from './upgradeCosts';

function getCardMaxLevel(card: SupportCardConfig): number {
  const levels = card.manualLevels ?? [];
  return levels.reduce((m, l) => Math.max(m, l.level), 0);
}

function isCardUnlockedForLevel(card: SupportCardConfig, levelIndex: number): boolean {
  // Если `unlockAfterLevel` не задан — считаем, что карта доступна с 1-го игрового уровня.
  const unlockAfter = card.unlockAfterLevel ?? 1;
  return levelIndex >= unlockAfter;
}

function getRequiredBlueprintsForNextLevel(constants: BalanceConstants, card: SupportCardConfig, currentLevel: number) {
  if (currentLevel <= 0) {
    return card.firstBlueprints ?? 1;
  }
  const nextLevel = currentLevel + 1;
  return getUpgradeCosts(constants, nextLevel).blueprints;
}

function getNextSupportLevel(currentLevel: number): number {
  if (currentLevel <= 0) return 1;
  return currentLevel + 1;
}

function getCoinsCostForNextLevel(constants: BalanceConstants, nextLevel: number): number {
  return getUpgradeCosts(constants, nextLevel).soft;
}

function getCandidateScore(params: {
  // 0..1: насколько карта близка к апгрейду (1 = можно апнуть прямо сейчас)
  readiness: number;
  // абсолютная нехватка чертежей
  blueprintShortage: number;
  // цена апгрейда в монетах (soft)
  coinCost: number;
  // текущий уровень карты
  currentLevel: number;
}): number {
  // "Нормально": игрок чаще апает то, что почти готово (readiness ближе к 1),
  // и не залипает на одной карте, если другие тоже почти готовы.
  // coinCost — слабый фактор, чтобы не упираться в дорогую цель.
  const readinessPenalty = (1 - Math.max(0, Math.min(1, params.readiness))) * 1000;
  const shortagePenalty = Math.max(0, params.blueprintShortage) * 3;
  const coinPenalty = Math.max(0, params.coinCost) * 0.0005;
  const levelPenalty = Math.max(0, params.currentLevel) * 2;
  return readinessPenalty + shortagePenalty + coinPenalty + levelPenalty;
}

export const fullWeaponAndSupportUpgradePolicy: UpgradePolicy = ({ constants, state, outcome, ctx }) => {
  // Сначала всегда пытаемся прокачать оружие (если можно).
  let next = weaponOnlyUpgradePolicy({ constants, state, outcome, ctx });

  // На поражении мы не тратим soft на сундуки/карты: так прогноз не будет "размазывать" ресурс и
  // дольше находит первую точку победы.
  if (!outcome.victory) return next;

  // Награда в симуляторе капает после каждой волны. Если сразу после 1-й волны тратить весь софт
  // на сундуки поддержки, игрок не накопит на апгрейд оружия до 2-й волны той же попытки,
  // хотя суммарная награда за уровень могла бы хватить. Поэтому сундуки/апгрейд карт поддержки
  // (не оружие — оно уже обработано выше) делаем только после последней волны уровня.
  const wavesPerLevel = Math.max(1, Math.min(2, constants.economy.wavesPerLevel ?? 2));
  if (ctx.waveIndex >= 1 && ctx.waveIndex < wavesPerLevel) {
    return next;
  }

  if (next.softBalance <= 0) return next;

  // Выбираем одну поддержку для прокачки на этом шаге (или покупку сундуков под неё).
  const unlockedCandidates = constants.supportCards
    .map((card) => {
      if (!isCardUnlockedForLevel(card, ctx.levelIndex)) return null;

      const maxLevel = getCardMaxLevel(card);
      const currentLevel = next.supportCardLevels[card.id] ?? 0;
      if (currentLevel >= maxLevel || maxLevel <= 0) return null;

      const nextLevel = getNextSupportLevel(currentLevel);
      const neededBlueprints = getRequiredBlueprintsForNextLevel(constants, card, currentLevel);
      const currentBlueprints = next.supportCardBlueprints[card.id] ?? 0;
      const blueprintShortage = Math.max(0, neededBlueprints - currentBlueprints);
      const readiness =
        neededBlueprints <= 0
          ? 1
          : Math.max(0, Math.min(1, currentBlueprints / neededBlueprints));

      const coinCost = getCoinsCostForNextLevel(constants, nextLevel);
      return {
        card,
        currentLevel,
        nextLevel,
        neededBlueprints,
        coinCost,
        blueprintShortage,
        readiness,
        score: getCandidateScore({ readiness, blueprintShortage, coinCost, currentLevel }),
      };
    })
    .filter((v): v is NonNullable<typeof v> => v != null);

  if (unlockedCandidates.length === 0) return next;

  // Прогноз: одна «цель» за шаг. Выбираем карту с лучшим score.
  // score оптимизирует "готовность" к апгрейду и чуть учитывает стоимость.
  const candidatesForStep = [...unlockedCandidates].sort((a, b) =>
    a.score - b.score || a.currentLevel - b.currentLevel || a.card.id - b.card.id
  );
  const candidate = candidatesForStep[0];

  const {
    card,
    currentLevel,
    nextLevel,
    neededBlueprints,
    coinCost,
    blueprintShortage,
  } = candidate;

  const currentBlueprints = next.supportCardBlueprints[card.id] ?? 0;
  const EPS = 1e-6;

  // Если чертежей достаточно — пытаемся сделать апгрейд уровня карты.
  if (blueprintShortage <= EPS) {
    if (next.softBalance < coinCost) return next;

    // Апгрейд: списываем soft за монеты, чертежи тоже списываем (если neededBlueprints > 0).
    const newBlueprints = Math.max(0, currentBlueprints - neededBlueprints);

    return {
      ...next,
      softBalance: next.softBalance - coinCost,
      supportCardLevels: {
        ...next.supportCardLevels,
        [card.id]: nextLevel,
      },
      supportCardBlueprints: {
        ...next.supportCardBlueprints,
        [card.id]: newBlueprints,
      },
    };
  }

  // Иначе покупаем сундуки с expected-value приростом чертежей.
  const bestChestId = pickBestChestByRarityEfficiency(constants, card.rarity);
  const bestChest = constants.economy.chests[bestChestId];
  if (bestChest.priceSoft <= 0) return next;

  const expectedPerChest = getExpectedCopiesOfSingleCardPerChest(constants, bestChestId, card.rarity);
  if (expectedPerChest <= 0) return next;

  const expectedNeededChests = blueprintShortage / expectedPerChest;
  const maxChestsAffordable = next.softBalance / bestChest.priceSoft;
  const chestsToBuy = Math.max(0, Math.min(expectedNeededChests, maxChestsAffordable));

  if (chestsToBuy <= 0) return next;

  ctx.recordPaidChestOpens?.(bestChestId, chestsToBuy);

  const blueprintGain = expectedPerChest * chestsToBuy;
  const softSpent = chestsToBuy * bestChest.priceSoft;

  return {
    ...next,
    softBalance: Math.max(0, next.softBalance - softSpent),
    supportCardBlueprints: {
      ...next.supportCardBlueprints,
      [card.id]: currentBlueprints + blueprintGain,
    },
  };
};

