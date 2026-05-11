// Central app state with localStorage persistence.

const STORAGE_KEY = "d4pb_state_v2";
const LEGACY_KEY = "d4pb_state_v1";

export const NODE_TYPES = ["empty", "normal", "magic", "rare", "legendary", "socket", "gate", "start"];

/** Bump this whenever defaultBuckets() changes so the migration force-replaces
 *  stale bucket configurations from older versions. */
export const BUCKETS_VERSION = 2;

/** Default per-slot filter — magic/rare/legendary all on, no node overrides. */
export function defaultFilters() {
  return { magic: true, rare: true, legendary: true, nodeOverrides: {} };
}

/** Default damage buckets. The first bucket gives every node a strictly
 *  positive contribution via tier counters so the optimizer has a real
 *  gradient even before the user configures specific stat weights — the SA
 *  is then drawn toward filling the budget. The remaining buckets layer
 *  in stat-specific bonuses that match real D4 node naming. Tune in the
 *  Damage Formula tab. */
export function defaultBuckets() {
  return [
    {
      id: "node_count",
      name: "Per-node bonus (catch-all)",
      mode: "add",
      // Every activated cell contributes via one of these counters, so each
      // additional point is strictly positive — guarantees gradient.
      weights: {
        magic_count: 0.05,          // each magic node = +5%
        rare_count: 0.20,           // each rare node = +20%
        legendary_count: 0.50,      // each legendary = +50%
        attr_count: 0.001,          // each attribute point = +0.1% (a Strength node = 5 = +0.5%)
      },
    },
    {
      id: "damage_stats",
      name: "Damage stats (additive)",
      mode: "add",
      weights: {
        magic_Damage: 0.03, magic_DamagePhysical: 0.03, magic_DamageFire: 0.03,
        magic_DamageCold: 0.03, magic_DamageLightning: 0.03, magic_DamageShadow: 0.03,
        magic_DamagePoison: 0.03, magic_DamageBleed: 0.03, magic_DamageBurn: 0.03,
        magic_DamageElemental: 0.03, magic_DamageWhileHealthy: 0.03,
        magic_DamageWhileFortified: 0.03,
        magic_DamageToElite: 0.03, magic_DamageToClose: 0.03, magic_DamageToFar: 0.03,
        magic_DamageToCC: 0.03, magic_Damage1H: 0.03,
        magic_BerserkDamage: 0.03, magic_OverpowerDamage: 0.03,
      },
    },
    {
      id: "crit",
      name: "Critical damage (×)",
      mode: "mult",
      weights: { magic_CriticalDamage: 0.04, magic_CriticalDamage1H: 0.04, magic_CriticalDamageToCC: 0.04 },
    },
    {
      id: "vuln",
      name: "Vulnerable damage (×)",
      mode: "mult",
      weights: { magic_DamageToVulnerable: 0.05 },
    },
  ];
}

/** Default chain slot. */
export function defaultChainSlot(boardIndex = 0) {
  return {
    boardIndex,
    rotation: 0,
    filters: defaultFilters(),
    pinnedGlyph: null,       // glyph id locked to this slot, or null = let optimizer choose
    selectedNodes: {},       // per-cell overrides keyed by srcKey -> bool (true=include, false=exclude)
  };
}

/** @returns {AppState} */
export function defaultState() {
  return {
    selectedClass: "Barbarian",
    boards: [makeBoard("Starter")],
    chain: [defaultChainSlot(0)],
    glyphs: [],
    buckets: defaultBuckets(),
    bucketsVersion: BUCKETS_VERSION,
    baseValue: 100,
    pointBudget: 225,
    glyphRadius: 4,
    tryAllRotations: true,
    minimizePoints: false,
    algorithm: "steiner",
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
      pinnedGlyph: slot.pinnedGlyph ?? null,
      selectedNodes: { ...(slot.selectedNodes || {}) },
    };
  });
  if (!out.chain.length) out.chain = [defaultChainSlot(0)];
  if (typeof out.tryAllRotations !== "boolean") out.tryAllRotations = base.tryAllRotations;
  if (out.algorithm !== "steiner" && out.algorithm !== "sa") out.algorithm = base.algorithm;
  // Force-replace buckets whenever we ship a new defaultBuckets() generation,
  // or when the existing buckets look broken (legacy stat names). This is the
  // primary way returning users get an optimizer that actually maximizes
  // damage on fresh state.
  const ver = typeof out.bucketsVersion === "number" ? out.bucketsVersion : 0;
  const needReplace =
    ver < BUCKETS_VERSION ||
    !Array.isArray(out.buckets) ||
    bucketsLookBroken(out.buckets);
  if (needReplace) {
    out.buckets = defaultBuckets();
    out.bucketsVersion = BUCKETS_VERSION;
  }
  return out;
}

function bucketsLookBroken(buckets) {
  // Heuristic: every bucket either has no weights at all or references one of
  // the legacy stat names that don't exist in the library.
  const legacyKeys = new Set(["all_dmg", "crit_dmg", "vuln_dmg", "crit_chance"]);
  for (const b of buckets) {
    const w = b.weights || {};
    const wKeys = Object.keys(w);
    if (wKeys.length && !wKeys.some(k => legacyKeys.has(k))) return false; // user-customized
  }
  return true;
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
/** @typedef {{boardIndex:number, rotation:number, filters:Filters, pinnedGlyph:string|null, selectedNodes:Record<string, boolean>}} ChainSlot */
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
