// Convert d4data ParagonBoard + ParagonGlyph JSON dumps into our paragon-data.js schema.
import fs from 'fs';
import path from 'path';

const BOARDS_DIR = '/tmp/d4d/boards';
const GLYPHS_DIR = '/tmp/d4d/glyphs';
const OUT_FILE   = '/home/user/d4-pb-optimizer/js/paragon-data.js';

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

const out = {};
for (const cls of Object.values(CLASS_MAP)) out[cls] = { boards: {}, nodes: {}, glyphs: {} };
out.Generic = { boards: {}, nodes: {}, glyphs: {} };

// --- Boards ---
const boardFiles = fs.readdirSync(BOARDS_DIR).filter(f => f.endsWith('.pbd.json'));
for (const file of boardFiles) {
  const m = file.match(/^Paragon_([A-Za-z]+)_(\d+)\.pbd\.json$/);
  if (!m) { console.warn('skip', file); continue; }
  const [, shortCls, idx] = m;
  const className = CLASS_MAP[shortCls];
  if (!className) { console.warn('unknown class', shortCls); continue; }
  const data = JSON.parse(fs.readFileSync(path.join(BOARDS_DIR, file), 'utf8'));
  const width = data.nWidth;
  const entries = data.arEntries || [];
  if (!width || !entries.length) continue;
  const height = Math.ceil(entries.length / width);
  const grid = [];
  for (let r = 0; r < height; r++) {
    const row = [];
    for (let c = 0; c < width; c++) {
      const e = entries[r * width + c];
      row.push(e?.name || '');
    }
    grid.push(row);
  }
  // Determine board key. Suffix "00" is starter (only for non-zero classes).
  const boardKey = idx === '00' || idx === '0' ? 'Start' : `Board ${parseInt(idx, 10)}`;
  out[className].boards[boardKey] = grid;
}

// --- Glyphs ---
const glyphFiles = fs.readdirSync(GLYPHS_DIR).filter(f => f.endsWith('.gph.json'));
for (const file of glyphFiles) {
  const data = JSON.parse(fs.readFileSync(path.join(GLYPHS_DIR, file), 'utf8'));
  // glyph id derived from file basename (strip .gph.json)
  const id = file.replace(/\.gph\.json$/, '');
  // Class restriction: fUsableByClass is a length-8 array of 0/1 indexed by:
  //   [0]=Sorc, [1]=Barb, [2]=Druid, [3]=Rogue, [4]=Necro, [5]=Spirit, [6]=Paladin, [7]=Warlock
  // (deduced from earlier sample: Rare_001_Intelligence had [1,0,0,0,0,0,0,0] presumably Sorc).
  // Without confirming each index, we put all glyphs in Generic and let the library use them.
  // The shared glyphs aren't truly per-class in our optimizer model anyway.
  const usable = data.fUsableByClass || [];
  // human-readable threshold-stat hint from filename: Rare_NNN_<Stat>_<Pos>
  const m = id.match(/^Rare_(\d+)_([A-Za-z]+)_([A-Za-z]+)(_Necro)?$/);
  const name = m ? `${m[2]} ${m[3]} #${parseInt(m[1], 10)}` + (m[4] ? ' (Necro)' : '') : id;
  const glyph = {
    name,
    desc: null,
    bonus: null,
    threshold: m ? `${m[2]} (${m[3]})` : null,
    usableByClass: usable,
  };
  out.Generic.glyphs[id] = glyph;
}

// --- Stats ---
const stats = {};
for (const [cls, payload] of Object.entries(out)) {
  stats[cls] = {
    boards: Object.keys(payload.boards).length,
    glyphs: Object.keys(payload.glyphs).length,
  };
}
console.log('Built dataset:', JSON.stringify(stats, null, 2));

const banner = '// Auto-generated from DiabloTools/d4data (Lord of Hatred, Season 13).\n' +
  '// Source: https://github.com/DiabloTools/d4data\n' +
  '// Cell strings reference ParagonNode names in d4data; glyph keys are\n' +
  '// d4data file basenames.\n';
fs.writeFileSync(OUT_FILE, banner + 'export const paragonData = ' + JSON.stringify(out) + ';\n');
console.log('Wrote', OUT_FILE, '(' + fs.statSync(OUT_FILE).size + ' bytes)');
