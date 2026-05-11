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

// Priority order for dropping terminals when over budget. Lower priority is
// dropped first; chain-validity terminals (start, entry/exit gates) are never
// in this map and are never dropped.
const DROP_PRIORITY = { magic: 0, rare: 1, socket: 2, legendary: 3 };

// Dreyfus-Wagner is exponential in the terminal count: O(3^k * V + 2^k * V^2).
// For our boards (V ~75) it runs comfortably for k <= 10 (~1-2s); past that it
// gets uncomfortable. We pre-shrink each board to this cap before solving.
const MAX_TERMINALS_PER_BOARD = 10;

/** Find the lowest-priority droppable terminal across all boards. Returns
 *  `{ bi, key, type, label }` or null when nothing else can be dropped. */
function findDroppable(slots, terminalsPerBoard) {
  let best = null;
  for (let bi = 0; bi < slots.length; bi++) {
    const cand = findDroppableInBoard(slots[bi], terminalsPerBoard[bi]);
    if (cand && (!best || cand.rank < best.rank)) best = { bi, ...cand };
  }
  return best;
}

function findDroppableInBoard(s, terms) {
  let best = null;
  for (const k of terms) {
    if (k === s.startCell || k === s.entryGate || k === s.exitGate) continue;
    const [r, c] = parseKey(k);
    const cell = s.rotated.cells[r]?.[c];
    const type = cell?.type;
    if (!(type in DROP_PRIORITY)) continue;
    const rank = DROP_PRIORITY[type];
    if (!best || rank < best.rank) {
      best = { key: k, type, label: cell?.label || cell?.nodeId || k, rank };
    }
  }
  return best;
}

/** Build per-slot context (rotated board, graph, terminals, gates). */
function buildSlot(state, bi, rotationOverride) {
  const slot = state.chain[bi];
  const baseBoard = state.boards[slot.boardIndex];
  const rotation = rotationOverride != null ? rotationOverride : (slot.rotation || 0);
  const rotated = rotation ? rotateBoard(baseBoard, rotation) : baseBoard;
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
  return { slot, rotated, rotation, graph, gates, startCell, socketCell, forced };
}

/** Pick gates + solve once for a given slot context. Returns { tree, terminals }. */
function solveSlot(s) {
  const isLast = s.isLast;
  const anchors = [s.startCell, s.socketCell, ...s.forced].filter(Boolean);
  let entryGate = null, exitGate = null;
  if (s.firstSlot) {
    entryGate = null;
    exitGate = isLast ? null : chooseClosestGate(s.gates, anchors.length ? anchors : s.gates, s.graph, s.rotated.size);
  } else {
    entryGate = chooseClosestGate(s.gates, anchors.length ? anchors : s.gates, s.graph, s.rotated.size);
    if (isLast) exitGate = null;
    else {
      const remaining = s.gates.filter(g => g !== entryGate);
      exitGate = chooseClosestGate(remaining, [...anchors, entryGate], s.graph, s.rotated.size);
    }
  }
  const terms = new Set([s.startCell, s.socketCell, entryGate, exitGate, ...s.forced].filter(Boolean));
  if (terms.size === 0) return { tree: new Set(), entryGate, exitGate, terminals: terms };
  const tree = steinerTree(s.graph, s.rotated.size, [...terms]);
  return { tree, entryGate, exitGate, terminals: terms };
}

/**
 * Steiner-based optimizer.
 * @param {AppState} state
 * @returns {{ solution, totalPoints, perBoardCounts, activeBoards, ctx, infeasibleBoards }}
 */
