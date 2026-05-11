import { getState, setState, makeGlyph } from "./state.js";

const $ = (s) => document.querySelector(s);

export function render() {
  const s = getState();
  const host = $("#glyph-list");
  host.innerHTML = "";
  for (const g of s.glyphs) {
    host.appendChild(glyphCard(g));
  }
}

function glyphCard(g) {
  const div = document.createElement("div");
  div.className = "glyph-card";
  const nameI = document.createElement("input");
  nameI.value = g.name;
  nameI.onchange = () => setState(st => {
    const gl = st.glyphs.find(x => x.id === g.id); if (gl) gl.name = nameI.value;
    return { ...st };
  });
  const rm = document.createElement("button"); rm.textContent = "✕";
  rm.onclick = () => setState(st => ({ ...st, glyphs: st.glyphs.filter(x => x.id !== g.id) }));
  const head = document.createElement("div");
  head.append("Name: ", nameI, " ", rm);
  div.appendChild(head);

  div.appendChild(statSection("Base stats (applied if glyph is placed)", g.baseStats, (k, v) => {
    setState(st => {
      const gl = st.glyphs.find(x => x.id === g.id); if (!gl) return st;
      const ns = { ...gl.baseStats };
      if (v == null) delete ns[k]; else ns[k] = v;
      gl.baseStats = ns;
      return { ...st };
    });
  }));
  div.appendChild(statSection("Per-magic-node stats (× count of magic nodes within radius)", g.perMagicStats, (k, v) => {
    setState(st => {
      const gl = st.glyphs.find(x => x.id === g.id); if (!gl) return st;
      const ns = { ...gl.perMagicStats };
      if (v == null) delete ns[k]; else ns[k] = v;
      gl.perMagicStats = ns;
      return { ...st };
    });
  }));
  return div;
}

function statSection(title, stats, onChange) {
  const wrap = document.createElement("div");
  const h = document.createElement("div"); h.innerHTML = `<strong>${title}</strong>`;
  wrap.appendChild(h);
  for (const [k, v] of Object.entries(stats)) {
    wrap.appendChild(statRow(k, v, onChange));
  }
  const add = document.createElement("button"); add.textContent = "+ stat";
  add.onclick = () => {
    let k = "new_stat", i = 1;
    while (k in stats) k = "new_stat_" + (++i);
    onChange(k, 0);
  };
  wrap.appendChild(add);
  return wrap;
}

function statRow(name, value, onChange) {
  const div = document.createElement("div"); div.className = "stat-row";
  const ni = document.createElement("input"); ni.value = name;
  const vi = document.createElement("input"); vi.type = "number"; vi.step = "any"; vi.value = value;
  const rm = document.createElement("button"); rm.textContent = "✕";
  let prev = name;
  const commit = () => {
    const nk = ni.value.trim();
    const nv = parseFloat(vi.value) || 0;
    if (nk !== prev) onChange(prev, null);
    if (nk) onChange(nk, nv);
    prev = nk;
  };
  ni.onchange = commit; vi.onchange = commit;
  rm.onclick = () => onChange(prev, null);
  div.append(ni, vi, rm);
  return div;
}

export function wireGlyphEditor() {
  $("#add-glyph").onclick = () => setState(st => ({ ...st, glyphs: [...st.glyphs, makeGlyph()] }));
}
