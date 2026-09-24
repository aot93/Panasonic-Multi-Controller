import type { DatabaseSync } from 'node:sqlite';

/**
 * Macro-calls-macro graph helpers, shared by the write-time gate
 * (macros/routes.ts, rejects a save that would close a loop) and the
 * import-time gate (project/export-import.ts, which adds many macros —
 * and therefore many new graph edges — in one transaction).
 */

export type MacroCallGraph = Map<number, number[]>;

/** Loads every existing macro-calls-macro edge (`macro_steps.step_kind = 'macro'`) into an adjacency list. */
export function loadMacroCallGraph(db: DatabaseSync): MacroCallGraph {
  const rows = db
    .prepare("SELECT macro_id, child_macro_id FROM macro_steps WHERE step_kind = 'macro'")
    .all() as unknown as { macro_id: number; child_macro_id: number }[];
  const graph: MacroCallGraph = new Map();
  for (const row of rows) {
    const list = graph.get(row.macro_id);
    if (list) list.push(row.child_macro_id);
    else graph.set(row.macro_id, [row.child_macro_id]);
  }
  return graph;
}

/** True if `to` is reachable from `from` by following existing macro-call edges (BFS), `from === to` included. */
export function canReach(graph: MacroCallGraph, from: number, to: number): boolean {
  if (from === to) return true;
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of graph.get(current) ?? []) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/** Records a new edge in an in-memory graph (used when validating several new edges in sequence, e.g. project import). */
export function addEdge(graph: MacroCallGraph, from: number, to: number): void {
  const list = graph.get(from);
  if (list) list.push(to);
  else graph.set(from, [to]);
}
