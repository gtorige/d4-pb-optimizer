// Simulated-annealing paragon-route + glyph-placement solver.
import { evaluate } from "./damage.js";
import { rotateBoard, rotateKey } from "./rotation.js";

/** @typedef {import('./state.js').AppState} AppState */
/** @typedef {import('./state.js').ChainSlot} ChainSlot */

const key = (r, c) => r + "," + c;
const parseKey = (k) => k.split(",").map(Number);

// Seeded RNG (mulberry32)
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t |= 0; t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns true iff a cell should be treated as activatable given the slot's filters
 *  and per-node overrides. Per-node selection wins over the global tier filter. */
function passesFilter(cell, filters, selectedNodes) {
  if (!cell || cell.type === "empty") return false;
  if (cell.disabled) return false;
  // per-node override (from the slot's selectedNodes map, keyed by srcKey)
  const ov = cell.srcKey && selectedNodes ? selectedNodes[cell.srcKey] : undefined;
  if (ov === false) return false;
  if (ov === true) return true;
  if (!filters) return true;
  if (cell.type === "magic" && !filters.magic) return false;
  if (cell.type === "rare" && !filters.rare) return false;
  if (cell.type === "legendary" && !filters.legendary) return false;
  // start / gate / socket / normal always pass
  return true;
}

/** Precompute per-board metadata for a given slot (handles rotation + filters). */
function indexSlot(board, slot) {
  const rotated = slot.rotation ? rotateBoard(board, slot.rotation) : board;
  const size = rotated.size;
  const cells = rotated.cells;
  const types = new Map();
  const stats = new Map();
  const startKey = [];
  const gateKeys = [];
  const socketKeys = [];
  const magicKeys = [];
  const requiredKeys = new Set();
  const sel = slot.selectedNodes || {};
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const cell = cells[r][c];
    if (!passesFilter(cell, slot.filters, sel)) continue;
    const k = key(r, c);
    types.set(k, cell.type);
    if (cell.stats && Object.keys(cell.stats).length) stats.set(k, cell.stats);
    if (cell.type === "start") startKey.push(k);
    if (cell.type === "gate") gateKeys.push(k);
    if (cell.type === "socket") socketKeys.push(k);
    if (cell.type === "magic") magicKeys.push(k);
    // a cell is "required" iff the user explicitly checked it in selectedNodes
    if (cell.srcKey && sel[cell.srcKey] === true) requiredKeys.add(k);
  }
  return { size, types, stats, startKey: startKey[0] ?? null, gateKeys, socketKeys, magicKeys, requiredKeys, rotated };
}

/** BFS through allowed (idx-indexed) cells to find shortest path from any cell in
 *  `fromSet` to `toKey`. Returns the path as an ordered list NOT including the
 *  starting cell, or null if no path exists. */
function bfsPath(fromSet, toKey, idx) {
  const seen = new Map(); // key -> prev
  const queue = [];
  for (const k of fromSet) { seen.set(k, null); queue.push(k); }
  while (queue.length) {
    const k = queue.shift();
    if (k === toKey) {
      const path = [];
      let cur = k;
      while (cur && !fromSet.has(cur)) { path.push(cur); cur = seen.get(cur); }
      return path.reverse();
    }
    for (const n of neighbors(k, idx.size)) {
      if (!idx.types.has(n)) continue; // not allowed in this slot
      if (seen.has(n)) continue;
      seen.set(n, k);
      queue.push(n);
    }
  }
  return null;
}

/** Greedy minimum-spanning seed: connect required nodes to entry through allowed cells. */
function seedRequired(sol, ctx) {
  for (let bi = 0; bi < ctx.chain.length; bi++) {
    const idx = ctx.idx[bi];
    if (!idx.requiredKeys || idx.requiredKeys.size === 0) continue;
    const act = sol.activated[bi];
    if (act.size === 0) {
      const entry = bi === 0 ? (idx.startKey || idx.gateKeys[0]) : idx.gateKeys[0];
      if (entry) act.add(entry);
    }
    // Greedy: pick the required node closest (by BFS) to the current activated
    // set, attach it; repeat. The order matters for Steiner-tree quality but
    // greedy is good enough as a seed for SA to refine.
    const remaining = new Set([...idx.requiredKeys].filter(k => !act.has(k)));
    while (remaining.size) {
      // try each remaining required, prefer the one with the shortest path
      let best = null;
      for (const k of remaining) {
        const path = bfsPath(act, k, idx);
        if (path && (best === null || path.length < best.path.length)) best = { k, path };
      }
      if (!best) break; // unreachable; give up on rest
      for (const c of best.path) act.add(c);
      remaining.delete(best.k);
    }
  }
}

