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

/** Returns true iff a cell should be treated as activatable given the slot's filters. */
function passesFilter(cell, filters) {
  if (!cell || cell.type === "empty") return false;
  if (cell.disabled) return false;
  if (!filters) return true;
  if (cell.type === "magic" && !filters.magic) return false;
  if (cell.type === "rare" && !filters.rare) return false;
  if (cell.type === "legendary" && !filters.legendary) return false;
  // start / gate / socket / normal always pass; user can still block individually via cell.disabled
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
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const cell = cells[r][c];
    if (!passesFilter(cell, slot.filters)) continue;
    const k = key(r, c);
    types.set(k, cell.type);
    if (cell.stats && Object.keys(cell.stats).length) stats.set(k, cell.stats);
    if (cell.type === "start") startKey.push(k);
    if (cell.type === "gate") gateKeys.push(k);
    if (cell.type === "socket") socketKeys.push(k);
    if (cell.type === "magic") magicKeys.push(k);
  }
  return { size, types, stats, startKey: startKey[0] ?? null, gateKeys, socketKeys, magicKeys, rotated };
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
  return evaluate(stats, ctx.buckets, ctx.baseValue);
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
  let glyphPool = ctx.glyphs.map(g => g.id);
  for (let bi = 0; bi < ctx.chain.length && glyphPool.length; bi++) {
    glyphs[bi] = glyphPool.shift();
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
    for (const k of act) candidates.push({ bi, k, entry, idx });
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
  const prevGlyphs = solution.glyphs.slice();
  const prevSockets = solution.glyphSocket.slice();
  const pool = ctx.glyphs.map(g => g.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const next = ctx.chain.map(() => null);
  for (let bi = 0; bi < ctx.chain.length && pool.length; bi++) next[bi] = pool.shift();
  return {
    apply: () => {
      solution.glyphs = next;
      solution.glyphSocket = ctx.chain.map(() => null);
    },
    undo: () => {
      solution.glyphs = prevGlyphs;
      solution.glyphSocket = prevSockets;
    },
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
  };

  if (ctx.chain.length === 0) throw new Error("Empty chain.");
  if (!ctx.idx[0].startKey && ctx.idx[0].gateKeys.length === 0)
    throw new Error("Board 1 has no start or gate cell.");

  let cur = initialSolution(ctx);
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

  return {
    solution: best,
    score: bestScore,
    stats: totalStats(best, ctx),
    activeBoards: activeBoards(best, ctx),
    rotations: bestRotations,
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
