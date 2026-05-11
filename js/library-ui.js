// UI for the bundled paragon-board library.
import { getState, setState, defaultChainSlot, defaultFilters } from "./state.js";
import { CLASSES, listBoards, listGlyphs, importBoard, importGlyph, lookupNode } from "./library.js";
import { paragonData } from "./paragon-data.js";

const $ = (s) => document.querySelector(s);
const MAX_CHAIN = 5;

export function render() {
  const s = getState();
  renderClassSelect();
  renderBoardCards(s.selectedClass);
  renderGlyphCards();
  renderChain();
  renderSelectedGlyphs();
  $("#lib-try-rotations").checked = !!s.tryAllRotations;
}

function renderClassSelect() {
  const sel = $("#lib-class");
  const s = getState();
  sel.innerHTML = "";
  for (const c of CLASSES) {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    if (c === s.selectedClass) o.selected = true;
    sel.appendChild(o);
  }
}

function renderBoardCards(className) {
  const host = $("#lib-board-cards");
  host.innerHTML = "";
  if (!className) return;
  for (const boardName of listBoards(className)) {
    const card = document.createElement("div");
    card.className = "lib-card";
    const title = document.createElement("h4");
    title.textContent = boardName;
    card.appendChild(title);
    card.appendChild(miniGrid(paragonData[className].boards[boardName], 4));
    const btn = document.createElement("button");
    btn.textContent = "+ Add to chain";
    btn.onclick = () => addBoardToChain(className, boardName);
    card.appendChild(btn);
    host.appendChild(card);
  }
}

function miniGrid(grid, cellPx) {
  const wrap = document.createElement("div");
  wrap.className = "lib-mini-grid";
  wrap.style.setProperty("--mini", cellPx + "px");
  wrap.style.gridTemplateColumns = `repeat(${grid.length}, var(--mini))`;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const id = grid[r][c];
      const el = document.createElement("div");
      el.className = "mini-cell " + classifyId(id);
      wrap.appendChild(el);
    }
  }
  return wrap;
}

function classifyId(id) {
  if (!id) return "empty";
  if (id.startsWith("StartNode")) return "start";
  if (id.includes("_Gate")) return "gate";
  if (id.includes("_Socket")) return "socket";
  if (id.includes("_Magic_")) return "magic";
  if (id.includes("_Rare_")) return "rare";
  if (id.includes("_Legendary_")) return "legendary";
  return "normal";
}

function addBoardToChain(className, boardName) {
  setState(st => {
    if (st.chain.length >= MAX_CHAIN) {
      alert(`Chain already has ${MAX_CHAIN} boards. Remove one first.`);
      return st;
    }
    const board = importBoard(className, boardName);
    const boards = [...st.boards, board];
    const newIdx = boards.length - 1;
    return {
      ...st,
      selectedClass: className,
      boards,
      chain: [...st.chain, defaultChainSlot(newIdx)],
    };
  });
}

function renderGlyphCards() {
  const host = $("#lib-glyph-cards");
  host.innerHTML = "";
  const all = listGlyphs();
  for (const g of all) {
    const card = document.createElement("div");
    card.className = "lib-card lib-glyph-card";
    const title = document.createElement("h4");
    title.textContent = g.name;
    card.appendChild(title);
    if (g.threshold) {
      const t = document.createElement("div"); t.className = "hint";
      t.textContent = "Threshold: " + g.threshold;
      card.appendChild(t);
    }
    if (g.desc) {
      const d = document.createElement("p"); d.className = "lib-glyph-desc";
      d.textContent = stripScaling(g.desc);
      card.appendChild(d);
    }
    if (g.bonus) {
      const b = document.createElement("p"); b.className = "lib-glyph-bonus";
      b.textContent = "★ " + g.bonus;
      card.appendChild(b);
    }
    const btn = document.createElement("button");
    btn.textContent = "+ Add glyph";
    btn.onclick = () => addGlyph(g.id);
    card.appendChild(btn);
    host.appendChild(card);
  }
}

// Glyph descriptions have inline scaling like "{2.65/3/.../10}%" — collapse to max.
function stripScaling(s) {
  return s.replace(/\{[^}]*\}/g, m => {
    const parts = m.slice(1, -1).split("/");
    return parts[parts.length - 1] ?? m;
  });
}

function addGlyph(libGlyphId) {
  setState(st => {
    const id = "lib_" + libGlyphId;
    if (st.glyphs.some(g => g.id === id)) return st;
    const g = importGlyph(libGlyphId);
    if (!g) return st;
    return { ...st, glyphs: [...st.glyphs, g] };
  });
}

