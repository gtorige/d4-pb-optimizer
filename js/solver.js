// Simulated-annealing paragon-route + glyph-placement solver.
import { evaluate } from "./damage.js";

/** @typedef {import('./state.js').AppState} AppState */

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

/** Precompute per-board metadata. */
function indexBoard(board) {
  const size = board.size;
  const cells = board.cells;
  const types = new Map();      // key -> cell type
  const stats = new Map();      // key -> stats record (only if non-empty)
  const startKey = [];          // [key] of start cell
  const gateKeys = [];          // gates
  const socketKeys = [];        // sockets
  const magicKeys = [];         // magic cells
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const cell = cells[r][c];
    if (!cell || cell.type === "empty") continue;
    const k = key(r, c);
    types.set(k, cell.type);
    if (cell.stats && Object.keys(cell.stats).length) stats.set(k, cell.stats);
    if (cell.type === "start") startKey.push(k);
    if (cell.type === "gate") gateKeys.push(k);
    if (cell.type === "socket") socketKeys.push(k);
    if (cell.type === "magic") magicKeys.push(k);
  }
  return { size, types, stats, startKey: startKey[0] ?? null, gateKeys, socketKeys, magicKeys };
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

/** BFS-check that `activated` minus a removed cell is still connected, anchored at entry. */
function isConnectedAfterRemove(activated, removedKey, entryKey, size, idx) {
  if (removedKey === entryKey) return activated.size === 1; // can only remove entry if board empties
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
  // After removal, the new activated set is activated \ {removedKey}; check we reached it all
  return seen.size === activated.size - 1;
}

/** Pick a valid entry for a board's activated set: start cell, or any activated gate. */
function chooseEntry(activated, idx) {
  if (idx.startKey && activated.has(idx.startKey)) return idx.startKey;
  for (const g of idx.gateKeys) if (activated.has(g)) return g;
  return null;
}

