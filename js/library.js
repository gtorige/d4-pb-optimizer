// Convert raw paragonData entries into the tool's Board/Glyph shapes.
import { paragonData as bundledData } from "./paragon-data.js";
import { cellTypeFromId, defaultStatsFromId, deriveLabel, inferGateDir, statKeyFromId } from "./paragon-utils.js";

const DATASET_KEY = "d4pb_dataset_v1";

let _dataset = loadDataset() || bundledData;

function loadDataset() {
  try {
    const raw = localStorage.getItem(DATASET_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch { return null; }
}

/** Replace the active dataset. Pass null to revert to bundled. */
export function setDataset(next) {
  if (next == null) {
    localStorage.removeItem(DATASET_KEY);
    _dataset = bundledData;
  } else {
    if (!next || typeof next !== "object") throw new Error("Dataset must be an object keyed by class name");
    localStorage.setItem(DATASET_KEY, JSON.stringify(next));
    _dataset = next;
  }
}

/** Indicates whether the current dataset came from a user upload. */
export function datasetIsBundled() { return _dataset === bundledData; }

/** Live-bound view of the current dataset. */
export function getDataset() { return _dataset; }

/** Class names available, excluding the Generic shared node table. */
export function classes() { return Object.keys(_dataset).filter(c => c !== "Generic"); }

/** List of board names available for a class (preserves dataset order). */
export function listBoards(className) {
  const cls = _dataset[className];
  return cls ? Object.keys(cls.boards || {}) : [];
}

/** List of glyphs available (we use the Barbarian list as the union — they're shared). */
export function listGlyphs() {
  // Glyphs are duplicated across classes in the dataset; pick whichever class has the most.
  let best = null, bestN = -1;
  for (const cls of classes()) {
    const n = Object.keys(_dataset[cls].glyphs || {}).length;
    if (n > bestN) { bestN = n; best = cls; }
  }
  if (!best) return [];
  return Object.entries(_dataset[best].glyphs).map(([id, g]) => ({ id, ...g }));
}

/** Resolve a node id to its display info (name + desc) by checking class + Generic. */
export function lookupNode(className, id) {
  if (!id) return null;
  const cls = _dataset[className];
  if (cls && cls.nodes[id]) return cls.nodes[id];
  const gen = _dataset["Generic"];
  if (gen && gen.nodes[id]) return gen.nodes[id];
  return null;
}

/** Convert a raw Lothrik board grid into a Board for the tool.
 *  Pads to a square (the dataset has 15x21 Start boards; others are 21x21). */
export function importBoard(className, boardName) {
  const cls = _dataset[className];
  if (!cls || !cls.boards[boardName]) throw new Error(`Unknown board ${className}/${boardName}`);
  const grid = cls.boards[boardName];
  const rows = grid.length;
  const cols = grid[0]?.length ?? rows;
  const size = Math.max(rows, cols);
  // Center the source grid within the square. Start boards have the start at the bottom;
  // anchor to the bottom so the start cell stays at the bottom of the square.
  const rowOffset = size - rows;     // shove existing rows down
  const colOffset = Math.floor((size - cols) / 2);
  const cells = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: "empty", stats: {} }))
  );
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = grid[r][c];
      if (!id) continue;
      const type = cellTypeFromId(id);
      const tr = r + rowOffset;
      const tc = c + colOffset;
      const cell = {
        type,
        stats: defaultStatsFromId(id),
        nodeId: id,
        srcKey: tr + "," + tc, // stable identity across rotations
      };
      if (type === "gate") cell.gateDir = inferGateDir(tr, tc, size);
      const info = lookupNode(className, id);
      cell.label = info?.name || deriveLabel(id);
      cells[tr][tc] = cell;
    }
  }
  return {
    name: `${className}: ${boardName}`,
    size,
    cells,
    origin: { className, boardName },
  };
}

/** Convert a raw glyph entry into the tool's Glyph shape.
 *  We default to a single per-magic-node stat using the glyph id as key,
 *  so users can weight it via the damage buckets. */
export function importGlyph(glyphId) {
  for (const cls of classes()) {
    const g = _dataset[cls].glyphs?.[glyphId];
    if (!g) continue;
    return {
      id: "lib_" + glyphId,
      name: g.name,
      desc: g.desc,
      bonus: g.bonus,
      threshold: g.threshold,
      baseStats: { ["glyph_" + glyphId + "_base"]: 1 },
      perMagicStats: { ["glyph_" + glyphId]: 1 },
    };
  }
  return null;
}

/** Unique set of stat keys present in a class's boards — useful to seed damage buckets. */
export function statKeysForClass(className) {
  const cls = _dataset[className];
  if (!cls) return [];
  const keys = new Set();
  for (const grid of Object.values(cls.boards)) {
    for (const row of grid) for (const id of row) {
      const k = statKeyFromId(id);
      if (k) keys.add(k);
    }
  }
  return [...keys].sort();
}
