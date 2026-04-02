import sheetCardsRaw from '../../support_cards_sheet.json';

type SheetLevelRow = {
  level: number;
  values: Record<string, string | null>;
  costs?: Record<string, string | null>;
};

type SheetCardRow = {
  title: string;
  headers: Array<string | null>;
  rows: SheetLevelRow[];
};

export interface SupportCardTableLevel {
  level: number;
  values: Record<string, number | null>;
}

export interface SupportCardTableReference {
  id: number;
  name: string;
  tableColumns: string[];
  manualLevels: SupportCardTableLevel[];
}

const COST_HEADERS = new Set(['Карточек до уровня', 'Монет до уровня']);

function parseNumber(value: string | null | undefined): number | null {
  if (value == null || value === '') return null;
  // Нормализуем типичные форматы из Google Sheets/Excel:
  // - "1,5" => "1.5"
  // - "45%" => "45"
  // - пробелы
  const normalized = value
    .trim()
    .replace(/%/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCardTitle(title: string): { id: number; name: string } {
  const match = title.match(/^(\d+)\.\s*(.+)$/);
  if (!match) {
    return { id: 0, name: title };
  }
  return {
    id: Number(match[1]) || 0,
    name: match[2],
  };
}

export const SUPPORT_CARD_REFERENCE: SupportCardTableReference[] = (sheetCardsRaw as SheetCardRow[]).map((card) => {
  const { id, name } = parseCardTitle(card.title);
  // Важно: мапим заголовки на реальные колонки по их индексу в `headers`.
  // `headers[0]` соответствует колонке 'B', `headers[1]` => 'C' и т.д.
  const tableEntries = card.headers
    .map((header, headerIndex) => ({ header, headerIndex }))
    .filter((e): e is { header: string; headerIndex: number } => e.header != null && !COST_HEADERS.has(e.header));

  const tableColumns = tableEntries.map((e) => e.header);
  const manualLevels = card.rows
    .filter((row) => row.level != null)
    .map((row) => {
      const values: Record<string, number | null> = {};
      tableEntries.forEach(({ header, headerIndex }) => {
        const columnCode = String.fromCharCode(66 + headerIndex);
        values[header] = parseNumber(row.values[columnCode]);
      });
      return {
        level: row.level,
        values,
      };
    });

  return {
    id,
    name,
    tableColumns,
    manualLevels,
  };
});