function neighbors(k, size) {
  const [r, c] = parseKey(k);
  const out = [];
  if (r > 0) out.push(key(r - 1, c));
  if (r < size - 1) out.push(key(r + 1, c));
  if (c > 0) out.push(key(r, c - 1));
  if (c < size - 1) out.push(key(r, c + 1));
  return out;
}

function chebyshevWithin(centerKey, R, size) {
  const [r0, c0] = parseKey(centerKey);
  const out = [];
  for (let r = Math.max(0, r0 - R); r <= Math.min(size - 1, r0 + R); r++)
    for (let c = Math.max(0, c0 - R); c <= Math.min(size - 1, c0 + R); c++)
      out.push(key(r, c));
  return out;
}

function isConnectedAfterRemove(activated, removedKey, entryKey, size) {
  if (removedKey === entryKey) return activated.size === 1;
  const start = entryKey;
  if (!activated.has(start)) return false;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const k = queue.shift();
    for (const n of neighbors(k, size)) {
      if (n === removedKey) continue;
      if (!activated.has(n)) continue;
      if (seen.has(n)) continue;
      seen.add(n); queue.push(n);
    }
  }
  return seen.size === activated.size - 1;
}

function chooseEntry(activated, idx) {
  if (idx.startKey && activated.has(idx.startKey)) return idx.startKey;
  for (const g of idx.gateKeys) if (activated.has(g)) return g;
  return null;
}

function totalStats(solution, ctx) {
  const stats = {};
  const add = (s) => { if (!s) return; for (const k in s) stats[k] = (stats[k] || 0) + s[k]; };
  for (let bi = 0; bi < ctx.chain.length; bi++) {
    const idx = ctx.idx[bi];
    const act = solution.activated[bi];
    if (!act || act.size === 0) continue;
    for (const k of act) add(idx.stats.get(k));
    const gId = solution.glyphs[bi];
    if (gId) {
      const glyph = ctx.glyphs.find(g => g.id === gId);
      const socket = solution.glyphSocket[bi];
      if (glyph && socket && act.has(socket)) {
        add(glyph.baseStats);
        const within = chebyshevWithin(socket, ctx.glyphRadius, idx.size);
        let mcount = 0;
        for (const k of within) if (act.has(k) && idx.types.get(k) === "magic") mcount++;
        if (mcount > 0) {
          for (const [k, v] of Object.entries(glyph.perMagicStats || {})) {
            stats[k] = (stats[k] || 0) + v * mcount;
          }
        }
      }
    }
  }
  return stats;
}

function score(solution, ctx) {
  const stats = totalStats(solution, ctx);
  let s = evaluate(stats, ctx.buckets, ctx.baseValue);
  // Heavy penalty for required nodes still missing — forces SA to converge to a
  // valid build that includes everything the user explicitly checked.
  let missing = 0;
  for (let bi = 0; bi < ctx.chain.length; bi++) {
    const req = ctx.idx[bi].requiredKeys;
    if (!req || req.size === 0) continue;
    const act = solution.activated[bi];
    for (const k of req) if (!act.has(k)) missing++;
  }
  if (missing) s -= 1e9 * missing;
  // Small per-point penalty so among ties the solver prefers the shorter route.
  // Tuned to be smaller than typical per-bucket damage gains but big enough to
  // break ties when the user has selected specific nodes.
  if (ctx.pointPenalty) s -= ctx.pointPenalty * totalPoints(solution);
  return s;
}

function totalPoints(solution) {
  let n = 0;
  for (const a of solution.activated) n += a.size;
  return n;
}

function initialSolution(ctx) {
  const activated = ctx.chain.map(() => new Set());
  const glyphs = ctx.chain.map(() => null);
  const glyphSocket = ctx.chain.map(() => null);
  const entry0 = ctx.idx[0].startKey || ctx.idx[0].gateKeys[0];
  if (entry0) activated[0].add(entry0);
  // Place pinned glyphs first; then fill remaining slots from the leftover pool.
  const pinned = ctx.chain.map(s => (s && s.pinnedGlyph) || null);
  const used = new Set(pinned.filter(Boolean));
  const pool = ctx.glyphs.map(g => g.id).filter(id => !used.has(id));
  for (let bi = 0; bi < ctx.chain.length; bi++) {
    if (pinned[bi]) { glyphs[bi] = pinned[bi]; continue; }
    if (pool.length) glyphs[bi] = pool.shift();
  }
  return { activated, glyphs, glyphSocket };
}

