// Central app state with localStorage persistence.

const STORAGE_KEY = "d4pb_state_v1";

export const NODE_TYPES = ["empty", "normal", "magic", "rare", "legendary", "socket", "gate", "start"];

/** @returns {AppState} */
export function defaultState() {
  return {
    boards: [makeBoard("Starter")],
    chain: [0],
    glyphs: [],
    buckets: [
      { id: "additive", name: "Additive damage", mode: "add", stats: ["all_dmg", "crit_dmg"] },
      { id: "vuln", name: "Vulnerable", mode: "mult", stats: ["vuln_dmg"] },
      { id: "crit_chance", name: "Crit (avg)", mode: "add", stats: ["crit_chance"] },
    ],
    baseValue: 100,
    pointBudget: 225,
    glyphRadius: 4,
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
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function resetState() { _state = defaultState(); save(); for (const l of listeners) l(_state); }
export function importState(json) {
  const next = typeof json === "string" ? JSON.parse(json) : json;
  // best-effort merge with defaults
  _state = { ...defaultState(), ...next };
  save();
  for (const l of listeners) l(_state);
}

/** @typedef {{type:string, name?:string, stats:Record<string, number>, gateDir?:"N"|"E"|"S"|"W"}} Cell */
/** @typedef {{name:string, size:number, cells: Cell[][]}} Board */
/** @typedef {{id:string, name:string, baseStats:Record<string,number>, perMagicStats:Record<string,number>}} Glyph */
/** @typedef {{id:string, name:string, mode:"add"|"mult", stats:string[]}} Bucket */
/** @typedef {{boards:Board[], chain:number[], glyphs:Glyph[], buckets:Bucket[], baseValue:number, pointBudget:number, glyphRadius:number, selection:{boardIndex:number, cell:[number,number]|null, glyphId:string|null}}} AppState */

export function makeBoard(name = "Board") {
  const size = 21;
  const cells = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: "empty", stats: {} }))
  );
  // sensible defaults: start at center-bottom, gates at N/E/W
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
    baseStats: {},          // applied once if glyph is placed
    perMagicStats: {},      // multiplied by # magic nodes within radius
  };
}
