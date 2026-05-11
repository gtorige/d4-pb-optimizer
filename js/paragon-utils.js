// Helpers for working with raw Lothrik paragon node IDs.
// A node ID looks like:
//   "Generic_Gate" | "Generic_Socket"
//   "Generic_Normal_Str" | "Generic_Normal_Dex" | "Generic_Normal_Int" | "Generic_Normal_Will"
//   "Generic_Magic_DamagePhysical" | ...
//   "Generic_Rare_066"
//   "Barbarian_Magic_BerserkDamage" | "Barbarian_Rare_001" | "Barbarian_Legendary_002"
//   "StartNodeBarb" | "StartNodeDruid" | ...

/** @param {string} id */
export function cellTypeFromId(id) {
  if (!id) return "empty";
  if (id.startsWith("StartNode")) return "start";
  if (id.includes("_Gate")) return "gate";
  if (id.includes("_Socket")) return "socket";
  if (id.includes("_Normal_")) return "normal";
  if (id.includes("_Magic_")) return "magic";
  if (id.includes("_Rare_")) return "rare";
  if (id.includes("_Legendary_")) return "legendary";
  return "normal";
}

/** Stat key derived from id (stable across boards). */
export function statKeyFromId(id) {
  if (!id) return null;
  if (id.startsWith("StartNode")) return null;
  // Generic_Normal_Str -> attr_Str ; Generic_Magic_DamageFire -> magic_DamageFire ; etc.
  const parts = id.split("_");
  // [Class_or_Generic, Tier, ...rest]
  if (parts.length < 3) return null;
  const tier = parts[1].toLowerCase();
  const rest = parts.slice(2).join("_");
  if (tier === "normal") return "attr_" + rest;
  return tier + "_" + rest;
}

/** Default stat contribution per node (1 unit; user weights via buckets). */
export function defaultStatsFromId(id) {
  const k = statKeyFromId(id);
  if (!k) return {};
  // Normal attribute nodes contribute 5 (matches game's +5 per normal node).
  if (k.startsWith("attr_")) return { [k]: 5 };
  return { [k]: 1 };
}

/** Gate direction from row/col on a 21-wide board (edges only). */
export function inferGateDir(r, c, size) {
  if (r === 0) return "N";
  if (r === size - 1) return "S";
  if (c === 0) return "W";
  if (c === size - 1) return "E";
  // Some board exports place gates one cell inside the edge — pick nearest.
  const d = [r, size - 1 - r, c, size - 1 - c];
  const m = Math.min(...d);
  return ["N", "S", "W", "E"][d.indexOf(m)];
}
