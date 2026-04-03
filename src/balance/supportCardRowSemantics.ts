import type { SupportCardConfig, SupportCardManualLevel } from './model';

function num(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v)) return 0;
  return v;
}

/** Порядок колонок: явный список карточки или ключи из таблицы / param. */
export function getSupportCardColumnOrder(card: SupportCardConfig): string[] {
  const fromTable = card.tableColumns?.filter((c) => c && String(c).trim().length > 0) ?? [];
  if (fromTable.length > 0) return fromTable.map((c) => c.trim());
  const keys = new Set<string>();
  for (const row of card.manualLevels ?? []) {
    for (const k of Object.keys(row.values ?? {})) keys.add(k);
  }
  if (card.param1Name) keys.add(card.param1Name);
  if (card.param2Name && card.param2Name !== '-') keys.add(card.param2Name);
  return Array.from(keys);
}

function isEconomyColumn(c: string): boolean {
  return /карт(очек)? до уровня|монет до уровня|чертеж/i.test(c);
}

function pickNumericColumn(
  row: SupportCardManualLevel,
  order: string[],
  predicate: (col: string) => boolean
): number | undefined {
  const vals = row.values ?? {};
  const read = (col: string): number | undefined => {
    if (!predicate(col) || isEconomyColumn(col)) return undefined;
    const raw = vals[col];
    if (raw == null || !Number.isFinite(raw)) return undefined;
    return raw as number;
  };
  for (const col of order) {
    const v = read(col);
    if (v !== undefined) return v;
  }
  for (const col of Object.keys(vals)) {
    if (order.includes(col)) continue;
    const v = read(col);
    if (v !== undefined) return v;
  }
  return undefined;
}

function isCountColumn(c: string): boolean {
  if (isEconomyColumn(c)) return false;
  const s = c.toLowerCase();
  if (/количество\s+маны/i.test(s)) return false;
  return /количество|число\b|^count$/i.test(s);
}

function isHpEachColumn(c: string): boolean {
  if (isEconomyColumn(c)) return false;
  const s = c.toLowerCase();
  if (/лечени|суммарн|всего|общ(ее|ая)?\s+(хп|здоров)/i.test(s)) return false;
  return /здоровье|\bхп\b|\bhp\b/i.test(s);
}

function isHpTotalColumn(c: string): boolean {
  if (isEconomyColumn(c)) return false;
  return /суммарн|всего|общ(ее|ая)?\s*(хп|здоров)/i.test(c);
}

function isDamagePerHitColumn(c: string): boolean {
  if (isEconomyColumn(c)) return false;
  const s = c.toLowerCase();
  if (/бонус.*урона|урона.*%/.test(s)) return false;
  if (/отражен/i.test(s)) return false;
  return /урон/i.test(s);
}

function isEmpBonusColumn(c: string): boolean {
  const s = c.toLowerCase();
  return (/бонус.*урона/i.test(s) && /%|проц/i.test(s)) || /^урона.*\(+%/i.test(s.trim());
}

function isDurationColumn(c: string): boolean {
  const s = c.toLowerCase();
  if (/перезаряд/i.test(s)) return false;
  return /длительност/i.test(s);
}

function isHealPerSecColumn(c: string): boolean {
  return /лечени|хп\s*\/\s*сек|хп в сек/i.test(c);
}

function isReflectPercentColumn(c: string): boolean {
  return /отражен/i.test(c) && /%|проц/i.test(c);
}

export interface ParsedSupportCardBattleRow {
  columnOrder: string[];
  count: number;
  allyHpEach: number;
  allyHpTotal: number;
  damagePerHit: number;
  durationSec: number;
  damageBonusPercent: number;
  healPerSec: number;
  reflectPercent: number;
  speed: number;
  attackRange: number;
  fireRate: number;
  blastRadius: number;
  param1: number;
  param2: number;
}

/**
 * Снимает все числовые боевые параметры из строки уровня по заголовкам колонок.
 * Порядок колонок (tableColumns) задаёт приоритет, если совпадает несколько шаблонов.
 */
export function parseSupportCardBattleRow(
  row: SupportCardManualLevel,
  card: SupportCardConfig
): ParsedSupportCardBattleRow {
  const columnOrder = getSupportCardColumnOrder(card);
  const vals = row.values ?? {};
  const param1 = num(vals[card.param1Name]);
  const param2 = card.param2Name && card.param2Name !== '-' ? num(vals[card.param2Name]) : 0;

  const cPick = (pred: (col: string) => boolean) => pickNumericColumn(row, columnOrder, pred) ?? 0;

  return {
    columnOrder,
    count: cPick(isCountColumn),
    allyHpEach: cPick(isHpEachColumn),
    allyHpTotal: cPick(isHpTotalColumn),
    damagePerHit: cPick(isDamagePerHitColumn),
    durationSec: cPick(isDurationColumn),
    damageBonusPercent: cPick(isEmpBonusColumn),
    healPerSec: cPick(isHealPerSecColumn),
    reflectPercent: cPick(isReflectPercentColumn),
    speed: cPick((k) => /^скорость/i.test(k.trim())),
    attackRange: cPick((k) => /дальность/i.test(k)),
    fireRate: cPick((k) => /скорострельность/i.test(k)),
    blastRadius: cPick((k) => /радиус/i.test(k)),
    param1,
    param2,
  };
}

/** Текст подсказки для UI редактора колонок. */
export const SUPPORT_CARD_BATTLE_COLUMN_HINT = `Симулятор и прогноз читают заголовки колонок (без учёта регистра): количество / число — численность; здоровье / ХП — HP одного союзника; суммарное (или всего) здоровье / ХП — общий пул HP; урон — урон за попадание (для расчёта DPS вместе со скорострельностью); бонус урона (%) — ЭМИ; длительность — время эффекта; лечение / ХП/сек — ремонтный дрон; отражение (%) — поле; мана; перезарядка; скорость; дальность; скорострельность; радиус. Колонки «Карточек/Монет до уровня» в бою не используются.`;
