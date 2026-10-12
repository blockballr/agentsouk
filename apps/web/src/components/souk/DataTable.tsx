// The design's table: a head row on the nested surface over hairline rows, with the
// column widths stated once in a colgroup. Streaming a real table keeps it sortable,
// selectable and readable by a screen reader, and the widths stay exactly where the
// design put them.

import { Txt, type Weight } from './Txt';
import type { Tone } from './tokens';

export interface CellSpec {
  text: string;
  size?: number;
  lead?: number;
  weight?: Weight;
  tone?: Tone;
  mono?: boolean;
}

export interface TableRowSpec {
  height?: number;
  cells: CellSpec[];
}

export function DataTable({
  cols,
  header,
  rows,
}: {
  cols: number[];
  header: string[];
  rows: TableRowSpec[];
}) {
  return (
    <table className="w-full border-collapse">
      <colgroup>
        {cols.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <thead>
        <tr className="bg-souk-surface2">
          {header.map((h, i) => (
            <th
              key={i}
              scope="col"
              className="border-b border-r border-white/[0.16] text-left"
              style={{ padding: '8px 10px 8px 12px', height: 29 }}
            >
              <Txt size={10} lead={12} weight="bold" upper tone="steel">
                {h}
              </Txt>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>
            {r.cells.map((c, ci) => (
              <td
                key={ci}
                className="border-b border-r border-white/[0.08]"
                style={{ padding: '7px 10px 7px 12px', height: r.height ?? 30 }}
              >
                <Txt
                  size={c.size ?? 13}
                  lead={c.lead ?? 15}
                  weight={c.weight ?? 'regular'}
                  tone={c.tone ?? 'steel'}
                  mono={c.mono}
                >
                  {c.text}
                </Txt>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
