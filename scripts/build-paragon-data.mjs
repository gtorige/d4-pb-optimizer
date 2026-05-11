// Convert d4data ParagonBoard + ParagonGlyph + StringList dumps into our schema.
import fs from 'fs';
import path from 'path';

const BOARDS_DIR    = '/tmp/d4d/boards';
const GLYPHS_DIR    = '/tmp/d4d/glyphs';
const STR_DIR       = '/tmp/d4d/strings';
const AFFIX_STR_DIR = '/tmp/d4d/affix-strings';
const OUT_FILE      = '/home/user/d4-pb-optimizer/js/paragon-data.js';

const CLASS_MAP = {
  Barb: 'Barbarian',
  Druid: 'Druid',
  Necro: 'Necromancer',
  Sorc: 'Sorcerer',
  Rogue: 'Rogue',
  Paladin: 'Paladin',
  Spirit: 'Spiritborn',
  Warlock: 'Warlock',
};
const CLASS_SHORT = Object.fromEntries(Object.entries(CLASS_MAP).map(([k, v]) => [v, k]));

const out = {};
for (const cls of Object.values(CLASS_MAP)) out[cls] = { boards: {}, nodes: {}, glyphs: {} };
out.Generic = { boards: {}, nodes: {}, glyphs: {} };

function readStl(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const map = {};
    for (const e of (data.arStrings || [])) {
      map[(e.szLabel || '').toLowerCase()] = e.szText || '';
    }
    return map;
  } catch { return null; }
}

// --- Boards ---
const boardFiles = fs.readdirSync(BOARDS_DIR).filter(f => f.endsWith('.pbd.json'));
for (const file of boardFiles) {
  const m = file.match(/^Paragon_([A-Za-z]+)_(\d+)\.pbd\.json$/);
  if (!m) continue;
  const [, shortCls, idx] = m;
  const className = CLASS_MAP[shortCls];
  if (!className) continue;
  const data = JSON.parse(fs.readFileSync(path.join(BOARDS_DIR, file), 'utf8'));
  const width = data.nWidth;
  const entries = data.arEntries || [];
  if (!width || !entries.length) continue;
  const height = Math.ceil(entries.length / width);
  const grid = [];
  for (let r = 0; r < height; r++) {
    const row = [];
    for (let c = 0; c < width; c++) row.push(entries[r * width + c]?.name || '');
    grid.push(row);
  }
  // Resolve board name from StringList: ParagonBoard_Paragon_<Short>_NN.stl.json
  const stlPath = path.join(STR_DIR, `ParagonBoard_${file.replace('.pbd.json', '.stl.json')}`);
  const stl = readStl(stlPath);
  const englishName = stl?.name?.trim();
  const boardKey = englishName
    ? englishName
    : (idx === '00' || idx === '0' ? 'Start' : `Board ${parseInt(idx, 10)}`);
  out[className].boards[boardKey] = grid;
}

// --- Glyphs ---
// Glyph rarity → radius mapping (D4 convention: rare=3, legendary=4)
function glyphRadiusForRarity(eRarity) {
  if (eRarity === 2) return 4;  // legendary
  return 3;                      // rare / default
}

const glyphFiles = fs.readdirSync(GLYPHS_DIR).filter(f => f.endsWith('.gph.json'));
for (const file of glyphFiles) {
  const data = JSON.parse(fs.readFileSync(path.join(GLYPHS_DIR, file), 'utf8'));
  const id = file.replace(/\.gph\.json$/, '');

  // English name
  const stl = readStl(path.join(STR_DIR, `ParagonGlyph_${file.replace('.gph.json', '.stl.json')}`));
  const englishName = stl?.name?.trim();

  // Class restriction:
  // The fUsableByClass array maps to game classes; we don't know the exact
  // index ordering without StringList resolution for ClassDef, but we surface
  // the array for downstream filtering. The library-ui currently ignores it.
  const usable = data.fUsableByClass || [];

  // Affix descriptions: pull each affix's StringList desc and join.
  const affixDescriptions = [];
  for (const aff of (data.arAffixes || [])) {
    if (!aff?.name) continue;
    const affStl = readStl(path.join(STR_DIR, `ParagonGlyphAffix_${aff.name}.stl.json`));
    const txt = affStl?.desc?.trim() || affStl?.bonus?.trim();
    if (txt) affixDescriptions.push(txt);
  }

  // Filename also encodes scaling-stat and main/side gate.
  const m = id.match(/^Rare_(\d+)_([A-Za-z]+)_([A-Za-z]+)(_Necro)?$/);
  const fallbackName = m ? `${m[2]} ${m[3]} #${parseInt(m[1], 10)}` + (m[4] ? ' (Necro)' : '') : id;
  const threshold = m ? `${m[2]} (${m[3]})` : null;

  out.Generic.glyphs[id] = {
    name: englishName || fallbackName,
    desc: affixDescriptions.join('\n') || null,
    bonus: null,
    threshold,
    rarity: data.eRarity === 2 ? 'legendary' : 'rare',
    radius: glyphRadiusForRarity(data.eRarity),
    usableByClass: usable,
  };
}

// --- Legendary node descriptions ---
// Pull name + desc for each Power_Paragon_<Short>_Legendary_NNN string entry.
for (const f of fs.readdirSync(STR_DIR)) {
  const m = f.match(/^Power_Paragon_([A-Za-z]+)_Legendary_(\d+)\.stl\.json$/);
  if (!m) continue;
  const stl = readStl(path.join(STR_DIR, f));
  if (!stl) continue;
  // Map short class back to long class name. Match cell id format: <Long>_Legendary_NNN.
  // Legendary node id in our board grids is `<ClassLong>_Legendary_NNN` — see paragon-utils.
  const longCls = CLASS_MAP[m[1]];
  if (!longCls) continue;
  const nodeId = `${longCls}_Legendary_${m[2]}`;
  // Strip the in-game markup tags for cleaner display
  const desc = (stl.desc || '').replace(/\{[^}]*\}/g, '').trim();
  out[longCls].nodes[nodeId] = {
    name: (stl.name || '').trim() || nodeId,
    desc: desc || null,
  };
}

// --- Stats summary ---
const stats = {};
for (const [cls, payload] of Object.entries(out)) {
  stats[cls] = {
    boards: Object.keys(payload.boards).length,
    nodes: Object.keys(payload.nodes).length,
    glyphs: Object.keys(payload.glyphs).length,
  };
}
console.log('Built dataset:', JSON.stringify(stats, null, 2));

const banner = '// Auto-generated from DiabloTools/d4data (Lord of Hatred, S13).\n' +
  '// Source: https://github.com/DiabloTools/d4data\n' +
  '// Boards: layouts + English board names.\n' +
  '// Glyphs: English names + affix descriptions + rarity-based radius.\n' +
  '// Nodes: English names + descriptions for class legendaries (rares/magics by id).\n';
fs.writeFileSync(OUT_FILE, banner + 'export const paragonData = ' + JSON.stringify(out) + ';\n');
console.log('Wrote', OUT_FILE, '(' + fs.statSync(OUT_FILE).size + ' bytes)');
