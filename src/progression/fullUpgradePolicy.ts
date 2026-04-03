import type { BalanceConstants } from '../balance/model';
import { weaponOnlyUpgradePolicy } from './weaponUpgradePolicy';
import type { ProgressionState, UpgradePolicy } from './types';
import { pickBestSupportCardFeedCandidate } from './supportCardFeedCandidates';
import {
  getExpectedCopiesOfSingleCardPerChest,
  pickBestChestByRarityEfficiency,
} from './iapAndChestsModel';

export const fullWeaponAndSupportUpgradePolicy: UpgradePolicy = ({ constants, state, outcome, ctx }) => {
  let next = weaponOnlyUpgradePolicy({ constants, state, outcome, ctx });

  if (!outcome.victory) return next;

  const wavesPerLevel = Math.max(1, Math.min(2, constants.economy.wavesPerLevel ?? 2));
  if (ctx.waveIndex >= 1 && ctx.waveIndex < wavesPerLevel) {
    return next;
  }

  if (next.softBalance <= 0) return next;

  const candidate = pickBestSupportCardFeedCandidate(constants, next, ctx.levelIndex);
  if (!candidate) return next;

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

  if (blueprintShortage <= EPS) {
    if (next.softBalance < coinCost) return next;

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
