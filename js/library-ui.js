// UI for the bundled paragon-board library.
import { getState, setState, defaultChainSlot, defaultFilters } from "./state.js";
import { classes, getDataset, listBoards, listGlyphs, importBoard, importGlyph, lookupNode, setDataset, datasetIsBundled } from "./library.js";
import { rotateBoard } from "./rotation.js";

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
  const avail = classes();
  if (avail.length && !avail.includes(s.selectedClass)) {
    setState(st => ({ ...st, selectedClass: avail[0] }));
    return; // re-renders via subscribe
  }
  for (const c of avail) {
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
    card.appendChild(miniGrid(getDataset()[className].boards[boardName], 4));
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

/** Find srcKeys of cells matching a predicate on a Board. */
function findCells(board, pred) {
  const out = [];
  for (let r = 0; r < board.size; r++) {
    for (let c = 0; c < board.size; c++) {
      const cell = board.cells[r][c];
      if (cell && pred(cell)) out.push(cell.srcKey || (r + "," + c));
    }
  }
  return out;
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
    // Priority defaults: every legendary on this board is auto-required.
    // The user can uncheck them in Pick-nodes if they don't want one.
    const selectedNodes = {};
    for (const k of findCells(board, c => c.type === "legendary")) selectedNodes[k] = true;
    const slot = { ...defaultChainSlot(newIdx), selectedNodes };
    return {
      ...st,
      selectedClass: className,
      boards,
      chain: [...st.chain, slot],
    };
  });
}