function renderChain() {
  const s = getState();
  const ol = $("#lib-chain");
  ol.innerHTML = "";
  s.chain.forEach((slot, pos) => {
    const board = s.boards[slot.boardIndex];
    const li = document.createElement("li");
    li.className = "chain-slot";

    const head = document.createElement("div");
    head.className = "chain-head";
    head.innerHTML = `<strong>${pos + 1}.</strong> ${board?.name ?? "?"}`;
    li.appendChild(head);

    // rotation control
    const rot = document.createElement("label");
    rot.className = "chain-control";
    rot.innerHTML = "Rotation: ";
    const rotSel = document.createElement("select");
    for (const q of [0, 1, 2, 3]) {
      const o = document.createElement("option");
      o.value = q; o.textContent = (q * 90) + "°";
      if ((slot.rotation || 0) === q) o.selected = true;
      rotSel.appendChild(o);
    }
    rotSel.onchange = () => setState(st => updateSlot(st, pos, { rotation: parseInt(rotSel.value, 10) }));
    rot.appendChild(rotSel);
    li.appendChild(rot);

    // filters
    const f = slot.filters || defaultFilters();
    const fdiv = document.createElement("div");
    fdiv.className = "chain-filters";
    for (const kind of ["magic", "rare", "legendary"]) {
      const lbl = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = !!f[kind];
      cb.onchange = () => setState(st => updateSlot(st, pos, {
        filters: { ...st.chain[pos].filters, [kind]: cb.checked },
      }));
      lbl.append(cb, document.createTextNode(" " + kind));
      fdiv.appendChild(lbl);
    }
    li.appendChild(fdiv);

    // move / remove
    const ctl = document.createElement("div"); ctl.className = "chain-buttons";
    const up = btn("↑", () => setState(st => moveSlot(st, pos, -1)));
    const down = btn("↓", () => setState(st => moveSlot(st, pos, +1)));
    const rm = btn("✕", () => setState(st => removeSlot(st, pos)));
    ctl.append(up, down, rm);
    li.appendChild(ctl);

    ol.appendChild(li);
  });
  if (s.chain.length < MAX_CHAIN) {
    const note = document.createElement("li");
    note.className = "chain-empty";
    note.textContent = `(${MAX_CHAIN - s.chain.length} more slot${s.chain.length === MAX_CHAIN - 1 ? "" : "s"} available — pick boards above)`;
    ol.appendChild(note);
  }
}

function btn(text, onclick) {
  const b = document.createElement("button"); b.textContent = text; b.onclick = onclick;
  return b;
}

function updateSlot(st, pos, patch) {
  const chain = st.chain.slice();
  chain[pos] = { ...chain[pos], ...patch };
  return { ...st, chain };
}
function moveSlot(st, pos, dir) {
  const chain = st.chain.slice();
  const np = pos + dir;
  if (np < 0 || np >= chain.length) return st;
  [chain[pos], chain[np]] = [chain[np], chain[pos]];
  return { ...st, chain };
}
function removeSlot(st, pos) {
  const removedBoard = st.chain[pos].boardIndex;
  const chain = st.chain.filter((_, i) => i !== pos);
  // also drop the underlying board if no other chain slot references it AND it was library-imported
  const board = st.boards[removedBoard];
  const stillUsed = chain.some(s => s.boardIndex === removedBoard);
  if (board?.origin && !stillUsed) {
    const boards = st.boards.filter((_, i) => i !== removedBoard);
    const remap = (i) => i > removedBoard ? i - 1 : i;
    const fixedChain = chain.map(s => ({ ...s, boardIndex: remap(s.boardIndex) }));
    const sel = st.selection;
    const selBoardIndex = Math.min(Math.max(0, remap(sel.boardIndex)), boards.length - 1);
    return { ...st, boards, chain: fixedChain, selection: { ...sel, boardIndex: selBoardIndex, cell: null } };
  }
  return { ...st, chain };
}

function renderSelectedGlyphs() {
  const s = getState();
  const ul = $("#lib-selected-glyphs");
  ul.innerHTML = "";
  if (!s.glyphs.length) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "(no glyphs selected — pick some above)";
    ul.appendChild(li);
    return;
  }
  s.glyphs.forEach((g, i) => {
    const li = document.createElement("li");
    li.textContent = g.name + (g.threshold ? "  — thr: " + g.threshold : "");
    const rm = btn("✕", () => setState(st => ({ ...st, glyphs: st.glyphs.filter((_, j) => j !== i) })));
    rm.style.marginLeft = "8px";
    li.appendChild(rm);
    ul.appendChild(li);
  });
}

export function wireLibraryUI() {
  $("#lib-class").onchange = (e) => setState(st => ({ ...st, selectedClass: e.target.value }));
  $("#lib-try-rotations").onchange = (e) => setState(st => ({ ...st, tryAllRotations: e.target.checked }));
}