function frontierCells(bi, solution, ctx) {
  const idx = ctx.idx[bi];
  const act = solution.activated[bi];
  const out = [];
  if (act.size === 0) {
    if (bi === 0 && idx.startKey) out.push(idx.startKey);
    else for (const g of idx.gateKeys) out.push(g);
    return out;
  }
  const seen = new Set();
  for (const k of act) {
    for (const n of neighbors(k, idx.size)) {
      if (act.has(n)) continue;
      if (seen.has(n)) continue;
      if (!idx.types.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function activeBoards(solution, ctx) {
  const out = [];
  for (let bi = 0; bi < ctx.chain.length; bi++) {
    const act = solution.activated[bi];
    if (act.size === 0) break;
    if (bi > 0) {
      const prev = solution.activated[bi - 1];
      const prevIdx = ctx.idx[bi - 1];
      let hasGate = false;
      for (const g of prevIdx.gateKeys) if (prev.has(g)) { hasGate = true; break; }
      if (!hasGate) break;
      let curHasGate = false;
      for (const g of ctx.idx[bi].gateKeys) if (act.has(g)) { curHasGate = true; break; }
      if (!curHasGate) break;
    }
    out.push(bi);
  }
  return out;
}

function proposeMove(solution, ctx, rand) {
  const move = rand();
  if (move < 0.25) return tryAdd(solution, ctx, rand);
  if (move < 0.50) return tryRemove(solution, ctx, rand);
  if (move < 0.70) return trySwap(solution, ctx, rand);
  if (move < 0.82) return tryMoveGlyph(solution, ctx, rand);
  if (move < 0.92) return tryReassignGlyphs(solution, ctx, rand);
  return tryRotateBoard(solution, ctx, rand);
}

function tryAdd(solution, ctx, rand) {
  const bi = Math.floor(rand() * ctx.chain.length);
  const fr = frontierCells(bi, solution, ctx);
  if (!fr.length) return null;
  if (totalPoints(solution) >= ctx.pointBudget) return null;
  const k = fr[Math.floor(rand() * fr.length)];
  return {
    apply: () => solution.activated[bi].add(k),
    undo: () => solution.activated[bi].delete(k),
  };
}

function tryRemove(solution, ctx, rand) {
  const candidates = [];
  for (let bi = 0; bi < ctx.chain.length; bi++) {
    const act = solution.activated[bi];
    if (act.size === 0) continue;
    const idx = ctx.idx[bi];
    const entry = chooseEntry(act, idx);
    for (const k of act) {
      // never remove a required cell (user explicitly asked for it)
      if (idx.requiredKeys && idx.requiredKeys.has(k)) continue;
      candidates.push({ bi, k, entry, idx });
    }
  }
  if (!candidates.length) return null;
  for (let i = 0; i < 6; i++) {
    const cand = candidates[Math.floor(rand() * candidates.length)];
    const act = solution.activated[cand.bi];
    if (!isConnectedAfterRemove(act, cand.k, cand.entry, cand.idx.size)) continue;
    return {
      apply: () => {
        solution.activated[cand.bi].delete(cand.k);
        if (solution.glyphSocket[cand.bi] === cand.k) solution.glyphSocket[cand.bi] = null;
      },
      undo: () => solution.activated[cand.bi].add(cand.k),
    };
  }
  return null;
}

function trySwap(solution, ctx, rand) {
  const rem = tryRemove(solution, ctx, rand);
  if (!rem) return null;
  rem.apply();
  const add = tryAdd(solution, ctx, rand);
  if (!add) { rem.undo(); return null; }
  return {
    apply: () => add.apply(),
    undo: () => { add.undo(); rem.undo(); },
  };
}

function tryMoveGlyph(solution, ctx, rand) {
  const candidates = [];
  for (let bi = 0; bi < ctx.chain.length; bi++) if (solution.glyphs[bi]) candidates.push(bi);
  if (!candidates.length) return null;
  const bi = candidates[Math.floor(rand() * candidates.length)];
  const idx = ctx.idx[bi];
  const act = solution.activated[bi];
  const availSockets = idx.socketKeys.filter(k => act.has(k));
  const choices = availSockets.length ? [...availSockets, null] : [null];
  const newSocket = choices[Math.floor(rand() * choices.length)];
  const prev = solution.glyphSocket[bi];
  if (newSocket === prev) return null;
  return {
    apply: () => { solution.glyphSocket[bi] = newSocket; },
    undo: () => { solution.glyphSocket[bi] = prev; },
  };
}

function tryReassignGlyphs(solution, ctx, rand) {
  if (ctx.glyphs.length === 0) return null;
  // Pinned slots keep their glyph; shuffle only the rest.
  const pinned = ctx.chain.map(s => (s && s.pinnedGlyph) || null);
  const pinnedIds = new Set(pinned.filter(Boolean));
  const unpinnedSlots = [];
  for (let bi = 0; bi < ctx.chain.length; bi++) if (!pinned[bi]) unpinnedSlots.push(bi);
  if (unpinnedSlots.length < 2) return null;
  const pool = ctx.glyphs.map(g => g.id).filter(id => !pinnedIds.has(id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const prevGlyphs = solution.glyphs.slice();
  const prevSockets = solution.glyphSocket.slice();
  const next = solution.glyphs.slice();
  const nextSockets = solution.glyphSocket.slice();
  for (const bi of unpinnedSlots) {
    next[bi] = pool.length ? pool.shift() : null;
    nextSockets[bi] = null; // sockets reset for reassigned slots
  }
  return {
    apply: () => { solution.glyphs = next; solution.glyphSocket = nextSockets; },
    undo: () => { solution.glyphs = prevGlyphs; solution.glyphSocket = prevSockets; },
  };
}

/** Try rotating one of the boards by ±1 quarter-turn (when allowed). Clears activation
 *  on that board because cell positions all shift; the SA will re-grow it from the gate. */
function tryRotateBoard(solution, ctx, rand) {
  if (!ctx.tryAllRotations) return null;
  // Don't rotate board 0 (start cell); rotating loses the start-anchored entry semantics.
  // Allow it only when board 0 also has gates the solver could use; otherwise restrict.
  const candidates = [];
  for (let bi = 0; bi < ctx.chain.length; bi++) {
    if (bi === 0 && !ctx.idx[bi].gateKeys.length && ctx.idx[bi].startKey) continue;
    candidates.push(bi);
  }
  if (!candidates.length) return null;
  const bi = candidates[Math.floor(rand() * candidates.length)];
  const dq = (rand() < 0.5 ? 1 : 3);
  const prevSlot = ctx.chain[bi];
  const prevIdx = ctx.idx[bi];
  const prevAct = solution.activated[bi];
  const prevSocket = solution.glyphSocket[bi];
  const newRot = (((prevSlot.rotation || 0) + dq) % 4 + 4) % 4;
  const newSlot = { ...prevSlot, rotation: newRot };
  const newIdx = indexSlot(ctx.boards[prevSlot.boardIndex], newSlot);
  // Remap activated keys through the rotation (preserves shape, just relocates cells).
  // Since the cell content rotates with the grid, the same node remains activated.
  const remappedAct = new Set();
  for (const k of prevAct) remappedAct.add(rotateKey(k, dq, prevIdx.size));
  const remappedSocket = prevSocket ? rotateKey(prevSocket, dq, prevIdx.size) : null;
  return {
    apply: () => {
      ctx.chain[bi] = newSlot;
      ctx.idx[bi] = newIdx;
      solution.activated[bi] = remappedAct;
      solution.glyphSocket[bi] = remappedSocket;
    },
    undo: () => {
      ctx.chain[bi] = prevSlot;
      ctx.idx[bi] = prevIdx;
      solution.activated[bi] = prevAct;
      solution.glyphSocket[bi] = prevSocket;
    },
  };
}

export async function optimize(state, opts) {
  const rand = rng(opts.seed | 0 || 1);
  // Detect any required cells in the run. Default the point penalty in this case
  // so the optimizer prefers shorter routes that still cover requirements.
  let anyRequired = false;
  for (const s of state.chain) {
    for (const v of Object.values(s.selectedNodes || {})) if (v === true) { anyRequired = true; break; }
    if (anyRequired) break;
  }
  // pointPenalty trades damage gains for shorter routes:
  // - minimizePoints ON: aggressive; minimization dominates so leftover budget
  //   isn't spent unless damage gains are very large.
  // - required nodes present, minimizePoints OFF: gentle bias toward shorter
  //   connecting routes; the solver still maximizes damage with leftover budget.
  // - no required nodes, off: no penalty.
  const pointPenalty = state.minimizePoints
    ? Math.max(10, Math.abs(state.baseValue || 100) * 0.5)
    : (anyRequired ? 0.05 : 0);
  const ctx = {
    chain: state.chain.map(s => ({ ...s, filters: { ...s.filters, nodeOverrides: { ...(s.filters?.nodeOverrides || {}) } } })),
    boards: state.boards,
    idx: state.chain.map(slot => indexSlot(state.boards[slot.boardIndex], slot)),
    glyphs: state.glyphs,
    buckets: state.buckets,
    baseValue: state.baseValue,
    pointBudget: state.pointBudget,
    glyphRadius: state.glyphRadius,
    tryAllRotations: !!state.tryAllRotations,
    pointPenalty,
  };

  if (ctx.chain.length === 0) throw new Error("Empty chain.");
  if (!ctx.idx[0].startKey && ctx.idx[0].gateKeys.length === 0)
    throw new Error("Board 1 has no start or gate cell.");

  let cur = initialSolution(ctx);
  // Greedy seed: route through every required node from the entry. SA refines.
  seedRequired(cur, ctx);
  // If the seed exceeded the budget, warn the user via opts.onProgress.
  if (totalPoints(cur) > ctx.pointBudget) {
    opts.onProgress?.({ iter: 0, cur: 0, best: 0, points: totalPoints(cur),
      temp: 0, warning: `Required nodes need ${totalPoints(cur)} points (budget ${ctx.pointBudget}). Raise budget or unselect some.` });
  }
  for (let bi = 0; bi < ctx.chain.length; bi++) {
    if (!cur.glyphs[bi]) continue;
    const act = cur.activated[bi];
    const socket = ctx.idx[bi].socketKeys.find(k => act.has(k));
    cur.glyphSocket[bi] = socket || null;
  }

  let curScore = score(cur, ctx);
  let best = cloneSolution(cur);
  let bestRotations = ctx.chain.map(s => s.rotation || 0);
  let bestScore = curScore;

  const N = opts.iterations | 0 || 20000;
  const T0 = opts.startTemp ?? 2;

  const chunk = Math.max(500, Math.floor(N / 200));
  for (let i = 0; i < N; i++) {
    if (opts.shouldStop && opts.shouldStop()) break;
    const T = Math.max(1e-4, T0 * (1 - i / N));
    const mv = proposeMove(cur, ctx, rand);
    if (!mv) continue;
    mv.apply();
    if (totalPoints(cur) > ctx.pointBudget) { mv.undo(); continue; }
    autoFillGlyphSockets(cur, ctx);
    const ns = score(cur, ctx);
    const delta = ns - curScore;
    if (delta >= 0 || rand() < Math.exp(delta / (T * Math.max(1, curScore)))) {
      curScore = ns;
      if (ns > bestScore) {
        bestScore = ns;
        best = cloneSolution(cur);
        bestRotations = ctx.chain.map(s => s.rotation || 0);
      }
    } else {
      mv.undo();
    }
    if (i % chunk === 0) {
      opts.onProgress?.({ iter: i, cur: curScore, best: bestScore, points: totalPoints(cur), temp: T });
      await new Promise(r => setTimeout(r, 0));
    }
  }
  opts.onProgress?.({ iter: N, cur: curScore, best: bestScore, points: totalPoints(best), temp: 0, done: true });

  // Compute missing required cells in the best solution (for reporting).
  let missingRequired = 0;
  for (let bi = 0; bi < ctx.chain.length; bi++) {
    const req = ctx.idx[bi].requiredKeys;
    if (!req || req.size === 0) continue;
    for (const k of req) if (!best.activated[bi].has(k)) missingRequired++;
  }
  return {
    solution: best,
    score: bestScore,
    stats: totalStats(best, ctx),
    activeBoards: activeBoards(best, ctx),
    rotations: bestRotations,
    totalPoints: totalPoints(best),
    missingRequired,
    ctx,
  };
}

function autoFillGlyphSockets(sol, ctx) {
  for (let bi = 0; bi < ctx.chain.length; bi++) {
    if (!sol.glyphs[bi]) continue;
    const s = sol.glyphSocket[bi];
    if (s && sol.activated[bi].has(s)) continue;
    const candidate = ctx.idx[bi].socketKeys.find(k => sol.activated[bi].has(k));
    sol.glyphSocket[bi] = candidate || null;
  }
}

function cloneSolution(s) {
  return {
    activated: s.activated.map(set => new Set(set)),
    glyphs: s.glyphs.slice(),
    glyphSocket: s.glyphSocket.slice(),
  };
}