/** Compute total stats for the whole chain given a solution. */
function totalStats(solution, ctx) {
  const stats = {};
  const add = (s) => { if (!s) return; for (const k in s) stats[k] = (stats[k] || 0) + s[k]; };
  for (let bi = 0; bi < ctx.chain.length; bi++) {
    const idx = ctx.idx[bi];
    const act = solution.activated[bi];
    if (!act || act.size === 0) continue;
    for (const k of act) add(idx.stats.get(k));
    // glyph contribution for this board
    const gId = solution.glyphs[bi];
    if (gId) {
      const glyph = ctx.glyphs.find(g => g.id === gId);
      const socket = solution.glyphSocket[bi];
      if (glyph && socket && act.has(socket)) {
        add(glyph.baseStats);
        // magic count within radius among activated magic cells
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

/** Initial solution: just entry node of board 0. */
function initialSolution(ctx) {
  const activated = ctx.chain.map(() => new Set());
  const glyphs = ctx.chain.map(() => null);
  const glyphSocket = ctx.chain.map(() => null);
  const entry0 = ctx.idx[0].startKey || ctx.idx[0].gateKeys[0];
  if (entry0) activated[0].add(entry0);
  // assign glyphs greedily in chain order
  let glyphPool = ctx.glyphs.map(g => g.id);
  for (let bi = 0; bi < ctx.chain.length && glyphPool.length; bi++) {
    glyphs[bi] = glyphPool.shift();
  }
  return { activated, glyphs, glyphSocket };
}

/** Frontier cells per board: empty (not-yet-activated, non-empty-type) cells adjacent to activated. */
function frontierCells(bi, solution, ctx) {
  const idx = ctx.idx[bi];
  const act = solution.activated[bi];
  const out = [];
  if (act.size === 0) {
    // first cell must be entry: start (board 0) or any gate
    if (bi === 0 && idx.startKey) out.push(idx.startKey);
    else for (const g of idx.gateKeys) out.push(g);
    return out;
  }
  const seen = new Set();
  for (const k of act) {
    for (const n of neighbors(k, idx.size)) {
      if (act.has(n)) continue;
      if (seen.has(n)) continue;
      if (!idx.types.has(n)) continue; // empty
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function activeBoards(solution, ctx) {
  // a board is "active" iff its activated set non-empty AND prior board (if any) is active and has a gate activated
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
      // current board's set must contain at least one of its gates (the entry)
      let curHasGate = false;
      for (const g of ctx.idx[bi].gateKeys) if (act.has(g)) { curHasGate = true; break; }
      if (!curHasGate) break;
    }
    out.push(bi);
  }
  return out;
}

/** Propose a move; returns {apply, undo, deltaCost} or null. */
function proposeMove(solution, ctx, rand) {
  const activeBoardIndices = ctx.chain.map((_, i) => i); // any board may be touched; chain validity is enforced by score=0 on invalid
  const move = rand();
  // 70% add/remove/swap, 30% glyph
  if (move < 0.30) return tryAdd(solution, ctx, rand);
  if (move < 0.55) return tryRemove(solution, ctx, rand);
  if (move < 0.75) return trySwap(solution, ctx, rand);
  if (move < 0.90) return tryMoveGlyph(solution, ctx, rand);
  return tryReassignGlyphs(solution, ctx, rand);
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
      // try to skip "expensive to recompute" by random sampling
      candidates.push({ bi, k, entry, idx });
    }
  }
  if (!candidates.length) return null;
  // try a few random candidates
  for (let i = 0; i < 6; i++) {
    const cand = candidates[Math.floor(rand() * candidates.length)];
    const act = solution.activated[cand.bi];
    if (!isConnectedAfterRemove(act, cand.k, cand.entry, cand.idx.size, cand.idx)) continue;
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
  // pick a board with a glyph assigned, move its socket to another activated socket on the same board
  const candidates = [];
  for (let bi = 0; bi < ctx.chain.length; bi++) if (solution.glyphs[bi]) candidates.push(bi);
  if (!candidates.length) return null;
  const bi = candidates[Math.floor(rand() * candidates.length)];
  const idx = ctx.idx[bi];
  const act = solution.activated[bi];
  const availSockets = idx.socketKeys.filter(k => act.has(k));
  const choices = availSockets.length ? [...availSockets, null] : [null]; // also allow unassign
  const newSocket = choices[Math.floor(rand() * choices.length)];
  const prev = solution.glyphSocket[bi];
  if (newSocket === prev) return null;
  return {
    apply: () => { solution.glyphSocket[bi] = newSocket; },
    undo: () => { solution.glyphSocket[bi] = prev; },
  };
}

function tryReassignGlyphs(solution, ctx, rand) {
  // shuffle glyph→board mapping among active boards
  if (ctx.glyphs.length === 0) return null;
  const prevGlyphs = solution.glyphs.slice();
  const prevSockets = solution.glyphSocket.slice();
  const pool = ctx.glyphs.map(g => g.id);
  // Fisher-Yates
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

/**
 * Run simulated annealing.
 * @param {AppState} state
 * @param {{iterations:number, startTemp:number, seed:number, onProgress?:(info:any)=>void, shouldStop?:()=>boolean}} opts
 */
export async function optimize(state, opts) {
  const rand = rng(opts.seed | 0 || 1);
  const ctx = {
    chain: state.chain,
    idx: state.chain.map(bi => indexBoard(state.boards[bi])),
    glyphs: state.glyphs,
    buckets: state.buckets,
    baseValue: state.baseValue,
    pointBudget: state.pointBudget,
    glyphRadius: state.glyphRadius,
  };

  // sanity
  if (ctx.chain.length === 0) throw new Error("Empty chain.");
  if (!ctx.idx[0].startKey && ctx.idx[0].gateKeys.length === 0)
    throw new Error("Board 1 has no start or gate cell.");

  let cur = initialSolution(ctx);
  // place glyphs in initial sockets if any
  for (let bi = 0; bi < ctx.chain.length; bi++) {
    if (!cur.glyphs[bi]) continue;
    const act = cur.activated[bi];
    const socket = ctx.idx[bi].socketKeys.find(k => act.has(k));
    cur.glyphSocket[bi] = socket || null;
  }

  let curScore = score(cur, ctx);
  let best = cloneSolution(cur);
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
    // enforce budget
    if (totalPoints(cur) > ctx.pointBudget) { mv.undo(); continue; }
    // try to auto-place glyph if its socket got newly activated
    autoFillGlyphSockets(cur, ctx);
    const ns = score(cur, ctx);
    const delta = ns - curScore;
    if (delta >= 0 || rand() < Math.exp(delta / (T * Math.max(1, curScore)))) {
      curScore = ns;
      if (ns > bestScore) {
        bestScore = ns;
        best = cloneSolution(cur);
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
