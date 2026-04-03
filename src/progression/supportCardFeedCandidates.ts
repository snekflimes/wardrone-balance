import type { BalanceConstants, SupportCardConfig } from '../balance/model';
import type { ProgressionState } from './types';
import { getUpgradeCosts } from './upgradeCosts';

export function getCardMaxLevel(card: SupportCardConfig): number {
  const levels = card.manualLevels ?? [];
  return levels.reduce((m, l) => Math.max(m, l.level), 0);
}

export function isCardUnlockedForLevel(card: SupportCardConfig, levelIndex: number): boolean {
  const unlockAfter = card.unlockAfterLevel ?? 1;
  return levelIndex >= unlockAfter;
}

export function getRequiredBlueprintsForNextLevel(
  constants: BalanceConstants,
  card: SupportCardConfig,
  currentLevel: number
): number {
  if (currentLevel <= 0) {
    return card.firstBlueprints ?? 1;
  }
  const nextLevel = currentLevel + 1;
  return getUpgradeCosts(constants, nextLevel).blueprints;
}

export function getNextSupportLevel(currentLevel: number): number {
  if (currentLevel <= 0) return 1;
  return currentLevel + 1;
}

export function getCoinsCostForNextLevel(constants: BalanceConstants, nextLevel: number): number {
  return getUpgradeCosts(constants, nextLevel).soft;
}

export function getCandidateScore(params: {
  readiness: number;
  blueprintShortage: number;
  coinCost: number;
  currentLevel: number;
}): number {
  const readinessPenalty = (1 - Math.max(0, Math.min(1, params.readiness))) * 1000;
  const shortagePenalty = Math.max(0, params.blueprintShortage) * 3;
  const coinPenalty = Math.max(0, params.coinCost) * 0.0005;
  const levelPenalty = Math.max(0, params.currentLevel) * 2;
  return readinessPenalty + shortagePenalty + coinPenalty + levelPenalty;
}

export interface SupportCardFeedCandidate {
  card: SupportCardConfig;
  currentLevel: number;
  nextLevel: number;
  neededBlueprints: number;
  coinCost: number;
  blueprintShortage: number;
  readiness: number;
  score: number;
}

export function listSupportCardFeedCandidates(
  constants: BalanceConstants,
  state: Pick<ProgressionState, 'supportCardLevels' | 'supportCardBlueprints'>,
  levelIndex: number
): SupportCardFeedCandidate[] {
  const unlockedCandidates = constants.supportCards
    .map((card) => {
      if (!isCardUnlockedForLevel(card, levelIndex)) return null;

      const maxLevel = getCardMaxLevel(card);
      const currentLevel = state.supportCardLevels[card.id] ?? 0;
      if (currentLevel >= maxLevel || maxLevel <= 0) return null;

      const nextLevel = getNextSupportLevel(currentLevel);
      const neededBlueprints = getRequiredBlueprintsForNextLevel(constants, card, currentLevel);
      const currentBlueprints = state.supportCardBlueprints[card.id] ?? 0;
      const blueprintShortage = Math.max(0, neededBlueprints - currentBlueprints);
      const readiness =
        neededBlueprints <= 0 ? 1 : Math.max(0, Math.min(1, currentBlueprints / neededBlueprints));

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
    .filter((v): v is SupportCardFeedCandidate => v != null);

  return unlockedCandidates;
}

export function pickBestSupportCardFeedCandidate(
  constants: BalanceConstants,
  state: Pick<ProgressionState, 'supportCardLevels' | 'supportCardBlueprints'>,
  levelIndex: number
): SupportCardFeedCandidate | null {
  const list = listSupportCardFeedCandidates(constants, state, levelIndex);
  if (list.length === 0) return null;
  const sorted = [...list].sort(
    (a, b) => a.score - b.score || a.currentLevel - b.currentLevel || a.card.id - b.card.id
  );
  return sorted[0];
}
