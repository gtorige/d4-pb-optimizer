// Steiner-tree-based optimizer.
//
// Goal: include EVERY user-selected (rare/magic/legendary/glyph) cell using
// the minimum number of total paragon points across all chained boards. Budget
// is informational; we use only what's needed.
//
// Per board:
//   1. Build the activatable graph (cells passing filters / not disabled).
//   2. Determine required terminals:
//      - Board 0: the start cell.
//      - Any board with a pinned glyph: its socket cell.
//      - All cells the user marked as "force include" via selectedNodes[k]=true.
//      - Plus an entry gate (boards > 0) and an exit gate (non-last boards).
//   3. Pick the entry/exit gate(s) that are closest (BFS distance) to the
//      required cell cluster, so Steiner cost is minimized.
//   4. Solve NW Steiner Tree on (graph, terminals) -> minimum connected set.

import { rotateBoard } from "./rotation.js";
import { steinerTree } from "./steiner.js";

const parseKey = (k) => k.split(",").map(Number);
const keyOf = (r, c) => r + "," + c;

function neighborKeys(k, size) {
  const [r, c] = parseKey(k);
  const out = [];
  if (r > 0) out.push(keyOf(r - 1, c));
  if (r < size - 1) out.push(keyOf(r + 1, c));
  if (c > 0) out.push(keyOf(r, c - 1));
  if (c < size - 1) out.push(keyOf(r, c + 1));
  return out;
}

function passesFilter(cell, filters, selectedNodes) {
  if (!cell || cell.type === "empty") return false;
  if (cell.disabled) return false;
  const ov = cell.srcKey && selectedNodes ? selectedNodes[cell.srcKey] : undefined;
  if (ov === false) return false;
  if (ov === true) return true;
  if (!filters) return true;
  if (cell.type === "magic" && !filters.magic) return false;
  if (cell.type === "rare" && !filters.rare) return false;
  if (cell.type === "legendary" && !filters.legendary) return false;
  return true;
}

function bfsDist(start, graph, size) {
  const dist = new Map([[start, 0]]);
  const q = [start];
  let h = 0;
  while (h < q.length) {
    const k = q[h++];
    for (const n of neighborKeys(k, size)) {
      if (!graph.has(n) || dist.has(n)) continue;
      dist.set(n, dist.get(k) + 1);
      q.push(n);
    }
  }
  return dist;
}

/** Pick the gate closest (min BFS dist) to any anchor cell. */
function chooseClosestGate(gates, anchors, graph, size) {
  if (!gates.length) return null;
  if (!anchors.length) return gates[0];
  let best = null, bestD = Infinity;
  for (const g of gates) {
    const d = bfsDist(g, graph, size);
    let minD = Infinity;
    for (const a of anchors) {
      const da = d.get(a);
      if (da != null && da < minD) minD = da;
    }
    if (minD < bestD) { bestD = minD; best = g; }
  }
  return best;
}

/** Build per-slot context (rotated board, graph, terminals, gates). */
function buildSlot(state, bi) {
  const slot = state.chain[bi];
  const baseBoard = state.boards[slot.boardIndex];
  const rotated = slot.rotation ? rotateBoard(baseBoard, slot.rotation) : baseBoard;
  const size = rotated.size;
  const graph = new Set();
  const gates = [];
  let startCell = null;
  let socketCell = null;
  const forced = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = rotated.cells[r][c];
      if (!passesFilter(cell, slot.filters, slot.selectedNodes)) continue;
      const k = keyOf(r, c);
      graph.add(k);
      if (cell.type === "start") startCell = k;
      if (cell.type === "gate") gates.push(k);
      if (cell.type === "socket" && slot.pinnedGlyph) socketCell = k;
      if (cell.srcKey && slot.selectedNodes[cell.srcKey] === true) forced.push(k);
    }
  }
  return { slot, rotated, graph, gates, startCell, socketCell, forced };
}

/**
 * Steiner-based optimizer.
 * @param {AppState} state
 * @returns {{ solution, totalPoints, perBoardCounts, activeBoards, ctx, infeasibleBoards }}
 */
