// The output contract is part of the CLI, not an afterthought: a pipe gets JSON,
// a terminal gets a table, and --quiet prints identifiers so shell composition
// stays possible without parsing either.
export type Format = "table" | "json" | "quiet";

export interface FormatChoice {
  json?: boolean;
  quiet?: boolean;
  output?: string;
  tty?: boolean;
}

export function pickFormat(choice: FormatChoice): Format {
  if (choice.output === "json" || choice.output === "table" || choice.output === "quiet") {
    return choice.output;
  }
  if (choice.json) return "json";
  if (choice.quiet) return "quiet";
  return choice.tty === false ? "json" : "table";
}

export interface Column {
  key: string;
  label: string;
  width?: number;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (Array.isArray(value)) return value.length > 0 ? value.join(",") : "-";
  if (typeof value === "object") {
    const text = JSON.stringify(value);
    return text && text !== "{}" ? text : "-";
  }
  return String(value);
}

export function renderTable(rows: readonly object[], columns: Column[]): string {
  const widths = columns.map((column) => {
    const widest = rows.reduce(
      (max, row) => Math.max(max, cell((row as Record<string, unknown>)[column.key]).length),
      column.label.length,
    );
    return Math.min(column.width ?? 40, widest);
  });
  const line = (values: string[]) =>
    values
      .map((value, index) => value.slice(0, widths[index]).padEnd(widths[index]))
      .join("  ")
      .trimEnd();
  const head = line(columns.map((column) => column.label.toUpperCase()));
  const body = rows.map((row) => line(columns.map((column) => cell((row as Record<string, unknown>)[column.key]))));
  return [head, ...body].join("\n");
}

export interface EnvelopeMeta {
  [key: string]: unknown;
}

export function renderJson(data: unknown, meta?: EnvelopeMeta): string {
  return JSON.stringify(meta ? { data, meta } : { data }, null, 2);
}
