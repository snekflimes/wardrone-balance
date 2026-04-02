import {
  type BalanceConstants,
  type SupportCardConfig,
  type SupportCardManualLevel,
} from './model';

export interface SupportCardLevelStats {
  card: SupportCardConfig;
  level: number;
  values: Record<string, number | null>;
}

export function getSupportCardLevels(
  constants: BalanceConstants,
  cardId: number
): SupportCardLevelStats[] {
  const card = constants.supportCards.find(c => c.id === cardId);
  if (!card) return [];

  if (card.manualLevels?.length) {
    return card.manualLevels.map((row, index) => ({
      card,
      level: row.level ?? index + 1,
      values: row.values,
    }));
  }

  return [];
}

export function snapshotSupportCardManualLevels(
  constants: BalanceConstants,
  cardId: number
): SupportCardManualLevel[] {
  return getSupportCardLevels(constants, cardId).map((row) => ({
    level: row.level,
    values: { ...row.values },
  }));
}