export function optimizeSteiner(state) {
  const N = state.chain.length;
  if (N === 0) throw new Error("Empty chain.");

  // Build slot contexts. When tryAllRotations is on, try all 4 rotations per
  // board and pick the rotation that yields the smallest Steiner tree.
  const tryRotations = !!state.tryAllRotations;
  const slots = [];
  for (let bi = 0; bi < N; bi++) {
    const isLast = bi === N - 1;
    const firstSlot = bi === 0;
    let best = null;
    const rots = tryRotations ? [0, 1, 2, 3] : [state.chain[bi].rotation || 0];
    for (const rot of rots) {
      const ctx = buildSlot(state, bi, rot);
      ctx.firstSlot = firstSlot;
      ctx.isLast = isLast;
      const solved = solveSlot(ctx);
      const size = solved.tree ? solved.tree.size : Infinity;
      if (!best || size < best.size) {
        best = { ctx, ...solved, size };
      }
    }
    const s = best.ctx;
    s.entryGate = best.entryGate;
    s.exitGate = best.exitGate;
    s._precomputed = best.tree; // cache for first solve
    slots.push(s);
  }

  // Solve per board (first pass, with all required terminals)
  const activated = [];
  const perBoardCounts = [];
  const infeasibleBoards = [];
  // Track terminals per board so we can drop them if the budget is too tight.
  const terminalsPerBoard = slots.map(s => new Set([
    s.startCell, s.socketCell, s.entryGate, s.exitGate, ...s.forced,
  ].filter(Boolean)));

  function recomputeBoard(bi) {
    const s = slots[bi];
    const terms = terminalsPerBoard[bi];
    if (terms.size === 0) {
      activated[bi] = new Set();
      perBoardCounts[bi] = 0;
      return;
    }
    const tree = steinerTree(s.graph, s.rotated.size, [...terms]);
    if (!tree) {
      if (!infeasibleBoards.includes(bi)) infeasibleBoards.push(bi);
      const fallback = new Set(terms);
      activated[bi] = fallback;
      perBoardCounts[bi] = fallback.size;
    } else {
      activated[bi] = tree;
      perBoardCounts[bi] = tree.size;
      const idx = infeasibleBoards.indexOf(bi);
      if (idx >= 0) infeasibleBoards.splice(idx, 1);
    }
  }

  // Pre-shrink each board to at most MAX_TERMINALS_PER_BOARD before solving,
  // otherwise Dreyfus-Wagner's O(3^k V) blows up.
  const dropped = [];
  for (let bi = 0; bi < N; bi++) {
    while (terminalsPerBoard[bi].size > MAX_TERMINALS_PER_BOARD) {
      const cand = findDroppableInBoard(slots[bi], terminalsPerBoard[bi]);
      if (!cand) break;
      terminalsPerBoard[bi].delete(cand.key);
      dropped.push({ bi, ...cand, reason: "too-many-terminals" });
    }
    activated.push(null); perBoardCounts.push(0);
    recomputeBoard(bi);
  }

  // Auto-shrink to fit the user's point budget. Drop required terminals in
  // increasing priority — keep legendaries + glyph sockets + chain gates +
  // start cell as long as possible; sacrifice magics first, then rares.
  const budget = Math.max(0, state.pointBudget | 0);
  if (budget > 0) {
    let total = perBoardCounts.reduce((a, b) => a + b, 0);
    let safety = 200; // hard cap on shrink iterations
    while (total > budget && safety-- > 0) {
      const cand = findDroppable(slots, terminalsPerBoard);
      if (!cand) break; // nothing more we can drop
      terminalsPerBoard[cand.bi].delete(cand.key);
      dropped.push({ ...cand, reason: "budget" });
      recomputeBoard(cand.bi);
      total = perBoardCounts.reduce((a, b) => a + b, 0);
    }
    // Re-add pass: dropping a single magic at the tip of a long path can
    // collapse 5-10 cells, over-shrinking the tree. Walk the dropped list in
    // reverse priority order and re-add each one that still fits. Cap the
    // number of recompute attempts so we don't burn 30+ seconds on builds
    // with dozens of marks.
    let attempts = 0;
    const MAX_READD_ATTEMPTS = 8;
    for (let i = dropped.length - 1; i >= 0 && attempts < MAX_READD_ATTEMPTS; i--) {
      if (dropped[i].reason !== "budget") continue;
      attempts++;
      const d = dropped[i];
      const prevCount = perBoardCounts[d.bi];
      terminalsPerBoard[d.bi].add(d.key);
      recomputeBoard(d.bi);
      const newTotal = perBoardCounts.reduce((a, b) => a + b, 0);
      if (newTotal <= budget) {
        dropped.splice(i, 1); // keep
      } else {
        terminalsPerBoard[d.bi].delete(d.key);
        perBoardCounts[d.bi] = prevCount;
        recomputeBoard(d.bi);
      }
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

  const overBudget = budget > 0 && totalPoints > budget;
  return {
    solution: { activated, glyphs, glyphSocket },
    totalPoints,
    perBoardCounts,
    activeBoards,
    infeasibleBoards,
    dropped,                     // [{ bi, key, type, label }] — terminals removed to fit budget
    overBudget,                  // true if still over budget after auto-shrink
    pointBudget: budget,
    missingRequired: dropped.length,
    score: -totalPoints, // for compatibility with display
    stats: collectStats(state, slots, activated),
    rotations: slots.map(s => s.rotation || 0),
    order: state.chain.map(s => s.boardIndex),
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
