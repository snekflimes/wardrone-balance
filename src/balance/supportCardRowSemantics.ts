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

/** Пресет колонки: columnTitle — точный заголовок в таблице (совпадает с логикой парсера). */
export interface SupportCardBattleParameterPreset {
  id: string;
  group: string;
  /** Короткая подпись в выпадающем списке */
  label: string;
  columnTitle: string;
  /** Подсказка при наведении */
  effectHint?: string;
}

/**
 * Известные параметры: добавляйте только через код (парсер + симулятор), затем сюда — появятся в UI.
 * Новые боевые смыслы сначала добавляются в parseSupportCardBattleRow / supportCardManaCombat.
 */
export const SUPPORT_CARD_BATTLE_PARAMETER_PRESETS: SupportCardBattleParameterPreset[] = [
  {
    id: 'mana',
    group: 'Стоимость и тайминг карты',
    label: 'Мана',
    columnTitle: 'Мана',
    effectHint: 'Стоимость розыгрыша; ищется по слову «мана»',
  },
  {
    id: 'cooldown',
    group: 'Стоимость и тайминг карты',
    label: 'Перезарядка (сек)',
    columnTitle: 'Перезарядка (сек)',
    effectHint: 'Кулдаун после применения',
  },
  {
    id: 'cooldown_sheet',
    group: 'Стоимость и тайминг карты',
    label: 'Перезарядка, сек',
    columnTitle: 'Перезарядка, сек',
    effectHint: 'Тот же смысл, что «Перезарядка (сек)»',
  },
  {
    id: 'count_units',
    group: 'Призыв и урон',
    label: 'Количество (юнитов)',
    columnTitle: 'Количество',
    effectHint: 'Численность; не путать с «Количество маны»',
  },
  {
    id: 'count_drones',
    group: 'Призыв и урон',
    label: 'Количество дронов',
    columnTitle: 'Количество дронов',
    effectHint: 'Численность (шаблон «количество»)',
  },
  {
    id: 'mana_amount',
    group: 'Стоимость и тайминг карты',
    label: 'Количество маны',
    columnTitle: 'Количество маны',
    effectHint: 'Если в листе отдельная колонка; не считается как число юнитов',
  },
  {
    id: 'hp_each',
    group: 'Призыв и урон',
    label: 'Здоровье (на юнита)',
    columnTitle: 'Здоровье',
    effectHint: 'HP одного союзника',
  },
  {
    id: 'hp_total',
    group: 'Призыв и урон',
    label: 'Суммарное здоровье',
    columnTitle: 'Суммарное здоровье',
    effectHint: 'Общий пул HP отряда',
  },
  {
    id: 'damage',
    group: 'Призыв и урон',
    label: 'Урон (за попадание)',
    columnTitle: 'Урон',
    effectHint: 'Урон за выстрел; DPS вместе со скорострельностью',
  },
  {
    id: 'damage_drone',
    group: 'Призыв и урон',
    label: 'Урон дрона',
    columnTitle: 'Урон дрона',
    effectHint: 'Урон за попадание (шаблон «урон»)',
  },
  {
    id: 'emp_bonus',
    group: 'Призыв и урон',
    label: 'Бонус урона (%)',
    columnTitle: 'Бонус урона (%)',
    effectHint: 'ЭМИ и подобные проценты',
  },
  {
    id: 'duration',
    group: 'Эффекты',
    label: 'Длительность (сек)',
    columnTitle: 'Длительность (сек)',
    effectHint: 'Время действия эффекта',
  },
  {
    id: 'heal_per_sec',
    group: 'Эффекты',
    label: 'Лечение (ХП/сек)',
    columnTitle: 'Лечение (ХП/сек)',
    effectHint: 'Ремонт / реген',
  },
  {
    id: 'reflect',
    group: 'Эффекты',
    label: 'Отражение (%)',
    columnTitle: 'Отражение (%)',
    effectHint: 'Отражающее поле',
  },
  {
    id: 'speed',
    group: 'Характеристики на поле',
    label: 'Скорость',
    columnTitle: 'Скорость',
    effectHint: 'Множители HP/DPS союзника',
  },
  {
    id: 'range',
    group: 'Характеристики на поле',
    label: 'Дальность',
    columnTitle: 'Дальность',
    effectHint: 'Дистанция атаки',
  },
  {
    id: 'range_attack',
    group: 'Характеристики на поле',
    label: 'Дальность атаки',
    columnTitle: 'Дальность атаки',
    effectHint: 'Как колонка «Дальность»',
  },
  {
    id: 'fire_rate',
    group: 'Характеристики на поле',
    label: 'Скорострельность',
    columnTitle: 'Скорострельность',
    effectHint: 'Выстр/сек или RPM в зависимости от величины',
  },
  {
    id: 'blast_radius',
    group: 'Характеристики на поле',
    label: 'Радиус',
    columnTitle: 'Радиус',
    effectHint: 'Взрыв / зона поражения',
  },
  {
    id: 'radius_damage',
    group: 'Характеристики на поле',
    label: 'Радиус урона',
    columnTitle: 'Радиус урона',
    effectHint: 'Как колонка «Радиус»',
  },
  {
    id: 'econ_cards',
    group: 'Экономика (в бою не читается)',
    label: 'Карточек до уровня',
    columnTitle: 'Карточек до уровня',
    effectHint: 'Только для таблицы прогрессии',
  },
  {
    id: 'econ_coins',
    group: 'Экономика (в бою не читается)',
    label: 'Монет до уровня',
    columnTitle: 'Монет до уровня',
    effectHint: 'Только для таблицы прогрессии',
  },
];

