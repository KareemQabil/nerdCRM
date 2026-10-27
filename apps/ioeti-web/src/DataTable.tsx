import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Rows3 } from "lucide-react";

/**
 * A register: one table for the platform's lists. Columns sort (the rows on screen), the density and the shown columns
 * are remembered per list in this browser, and a click anywhere on a row opens it. Opening by keyboard stays on the
 * row's own link or button, so the table needs no custom key handling.
 */
export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** The value the column sorts by; without it the column does not sort. */
  sortValue?: (row: T) => string | number | null | undefined;
  /** Figures read left to right and line up at the end of the cell. */
  numeric?: boolean;
  /** An optional column can be hidden from the column menu; it starts hidden when `hidden` is set. */
  optional?: boolean;
  hidden?: boolean;
};

type View = { sort: string | null; dir: "asc" | "desc"; dense: boolean; hidden: string[] };
const KEY = (id: string) => `ioeti.table.${id}.v1`;

function readView<T>(id: string, columns: Column<T>[]): View {
  const initial: View = { sort: null, dir: "asc", dense: false, hidden: columns.filter(c => c.optional && c.hidden).map(c => c.key) };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY(id)) ?? "null") as Partial<View> | null;
    if (!saved) return initial;
    const keys = new Set(columns.map(c => c.key));
    return {
      sort: saved.sort && keys.has(saved.sort) ? saved.sort : null,
      dir: saved.dir === "desc" ? "desc" : "asc",
      dense: saved.dense === true,
      hidden: Array.isArray(saved.hidden) ? saved.hidden.filter(k => columns.some(c => c.key === k && c.optional)) : initial.hidden,
    };
  } catch { return initial; }
}

const collator = new Intl.Collator(["ar", "en"], { numeric: true, sensitivity: "base" });

export type TableLabels = {
  sortBy: (column: string) => string; columns: string; density: string; comfortable: string; compact: string;
};
export const tableLabels = (ar: boolean): TableLabels => ar
  ? { sortBy: c => "رتّب حسب " + c, columns: "الأعمدة الظاهرة", density: "كثافة الجدول", comfortable: "مريحة", compact: "مضغوطة" }
  : { sortBy: c => "Sort by " + c, columns: "Shown columns", density: "Table density", comfortable: "comfortable", compact: "compact" };

export function DataTable<T>({ id, caption, columns, rows, rowKey, onOpen, labels, toolbar, rowClassName }: {
  id: string; caption: string; columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string | number;
  onOpen?: (row: T, from: HTMLElement) => void; labels: TableLabels; toolbar?: ReactNode; rowClassName?: string;
}) {
  const [view, setView] = useState<View>(() => readView(id, columns));
  function change(next: Partial<View>) {
    setView(current => {
      const merged = { ...current, ...next };
      try { localStorage.setItem(KEY(id), JSON.stringify(merged)); } catch { /* private window: the view is not kept */ }
      return merged;
    });
  }
  const shown = columns.filter(c => !view.hidden.includes(c.key));
  const sorted = useMemo(() => {
    const column = columns.find(c => c.key === view.sort);
    if (!column?.sortValue) return rows;
    const value = column.sortValue;
    const sign = view.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = value(a), y = value(b);
      // blanks go last whichever the direction
      if (x == null || x === "") return y == null || y === "" ? 0 : 1;
      if (y == null || y === "") return -1;
      return sign * (typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y)));
    });
  }, [rows, columns, view.sort, view.dir]);

  function open(event: MouseEvent<HTMLTableRowElement>, row: T) {
    if (!onOpen) return;
    // a click on the row's own controls does what that control says
    if ((event.target as HTMLElement).closest("a,button,input,select,textarea,label")) return;
    onOpen(row, event.currentTarget);
  }

  return <div className={"data-table" + (view.dense ? " is-dense" : "")}>
    <div className="data-table-tools">
      {toolbar}
      <div className="data-table-view">
        <button type="button" className="icon-button" aria-pressed={view.dense} title={labels.density}
          aria-label={labels.density + ": " + (view.dense ? labels.compact : labels.comfortable)} onClick={() => change({ dense: !view.dense })}><Rows3 size={17}/></button>
        {columns.some(c => c.optional) && <details className="data-table-columns">
          <summary className="icon-button" aria-label={labels.columns} title={labels.columns}><Columns3 size={17}/></summary>
          <fieldset><legend>{labels.columns}</legend>
            {columns.filter(c => c.optional).map(c => <label key={c.key}>
              <input type="checkbox" checked={!view.hidden.includes(c.key)}
                onChange={e => change({ hidden: e.target.checked ? view.hidden.filter(k => k !== c.key) : [...view.hidden, c.key] })}/>{c.header}
            </label>)}
          </fieldset>
        </details>}
      </div>
    </div>
    <div className="table-scroll">
      <table aria-label={caption}>
        <thead><tr>{shown.map(c => {
          const active = view.sort === c.key;
          return <th key={c.key} className={c.numeric ? "is-numeric" : undefined}
            aria-sort={active ? (view.dir === "asc" ? "ascending" : "descending") : c.sortValue ? "none" : undefined}>
            {c.sortValue
              ? <button type="button" className="th-sort" title={labels.sortBy(c.header)}
                  onClick={() => change(active ? { dir: view.dir === "asc" ? "desc" : "asc" } : { sort: c.key, dir: "asc" })}>
                  {c.header}{active ? (view.dir === "asc" ? <ArrowUp size={13}/> : <ArrowDown size={13}/>) : <ArrowUpDown size={13} className="th-sort-idle"/>}
                </button>
              : c.header}
          </th>;
        })}</tr></thead>
        <tbody>{sorted.map(row => <tr key={rowKey(row)} className={[rowClassName, onOpen ? "is-openable" : ""].filter(Boolean).join(" ") || undefined} onClick={e => open(e, row)}>
          {shown.map(c => <td key={c.key} className={c.numeric ? "is-numeric" : undefined} dir={c.numeric ? "ltr" : undefined} data-label={c.header}>{c.cell(row)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
