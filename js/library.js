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

/** d4data class index ordering inside fUsableByClass arrays. Deduced from the
 *  class snoIDs in PlayerClass/*.pcl.json (lowest snoID = idx 0). */
export const CLASS_GLYPH_INDEX = {
  Sorcerer: 0,
  Druid: 1,
  Barbarian: 2,
  Rogue: 3,
  Necromancer: 4,
  Spiritborn: 5,
  Paladin: 6,
  Warlock: 7,
};

/** List of glyphs in the bundled dataset. If `className` is provided, the list
 *  is filtered to glyphs flagged usable by that class via fUsableByClass. */
export function listGlyphs(className) {
  const sources = ["Generic", ...classes()];
  const seen = new Set();
  const out = [];
  const idx = className != null ? CLASS_GLYPH_INDEX[className] : null;
  for (const cls of sources) {
    const map = _dataset[cls]?.glyphs;
    if (!map) continue;
    for (const [id, g] of Object.entries(map)) {
      if (seen.has(id)) continue;
      if (idx != null && Array.isArray(g.usableByClass) && g.usableByClass.length === 8) {
        const anyClass = g.usableByClass.some(v => v === 1);
        if (anyClass && g.usableByClass[idx] !== 1) continue;
      }
      seen.add(id);
      out.push({ id, ...g });
    }
  }
  return out;
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
      if (info?.desc) cell.desc = info.desc;
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
  const sources = ["Generic", ...classes()];
  for (const cls of sources) {
    const g = _dataset[cls]?.glyphs?.[glyphId];
    if (!g) continue;
    return {
      id: "lib_" + glyphId,
      name: g.name,
      desc: g.desc,
      bonus: g.bonus,
      threshold: g.threshold,
      rarity: g.rarity,
      radius: g.radius,
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