/** Один вариант на заголовок колонки (для выпадающих списков без дублирующихся value). */
export function dedupeSupportCardPresetsByColumnTitle(
  presets: SupportCardBattleParameterPreset[]
): SupportCardBattleParameterPreset[] {
  const seen = new Set<string>();
  const out: SupportCardBattleParameterPreset[] = [];
  for (const p of presets) {
    const k = p.columnTitle.trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** Колонка уже есть в карточке (без учёта регистра и лишних пробелов). */
export function supportCardHasColumnTitle(card: SupportCardConfig, columnTitle: string): boolean {
  const t = columnTitle.trim().toLowerCase();
  return getSupportCardColumnOrder(card).some((c) => c.trim().toLowerCase() === t);
}

/** Пресеты плюс param1/param2 из конфига карточки (если заданы и не дублируют стандартный заголовок). */
export function getSupportCardParameterPresetsForCard(card: SupportCardConfig): SupportCardBattleParameterPreset[] {
  const out = [...SUPPORT_CARD_BATTLE_PARAMETER_PRESETS];
  const presetTitles = new Set(
    SUPPORT_CARD_BATTLE_PARAMETER_PRESETS.map((p) => p.columnTitle.trim().toLowerCase())
  );
  const p1 = card.param1Name?.trim();
  if (p1 && !presetTitles.has(p1.toLowerCase())) {
    out.push({
      id: 'sheet_param1',
      group: 'Поля с листа (имена из карточки)',
      label: `Параметр 1: ${p1}`,
      columnTitle: p1,
      effectHint: 'Совпадает с полем param1Name',
    });
  }
  const p2 = card.param2Name?.trim();
  if (
    p2 &&
    p2 !== '-' &&
    !presetTitles.has(p2.toLowerCase()) &&
    (!p1 || p2.toLowerCase() !== p1.toLowerCase())
  ) {
    out.push({
      id: 'sheet_param2',
      group: 'Поля с листа (имена из карточки)',
      label: `Параметр 2: ${p2}`,
      columnTitle: p2,
      effectHint: 'Совпадает с полем param2Name',
    });
  }
  return out;
}

/** Колонка из пресета или совпадает с param1/param2 карточки. */
export function isSupportCardColumnRecognized(card: SupportCardConfig, columnTitle: string): boolean {
  const t = columnTitle.trim().toLowerCase();
  if (SUPPORT_CARD_BATTLE_PARAMETER_PRESETS.some((p) => p.columnTitle.trim().toLowerCase() === t)) return true;
  const p1 = card.param1Name?.trim().toLowerCase();
  if (p1 && p1 === t) return true;
  const p2 = card.param2Name?.trim().toLowerCase();
  if (p2 && p2 !== '-' && p2 === t) return true;
  return false;
}
