import type { BalanceConstants, PlayerBlock } from './model';

/** Карта пассивного бонуса HP защищаемой цели (вкладка «Оружие и карты»). */
export const PROTECTED_TARGET_HP_CARD_ID = 17;

export const PROTECTED_TARGET_HP_BONUS_COLUMN = 'Бонус HP цели';

export function getSupportCardNumericAtLevel(
  constants: BalanceConstants,
  cardId: number,
  level: number,
  column: string
): number {
  if (level <= 0) return 0;
  const card = constants.supportCards.find((c) => c.id === cardId);
  if (!card) return 0;
  const rows = card.manualLevels ?? [];
  if (rows.length === 0) return 0;
  const exact = rows.find((r) => r.level === level);
  const row =
    exact ??
    rows
      .slice()
      .sort((a, b) => b.level - a.level)
      .find((r) => r.level <= level);
  if (!row) return 0;
  const val = row.values?.[column] ?? row.values?.[card.param1Name ?? column];
  return typeof val === 'number' && Number.isFinite(val) ? Math.max(0, val) : 0;
}

/** Базовое HP цели из «Формулы → Защищаемая цель». */
export function getProtectedTargetBaseHp(player: PlayerBlock): number {
  if (player.protectedTargetBaseHp != null && Number.isFinite(player.protectedTargetBaseHp)) {
    return Math.max(1, player.protectedTargetBaseHp);
  }
  if (player.baseAllyInfantryHp != null && Number.isFinite(player.baseAllyInfantryHp)) {
    return Math.max(1, player.baseAllyInfantryHp);
  }
  if (player.baseAllyHp != null && Number.isFinite(player.baseAllyHp)) {
    return Math.max(1, player.baseAllyHp);
  }
  return 175;
}

/** Пассивный бонус от карты #17: прибавка к базе (не замена), даже если карта не в деке. */
export function getProtectedTargetHpCardBonus(
  constants: BalanceConstants,
  allSupportCardLevels: Record<number, number> | undefined
): number {
  const lvl = allSupportCardLevels?.[PROTECTED_TARGET_HP_CARD_ID] ?? 0;
  return getSupportCardNumericAtLevel(
    constants,
    PROTECTED_TARGET_HP_CARD_ID,
    lvl,
    PROTECTED_TARGET_HP_BONUS_COLUMN
  );
}

/** Итоговый max HP VIP в бою = база (Формулы) + бонус карты #17 (таблица уровня). */
export function resolveProtectedTargetMaxHp(
  constants: BalanceConstants,
  allSupportCardLevels?: Record<number, number>
): number {
  return (
    getProtectedTargetBaseHp(constants.player) +
    getProtectedTargetHpCardBonus(constants, allSupportCardLevels)
  );
}
