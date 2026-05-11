// Node-weighted Steiner Tree via Dreyfus-Wagner.
//
// Given a board's activatable graph (cells of non-empty, non-disabled type that
// pass the slot's filter) and a set of REQUIRED terminal cells, find the
// minimum-cell-count connected subgraph that contains every terminal.
//
// All cell weights are 1 (each activated cell costs 1 paragon point).
//
// Complexity: O(3^k * V + 2^k * V^2) where V is graph size and k = |terminals|.
// For a 21x21 board with V ~80 and k <= 10 this runs in well under 50ms in JS.

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

/** BFS from `start` over `graph`, returns { dist, prev } maps. */
function bfsFrom(start, graph, size) {
  const dist = new Map([[start, 0]]);
  const prev = new Map([[start, null]]);
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const k = queue[head++];
    for (const n of neighborKeys(k, size)) {
      if (!graph.has(n) || dist.has(n)) continue;
      dist.set(n, dist.get(k) + 1);
      prev.set(n, k);
      queue.push(n);
    }
  }
  return { dist, prev };
}

function pathFromBfs(target, prev) {
  if (!prev.has(target)) return null;
  const out = [];
  for (let c = target; c != null; c = prev.get(c)) out.push(c);
  return out;
}

/** Iterate non-empty proper subsets of bitmask S in arbitrary order. */
function* subsetsOf(S) {
  // Iterate non-zero strict subsets: S1 takes all combinations
  for (let S1 = (S - 1) & S; S1 > 0; S1 = (S1 - 1) & S) {
    yield S1;
  }
}

/**
 * Solve NW-Steiner Tree.
 * @param {Set<string>} graph - activatable cell keys
 * @param {number} size - board grid size
 * @param {string[]} terminals - cells that MUST be in the tree
 * @returns {Set<string>|null}
 */
export function steinerTree(graph, size, terminals) {
  if (!terminals || terminals.length === 0) return new Set();
  // All terminals must be in the activatable graph.
  for (const t of terminals) if (!graph.has(t)) return null;
  // Deduplicate terminals (a glyph socket might coincide with a selected node, etc.)
  const T = [...new Set(terminals)];
  const k = T.length;
  if (k === 1) return new Set(T);

  const V = [...graph];
  const Vidx = new Map(V.map((v, i) => [v, i]));
  const n = V.length;

  // BFS from each terminal and each cell — we'll need both.
  const bfsTerm = T.map(t => bfsFrom(t, graph, size));
  const bfsAll = V.map(v => bfsFrom(v, graph, size));

  // d[S][v] = min cells in subtree containing terminals in S plus v.
  // Use typed arrays for speed.
  const POW = 1 << k;
  const INF = Infinity;
  const D = new Array(POW);
  // back[S][v] = reconstruction info: null (initial), or
  //   { kind: 'path', term: i }   meaning d[S={i}][v] is shortest path from T[i] to v
  //   { kind: 'split', S1, S2 }   meaning d[S][v] = d[S1][v] + d[S2][v] - 1
  //   { kind: 'extend', S, u }    meaning d[S][v] = d[S][u] + pathLen(u,v) - 1
  const back = new Array(POW);
  for (let S = 0; S < POW; S++) {
    D[S] = new Float64Array(n);
    for (let i = 0; i < n; i++) D[S][i] = INF;
    back[S] = new Array(n).fill(null);
  }

  // Initialize singletons
  for (let i = 0; i < k; i++) {
    const bfs = bfsTerm[i];
    const mask = 1 << i;
    for (let j = 0; j < n; j++) {
      const v = V[j];
      const d = bfs.dist.get(v);
      if (d != null) {
        D[mask][j] = d + 1; // cells inclusive of both endpoints
        back[mask][j] = { kind: "path", term: i };
      }
    }
  }

  // DP over subsets by popcount (increasing size)
  const order = [];
  for (let S = 1; S < POW; S++) order.push(S);
  order.sort((a, b) => popcount(a) - popcount(b));

  for (const S of order) {
    if ((S & (S - 1)) === 0) continue; // singleton — already initialized

    // Split: for each v, partition S into S1, S2 (both non-empty subsets)
    for (let j = 0; j < n; j++) {
      let best = D[S][j], bestBack = back[S][j];
      // iterate non-empty strict subsets
      for (let S1 = (S - 1) & S; S1 > 0; S1 = (S1 - 1) & S) {
        const S2 = S ^ S1;
        // Avoid double-counting (S1, S2) and (S2, S1)
        if (S1 < S2) continue;
        const a = D[S1][j], b = D[S2][j];
        if (a === INF || b === INF) continue;
        const c = a + b - 1;
        if (c < best) { best = c; bestBack = { kind: "split", S1, S2 }; }
      }
      D[S][j] = best;
      back[S][j] = bestBack;
    }

    // Path-extension via Dijkstra-like relaxation over BFS-from-u.
    // Repeat until no update (Bellman-Ford style; converges in O(diameter) passes).
    let changed = true, passes = 0;
    while (changed && passes++ < 4) {
      changed = false;
      for (let u = 0; u < n; u++) {
        const du = D[S][u];
        if (du === INF) continue;
        const bfs = bfsAll[u];
        for (const [vKey, plen] of bfs.dist) {
          const vIdx = Vidx.get(vKey);
          if (vIdx === undefined || vIdx === u) continue;
          const c = du + plen; // plen = number of edges; +plen cells beyond u (each step is +1 cell)
          if (c < D[S][vIdx]) {
            D[S][vIdx] = c;
            back[S][vIdx] = { kind: "extend", S, u };
            changed = true;
          }
        }
      }
    }
  }

  // Find best root
  const full = POW - 1;
  let bestV = -1, bestCost = INF;
  for (let v = 0; v < n; v++) {
    if (D[full][v] < bestCost) { bestCost = D[full][v]; bestV = v; }
  }
  if (bestV < 0 || bestCost === INF) return null;

  // Reconstruct the tree as a set of cells.
  const cells = new Set();
  reconstruct(full, bestV, D, back, V, bfsTerm, bfsAll, cells);
  return cells;
}

function reconstruct(S, v, D, back, V, bfsTerm, bfsAll, out) {
  const info = back[S][v];
  if (!info) {
    out.add(V[v]);
    return;
  }
  if (info.kind === "path") {
    // BFS path from terminal info.term to V[v]
    const p = pathFromBfs(V[v], bfsTerm[info.term].prev);
    if (p) for (const k of p) out.add(k);
    return;
  }
  if (info.kind === "split") {
    reconstruct(info.S1, v, D, back, V, bfsTerm, bfsAll, out);
    reconstruct(info.S2, v, D, back, V, bfsTerm, bfsAll, out);
    return;
  }
  if (info.kind === "extend") {
    // First, the subtree at u for the same S
    reconstruct(info.S, info.u, D, back, V, bfsTerm, bfsAll, out);
    // Then path from u to v
    const p = pathFromBfs(V[v], bfsAll[info.u].prev);
    if (p) for (const k of p) out.add(k);
    return;
  }
}

function popcount(x) {
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}
