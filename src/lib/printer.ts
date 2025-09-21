import { table, getBorderCharacters, type TableUserConfig } from 'table';
import { c } from './colors.js';

export const BOX_TABLE_CONFIG: TableUserConfig = {
  border: getBorderCharacters('ramac'),
  columnDefault: {
    paddingLeft: 1,
    paddingRight: 1,
  },
};

export function renderBoxTable(rows: string[][], config: TableUserConfig = BOX_TABLE_CONFIG): string[] {
  if (rows.length === 0) {
    return [];
  }
  return table(rows, config).trimEnd().split('\n');
}

export interface OutputOptions {
  json?: boolean;
}

export interface TableColumn<T> {
  header: string;
  value: (row: T) => string;
}

export function printOutput<T>(data: T, lines: string[], options: OutputOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  for (const line of lines) {
    console.log(line);
  }
}

export function formatTable<T>(rows: T[], columns: TableColumn<T>[]): string[] {
  if (rows.length === 0) {
    return [];
  }
  const colWidths = columns.map((col) => col.header.length);
  const cellValues = rows.map((row) =>
    columns.map((col, idx) => {
      const value = col.value(row);
      if (value.length > colWidths[idx]) {
        colWidths[idx] = value.length;
      }
      return value;
    }),
  );

  const header = columns
    .map((col, idx) => c.bold(padRight(col.header, colWidths[idx])))
    .join('  ');
  const separator = columns
    .map((_, idx) => '-'.repeat(colWidths[idx]))
    .join('  ');
  const lines = cellValues.map((row) => row.map((value, idx) => padRight(value, colWidths[idx])).join('  '));
  return [header, separator, ...lines];
}

export function formatKeyValues(pairs: Array<[string, string]>): string[] {
  if (pairs.length === 0) {
    return [];
  }
  const width = Math.max(...pairs.map(([key]) => key.length));
  return pairs.map(([key, value]) => `${c.dim(padRight(key, width))} : ${value}`);
}

function padRight(text: string, width: number): string {
  if (text.length >= width) {
    return text;
  }
  return text + ' '.repeat(width - text.length);
}