export function optimizeSteiner(state) {
  const N = state.chain.length;
  if (N === 0) throw new Error("Empty chain.");

  const slots = [];
  for (let bi = 0; bi < N; bi++) slots.push(buildSlot(state, bi));

  // Pick entry/exit gates per board
  for (let bi = 0; bi < N; bi++) {
    const s = slots[bi];
    const isLast = bi === N - 1;
    // Anchor cells: start (board 0), forced nodes, glyph socket.
    const anchors = [s.startCell, s.socketCell, ...s.forced].filter(Boolean);
    if (bi === 0) {
      s.entryGate = null;
      s.exitGate = isLast ? null : chooseClosestGate(s.gates, anchors.length ? anchors : s.gates, s.graph, s.rotated.size);
    } else {
      s.entryGate = chooseClosestGate(s.gates, anchors.length ? anchors : s.gates, s.graph, s.rotated.size);
      if (isLast) {
        s.exitGate = null;
      } else {
        const remaining = s.gates.filter(g => g !== s.entryGate);
        const newAnchors = [...anchors, s.entryGate];
        s.exitGate = chooseClosestGate(remaining, newAnchors, s.graph, s.rotated.size);
      }
    }
  }

  // Solve per board
  const activated = [];
  const perBoardCounts = [];
  const infeasibleBoards = [];
  for (let bi = 0; bi < N; bi++) {
    const s = slots[bi];
    const terms = new Set([
      s.startCell,
      s.socketCell,
      s.entryGate,
      s.exitGate,
      ...s.forced,
    ].filter(Boolean));
    if (terms.size === 0) {
      activated.push(new Set());
      perBoardCounts.push(0);
      continue;
    }
    const tree = steinerTree(s.graph, s.rotated.size, [...terms]);
    if (!tree) {
      // Couldn't find a tree — terminals weren't all reachable. Treat as infeasible
      // and put just the terminals so the user can see what was requested.
      infeasibleBoards.push(bi);
      const fallback = new Set(terms);
      activated.push(fallback);
      perBoardCounts.push(fallback.size);
    } else {
      activated.push(tree);
      perBoardCounts.push(tree.size);
    }
  }

  // Glyph assignment: respect pinnedGlyph; for unpinned slots, assign any
  // remaining glyph by chain order, anchored to their socket if activated.
  const glyphs = new Array(N).fill(null);
  const glyphSocket = new Array(N).fill(null);
  const pinned = state.chain.map(s => s.pinnedGlyph || null);
  const usedIds = new Set(pinned.filter(Boolean));
  const pool = state.glyphs.map(g => g.id).filter(id => !usedIds.has(id));
  for (let bi = 0; bi < N; bi++) {
    if (pinned[bi]) glyphs[bi] = pinned[bi];
    else if (pool.length) glyphs[bi] = pool.shift();
  }
  // Pick socket cell if it's in the activated set
  for (let bi = 0; bi < N; bi++) {
    if (!glyphs[bi]) continue;
    const s = slots[bi];
    for (let r = 0; r < s.rotated.size; r++) {
      for (let c = 0; c < s.rotated.size; c++) {
        if (s.rotated.cells[r][c]?.type !== "socket") continue;
        const k = keyOf(r, c);
        if (activated[bi].has(k)) { glyphSocket[bi] = k; break; }
      }
      if (glyphSocket[bi]) break;
    }
  }

  // countActiveBoards (same logic as the SA solver) — needs to know which
  // boards are properly chained gate-to-gate.
  const idxLike = slots.map(s => ({
    size: s.rotated.size,
    gateKeys: s.gates,
    startKey: s.startCell,
  }));
  const activeBoards = [];
  for (let bi = 0; bi < N; bi++) {
    const act = activated[bi];
    if (!act || act.size === 0) break;
    const idx = idxLike[bi];
    const isLast = bi === N - 1;
    let gates = 0;
    for (const g of idx.gateKeys) if (act.has(g)) gates++;
    if (bi === 0) {
      if (!isLast && gates < 1) break;
    } else {
      if (gates < 1) break;
      if (!isLast && gates < 2) break;
    }
    activeBoards.push(bi);
  }

  const totalPoints = perBoardCounts.reduce((a, b) => a + b, 0);

  return {
    solution: { activated, glyphs, glyphSocket },
    totalPoints,
    perBoardCounts,
    activeBoards,
    infeasibleBoards,
    score: -totalPoints, // for compatibility with display
    stats: collectStats(state, slots, activated),
    rotations: state.chain.map(s => s.rotation || 0),
    ctx: {
      chain: state.chain,
      idx: slots.map(s => ({
        size: s.rotated.size,
        types: new Map(),
        stats: new Map(),
        startKey: s.startCell,
        gateKeys: s.gates,
        socketKeys: [],
        magicKeys: [],
        rotated: s.rotated,
      })),
      glyphs: state.glyphs,
      buckets: state.buckets,
      baseValue: state.baseValue,
      pointBudget: state.pointBudget,
      glyphRadius: state.glyphRadius,
    },
  };
}

function collectStats(state, slots, activated) {
  const stats = {};
  const add = (s) => { if (!s) return; for (const k in s) stats[k] = (stats[k] || 0) + s[k]; };
  for (let bi = 0; bi < state.chain.length; bi++) {
    const s = slots[bi];
    for (const k of activated[bi]) {
      const [r, c] = parseKey(k);
      const cell = s.rotated.cells[r][c];
      add(cell?.stats);
    }
  }
  return stats;
}
