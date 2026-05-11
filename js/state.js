// Central app state with localStorage persistence.

const STORAGE_KEY = "d4pb_state_v2";
const LEGACY_KEY = "d4pb_state_v1";

export const NODE_TYPES = ["empty", "normal", "magic", "rare", "legendary", "socket", "gate", "start"];

/** Default per-slot filter — magic/rare/legendary all on, no node overrides. */
export function defaultFilters() {
  return { magic: true, rare: true, legendary: true, nodeOverrides: {} };
}

/** Default chain slot. */
export function defaultChainSlot(boardIndex = 0) {
  return { boardIndex, rotation: 0, filters: defaultFilters() };
}

/** @returns {AppState} */
export function defaultState() {
  return {
    selectedClass: "Barbarian",
    boards: [makeBoard("Starter")],
    chain: [defaultChainSlot(0)],
    glyphs: [],
    buckets: [
      { id: "additive", name: "Additive damage", mode: "add", stats: ["all_dmg", "crit_dmg"] },
      { id: "vuln", name: "Vulnerable", mode: "mult", stats: ["vuln_dmg"] },
      { id: "crit_chance", name: "Crit (avg)", mode: "add", stats: ["crit_chance"] },
    ],
    baseValue: 100,
    pointBudget: 225,
    glyphRadius: 4,
    tryAllRotations: true,
    selection: { boardIndex: 0, cell: null, glyphId: null },
  };
}

let listeners = [];
let _state = load() ?? defaultState();

export function getState() { return _state; }
export function setState(updater) {
  _state = typeof updater === "function" ? updater(_state) : updater;
  save();
  for (const l of listeners) l(_state);
}
export function subscribe(fn) { listeners.push(fn); return () => { listeners = listeners.filter(l => l !== fn); }; }

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_state)); } catch {}
}
function load() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) return migrate(JSON.parse(legacy));
      return null;
    }
    return migrate(JSON.parse(raw));
  } catch { return null; }
}

/** Coerce older shapes (numeric chain entries, missing fields) into the current schema. */
export function migrate(s) {
  if (!s) return s;
  const base = defaultState();
  const out = { ...base, ...s };
  out.chain = (s.chain ?? []).map(slot => {
    if (typeof slot === "number") return defaultChainSlot(slot);
    return {
      boardIndex: slot.boardIndex ?? 0,
      rotation: slot.rotation ?? 0,
      filters: { ...defaultFilters(), ...(slot.filters || {}) },
    };
  });
  if (!out.chain.length) out.chain = [defaultChainSlot(0)];
  if (typeof out.tryAllRotations !== "boolean") out.tryAllRotations = base.tryAllRotations;
  return out;
}

export function resetState() { _state = defaultState(); save(); for (const l of listeners) l(_state); }
export function importState(json) {
  const next = typeof json === "string" ? JSON.parse(json) : json;
  _state = migrate({ ...defaultState(), ...next });
  save();
  for (const l of listeners) l(_state);
}

/** @typedef {{type:string, name?:string, label?:string, nodeId?:string, stats:Record<string, number>, gateDir?:"N"|"E"|"S"|"W"}} Cell */
/** @typedef {{name:string, size:number, cells: Cell[][], origin?: {className:string, boardName:string}}} Board */
/** @typedef {{id:string, name:string, baseStats:Record<string,number>, perMagicStats:Record<string,number>, desc?:string, bonus?:string, threshold?:string}} Glyph */
/** @typedef {{id:string, name:string, mode:"add"|"mult", stats:string[]}} Bucket */
/** @typedef {{magic:boolean, rare:boolean, legendary:boolean, nodeOverrides:Record<string, "force"|"block">}} Filters */
/** @typedef {{boardIndex:number, rotation:number, filters:Filters}} ChainSlot */
/** @typedef {{boards:Board[], chain:ChainSlot[], glyphs:Glyph[], buckets:Bucket[], baseValue:number, pointBudget:number, glyphRadius:number, tryAllRotations:boolean, selectedClass:string, selection:{boardIndex:number, cell:[number,number]|null, glyphId:string|null}}} AppState */

export function makeBoard(name = "Board") {
  const size = 21;
  const cells = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: "empty", stats: {} }))
  );
  cells[size - 1][Math.floor(size / 2)] = { type: "start", stats: {} };
  return { name, size, cells };
}

export function resizeBoard(board, size) {
  const next = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: "empty", stats: {} }))
  );
  for (let r = 0; r < Math.min(size, board.size); r++)
    for (let c = 0; c < Math.min(size, board.size); c++)
      next[r][c] = board.cells[r][c];
  board.cells = next;
  board.size = size;
}

let _glyphIdCtr = 1;
export function makeGlyph() {
  return {
    id: "g" + (_glyphIdCtr++) + "_" + Math.random().toString(36).slice(2, 6),
    name: "New glyph",
    baseStats: {},
    perMagicStats: {},
  };
}