function renderGlyphCards() {
  const host = $("#lib-glyph-cards");
  host.innerHTML = "";
  const s = getState();
  const all = listGlyphs(s.selectedClass);
  if (!all.length) {
    const note = document.createElement("p"); note.className = "hint";
    note.textContent = `(no glyphs flagged usable by ${s.selectedClass} in the bundled dataset)`;
    host.appendChild(note);
    return;
  }
  for (const g of all) {
    const card = document.createElement("div");
    card.className = "lib-card lib-glyph-card";
    const title = document.createElement("h4");
    title.textContent = g.name;
    card.appendChild(title);
    if (g.rarity || g.radius) {
      const meta = document.createElement("div"); meta.className = "hint";
      const parts = [];
      if (g.rarity) parts.push(g.rarity);
      if (g.radius) parts.push("radius " + g.radius);
      meta.textContent = parts.join(" · ");
      card.appendChild(meta);
    }
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

// Track which chain slots have their node panel expanded (UI-only).
const nodePanelOpen = new Set();

function renderChain() {
  const s = getState();
  const ol = $("#lib-chain");
  ol.innerHTML = "";
  s.chain.forEach((slot, pos) => {
    const board = s.boards[slot.boardIndex];
    const li = document.createElement("li");
    li.className = "chain-slot";

    // --- Row 1: header + controls ---
    const row1 = document.createElement("div");
    row1.className = "chain-row";

    const head = document.createElement("div");
    head.className = "chain-head";
    head.innerHTML = `<strong>${pos + 1}.</strong> ${board?.name ?? "?"}`;
    row1.appendChild(head);

    // rotation
    const rot = document.createElement("label");
    rot.className = "chain-control";
    rot.innerHTML = "Rot: ";
    const rotSel = document.createElement("select");
    for (const q of [0, 1, 2, 3]) {
      const o = document.createElement("option");
      o.value = q; o.textContent = (q * 90) + "°";
      if ((slot.rotation || 0) === q) o.selected = true;
      rotSel.appendChild(o);
    }
    rotSel.onchange = () => setState(st => updateSlot(st, pos, { rotation: parseInt(rotSel.value, 10) }));
    rot.appendChild(rotSel);
    row1.appendChild(rot);

    // glyph picker
    const glyphLbl = document.createElement("label");
    glyphLbl.className = "chain-control";
    glyphLbl.innerHTML = "Glyph: ";
    const glyphSel = document.createElement("select");
    const noneOpt = document.createElement("option");
    noneOpt.value = ""; noneOpt.textContent = "— (optimizer chooses) —";
    glyphSel.appendChild(noneOpt);
    for (const g of s.glyphs) {
      const o = document.createElement("option");
      o.value = g.id; o.textContent = g.name;
      if (slot.pinnedGlyph === g.id) o.selected = true;
      glyphSel.appendChild(o);
    }
    glyphSel.onchange = () => setState(st => {
      const newPin = glyphSel.value || null;
      const slotNow = st.chain[pos];
      const boardNow = st.boards[slotNow.boardIndex];
      const nextSel = { ...(slotNow.selectedNodes || {}) };
      // Pin a glyph -> auto-mark the first socket as required.
      // Unpin -> drop any auto-marked socket(s).
      const socketKeys = boardNow ? findCells(boardNow, c => c.type === "socket") : [];
      if (newPin) {
        if (socketKeys.length && !socketKeys.some(k => nextSel[k] === true)) {
          nextSel[socketKeys[0]] = true;
        }
      } else {
        for (const k of socketKeys) delete nextSel[k];
      }
      return updateSlot(st, pos, { pinnedGlyph: newPin, selectedNodes: nextSel });
    });
    glyphLbl.appendChild(glyphSel);
    row1.appendChild(glyphLbl);

    // controls
    const ctl = document.createElement("div"); ctl.className = "chain-buttons";
    const up = btn("↑", () => setState(st => moveSlot(st, pos, -1)));
    const down = btn("↓", () => setState(st => moveSlot(st, pos, +1)));
    const rm = btn("✕", () => setState(st => removeSlot(st, pos)));
    ctl.append(up, down, rm);
    row1.appendChild(ctl);

    li.appendChild(row1);

    // --- Row 2: filters + Pick nodes toggle ---
    const row2 = document.createElement("div");
    row2.className = "chain-row chain-row-filters";
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
    row2.appendChild(fdiv);

    const pickBtn = document.createElement("button");
    pickBtn.className = "chain-pick-btn";
    const isOpen = nodePanelOpen.has(pos);
    const overrideCount = Object.keys(slot.selectedNodes || {}).length;
    pickBtn.textContent = (isOpen ? "▾ " : "▸ ") + "Pick nodes" +
      (overrideCount ? ` (${overrideCount} override${overrideCount === 1 ? "" : "s"})` : "");
    pickBtn.onclick = () => {
      if (isOpen) nodePanelOpen.delete(pos); else nodePanelOpen.add(pos);
      renderChain();
    };
    row2.appendChild(pickBtn);

    li.appendChild(row2);

    // --- Optional node panel ---
    if (isOpen && board) {
      li.appendChild(renderNodePanel(pos, slot, board));
    }

    ol.appendChild(li);
  });
  if (s.chain.length < MAX_CHAIN) {
    const note = document.createElement("li");
    note.className = "chain-empty";
    note.textContent = `(${MAX_CHAIN - s.chain.length} more slot${s.chain.length === MAX_CHAIN - 1 ? "" : "s"} available — pick boards above)`;
    ol.appendChild(note);
  }
}

function renderNodePanel(pos, slot, board) {
  const wrap = document.createElement("div");
  wrap.className = "node-panel pick-panel";

  // Apply the slot's rotation so what the user clicks visually matches the
  // mini-grid they see in the chain card and the result panel.
  const rotated = slot.rotation ? rotateBoard(board, slot.rotation) : board;
  const sel = slot.selectedNodes || {};

  // Per-tier counts
  const counts = { legendary: { total: 0, required: 0 }, rare: { total: 0, required: 0 }, magic: { total: 0, required: 0 } };
  for (let r = 0; r < rotated.size; r++) {
    for (let c = 0; c < rotated.size; c++) {
      const cell = rotated.cells[r][c];
      if (!cell || !counts[cell.type]) continue;
      counts[cell.type].total++;
      if (sel[cell.srcKey] === true) counts[cell.type].required++;
    }
  }

  // Header: per-tier summary chips + bulk-clear button
  const header = document.createElement("div");
  header.className = "pick-header";
  for (const tier of ["legendary", "rare", "magic"]) {
    const ct = counts[tier];
    if (ct.total === 0) continue;
    const chip = document.createElement("span");
    chip.className = "pick-chip pick-chip-" + tier;
    chip.textContent = `${ct.required} / ${ct.total} ${tier}`;
    chip.title = `Click "all" to require every ${tier} on this board`;
    chip.onclick = (e) => {
      e.stopPropagation();
      bulkSetRequiredForTier(pos, board, tier, ct.required < ct.total);
    };
    header.appendChild(chip);
  }
  const clearBtn = btn("Clear all", () => setState(st => updateSlot(st, pos, { selectedNodes: {} })));
  clearBtn.className = "pick-clear";
  header.appendChild(clearBtn);
  wrap.appendChild(header);

  const hint = document.createElement("p");
  hint.className = "hint pick-hint";
  hint.innerHTML = `Click <span class="pick-leg-swatch swatch-magic"></span> magic / <span class="pick-leg-swatch swatch-rare"></span> rare / <span class="pick-leg-swatch swatch-legendary"></span> legendary cells in the grid to mark them as REQUIRED. Click again to unmark. Required cells are outlined in gold.`;
  wrap.appendChild(hint);

  // The interactive mini-grid
  const grid = document.createElement("div");
  grid.className = "pick-grid";
  grid.style.gridTemplateColumns = `repeat(${rotated.size}, var(--pick-cell, 16px))`;
  for (let r = 0; r < rotated.size; r++) {
    for (let c = 0; c < rotated.size; c++) {
      const cell = rotated.cells[r][c];
      const el = document.createElement("div");
      el.className = "pick-cell " + (cell?.type || "empty");
      const pickable = cell && (cell.type === "magic" || cell.type === "rare" || cell.type === "legendary");
      if (cell?.nodeId) {
        const parts = [cell.label || cell.nodeId];
        if (cell.desc) parts.push(cell.desc);
        el.title = parts.join("\n");
      }
      if (pickable) {
        el.classList.add("pickable");
        if (sel[cell.srcKey] === true) el.classList.add("required");
        el.onclick = () => setState(st => {
          const slotNow = st.chain[pos];
          const nextSel = { ...(slotNow.selectedNodes || {}) };
          if (nextSel[cell.srcKey] === true) delete nextSel[cell.srcKey];
          else nextSel[cell.srcKey] = true;
          return updateSlot(st, pos, { selectedNodes: nextSel });
        });
      }
      grid.appendChild(el);
    }
  }
  wrap.appendChild(grid);

  // Required-nodes list below the grid (with legendary descriptions)
  const required = [];
  for (let r = 0; r < rotated.size; r++) {
    for (let c = 0; c < rotated.size; c++) {
      const cell = rotated.cells[r][c];
      if (cell?.srcKey && sel[cell.srcKey] === true) required.push(cell);
    }
  }
  if (required.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "(no nodes required on this board yet)";
    wrap.appendChild(empty);
  } else {
    const list = document.createElement("div");
    list.className = "pick-required-list";
    const h = document.createElement("h6");
    h.textContent = `Required nodes (${required.length}):`;
    list.appendChild(h);
    // sort: legendaries first, then rare, then magic
    const tierRank = { legendary: 0, rare: 1, magic: 2 };
    required.sort((a, b) => (tierRank[a.type] ?? 9) - (tierRank[b.type] ?? 9));
    for (const cell of required) {
      const item = document.createElement("div");
      item.className = "pick-required-item pick-required-" + cell.type;
      const head = document.createElement("div");
      head.className = "pick-required-head";
      const sw = document.createElement("span");
      sw.className = "pick-leg-swatch swatch-" + cell.type;
      head.appendChild(sw);
      const name = document.createElement("strong");
      name.textContent = cell.label || cell.nodeId || "?";
      head.appendChild(name);
      const rm = document.createElement("button");
      rm.className = "pick-required-rm";
      rm.textContent = "✕";
      rm.onclick = () => setState(st => {
        const slotNow = st.chain[pos];
        const nextSel = { ...(slotNow.selectedNodes || {}) };
        delete nextSel[cell.srcKey];
        return updateSlot(st, pos, { selectedNodes: nextSel });
      });
      head.appendChild(rm);
      item.appendChild(head);
      if (cell.type === "legendary" && cell.desc) {
        const d = document.createElement("div");
        d.className = "node-desc";
        d.textContent = cell.desc;
        item.appendChild(d);
      }
      list.appendChild(item);
    }
    wrap.appendChild(list);
  }

  if (counts.legendary.total === 0 && counts.rare.total === 0 && counts.magic.total === 0) {
    const empty = document.createElement("div"); empty.className = "hint";
    empty.textContent = "(no magic/rare/legendary nodes on this board)";
    wrap.appendChild(empty);
  }
  return wrap;
}

function bulkSetRequiredForTier(pos, board, tier, required) {
  setState(st => {
    const slot = st.chain[pos];
    const nextSel = { ...(slot.selectedNodes || {}) };
    for (let r = 0; r < board.size; r++) {
      for (let c = 0; c < board.size; c++) {
        const cell = board.cells[r][c];
        if (!cell || cell.type !== tier || !cell.srcKey) continue;
        if (required) nextSel[cell.srcKey] = true;
        else delete nextSel[cell.srcKey];
      }
    }
    return updateSlot(st, pos, { selectedNodes: nextSel });
  });
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
    const parts = [g.name];
    if (g.rarity) parts.push(g.rarity);
    if (g.radius) parts.push("r=" + g.radius);
    if (g.threshold) parts.push(g.threshold);
    li.textContent = parts.join(" · ");
    const rm = btn("✕", () => setState(st => ({ ...st, glyphs: st.glyphs.filter((_, j) => j !== i) })));
    rm.style.marginLeft = "8px";
    li.appendChild(rm);
    ul.appendChild(li);
  });
}

export function wireLibraryUI() {
  $("#lib-class").onchange = (e) => setState(st => ({ ...st, selectedClass: e.target.value }));
  $("#lib-try-rotations").onchange = (e) => setState(st => ({ ...st, tryAllRotations: e.target.checked }));
  $("#lib-load-dataset").onclick = () => $("#lib-dataset-file").click();
  $("#lib-dataset-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      setDataset(data);
      // selectedClass may no longer exist in the new dataset
      const avail = classes();
      setState(st => ({ ...st, selectedClass: avail.includes(st.selectedClass) ? st.selectedClass : avail[0] }));
      alert(`Dataset loaded: ${classes().length} class(es).`);
    } catch (err) {
      alert("Dataset import failed: " + err.message);
    }
    e.target.value = "";
  };
  $("#lib-reset-dataset").onclick = () => {
    if (!confirm("Restore the bundled dataset? Any imported dataset will be discarded.")) return;
    setDataset(null);
    const avail = classes();
    setState(st => ({ ...st, selectedClass: avail.includes(st.selectedClass) ? st.selectedClass : avail[0] }));
    alert("Restored bundled dataset.");
  };
}
