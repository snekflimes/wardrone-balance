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

function defaultManualLevelRowCount(constants: BalanceConstants): number {
  const nums = Object.keys(constants.cardUpgradeCosts)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n) && n > 0);
  return nums.length > 0 ? Math.max(...nums) : 60;
}

/** Таблица для UI: при отсутствии manualLevels — пустые строки по числу уровней из экономики. */
export function getSupportCardLevelsForEditor(
  constants: BalanceConstants,
  cardId: number
): SupportCardLevelStats[] {
  const card = constants.supportCards.find((c) => c.id === cardId);
  if (!card) return [];
  if (card.manualLevels?.length) return getSupportCardLevels(constants, cardId);
  const n = defaultManualLevelRowCount(constants);
  return Array.from({ length: n }, (_, i) => ({
    card,
    level: i + 1,
    values: {} as Record<string, number | null>,
  }));
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

export function snapshotSupportCardManualLevelsForEditor(
  constants: BalanceConstants,
  cardId: number
): SupportCardManualLevel[] {
  return getSupportCardLevelsForEditor(constants, cardId).map((row) => ({
    level: row.level,
    values: { ...row.values },
  }));
}

