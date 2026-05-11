import { getState, setState, makeBoard, resizeBoard, defaultChainSlot, defaultFilters } from "./state.js";

let activatedOverlay = null; // {boardIndex: Set<"r,c">}

export function setActivatedOverlay(map) { activatedOverlay = map; render(); }

const $ = (s) => document.querySelector(s);

function currentPaint() {
  const el = document.querySelector('input[name="paint"]:checked');
  return el ? el.value : "normal";
}

export function render() {
  renderBoardList();
  renderChain();
  renderGrid();
  renderNodeEditor();
}

function renderBoardList() {
  const s = getState();
  const ul = $("#board-list");
  ul.innerHTML = "";
  s.boards.forEach((b, i) => {
    const li = document.createElement("li");
    li.textContent = `${i + 1}. ${b.name}`;
    if (i === s.selection.boardIndex) li.classList.add("selected");
    li.onclick = () => setState(st => ({ ...st, selection: { ...st.selection, boardIndex: i, cell: null } }));
    const del = document.createElement("button");
    del.textContent = "✕";
    del.style.marginLeft = "6px";
    del.onclick = (e) => {
      e.stopPropagation();
      if (!confirm(`Delete board "${b.name}"?`)) return;
      setState(st => {
        const boards = st.boards.filter((_, j) => j !== i);
        const chain = st.chain
          .filter(slot => slot.boardIndex !== i)
          .map(slot => ({ ...slot, boardIndex: slot.boardIndex > i ? slot.boardIndex - 1 : slot.boardIndex }));
        const boardIndex = Math.max(0, Math.min(st.selection.boardIndex, boards.length - 1));
        return { ...st, boards, chain, selection: { ...st.selection, boardIndex, cell: null } };
      });
    };
    li.appendChild(del);
    ul.appendChild(li);
  });
}

function renderChain() {
  const s = getState();
  const ol = $("#board-chain");
  ol.innerHTML = "";
  s.chain.forEach((slot, pos) => {
    const li = document.createElement("li");
    const rotTxt = slot.rotation ? ` (${slot.rotation * 90}°)` : "";
    li.textContent = (s.boards[slot.boardIndex]?.name ?? "?") + rotTxt;
    const up = document.createElement("button"); up.textContent = "↑"; up.style.marginLeft = "4px";
    up.onclick = () => setState(st => {
      if (pos === 0) return st;
      const chain = st.chain.slice();
      [chain[pos - 1], chain[pos]] = [chain[pos], chain[pos - 1]];
      return { ...st, chain };
    });
    const down = document.createElement("button"); down.textContent = "↓"; down.style.marginLeft = "2px";
    down.onclick = () => setState(st => {
      if (pos === st.chain.length - 1) return st;
      const chain = st.chain.slice();
      [chain[pos + 1], chain[pos]] = [chain[pos], chain[pos + 1]];
      return { ...st, chain };
    });
    const rm = document.createElement("button"); rm.textContent = "✕"; rm.style.marginLeft = "2px";
    rm.onclick = () => setState(st => ({ ...st, chain: st.chain.filter((_, i) => i !== pos) }));
    li.append(up, down, rm);
    ol.appendChild(li);
  });
  // add-to-chain dropdown
  const sel = document.createElement("select");
  sel.innerHTML = `<option value="">+ add board to chain</option>` +
    s.boards.map((b, i) => `<option value="${i}">${b.name}</option>`).join("");
  sel.onchange = () => {
    if (sel.value === "") return;
    const i = parseInt(sel.value, 10);
    setState(st => ({ ...st, chain: [...st.chain, defaultChainSlot(i)] }));
  };
  ol.appendChild(sel);
}

function renderGrid() {
  const s = getState();
  const board = s.boards[s.selection.boardIndex];
  $("#board-name").value = board.name;
  $("#board-size").value = board.size;
  const host = $("#board-grid-host");
  host.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "grid";
  grid.style.gridTemplateColumns = `repeat(${board.size}, var(--node))`;
  const active = activatedOverlay?.[s.selection.boardIndex];
  for (let r = 0; r < board.size; r++) {
    for (let c = 0; c < board.size; c++) {
      const cell = board.cells[r][c];
      const el = document.createElement("div");
      el.className = "cell " + cell.type;
      if (active && active.has(`${r},${c}`)) el.classList.add("activated");
      if (s.selection.cell && s.selection.cell[0] === r && s.selection.cell[1] === c) el.classList.add("selected");
      el.title = describeCell(cell, r, c);
      el.onmousedown = (e) => paintAt(r, c, e);
      el.onmouseenter = (e) => { if (e.buttons === 1) paintAt(r, c, e, /*setSel*/ false); };
      grid.appendChild(el);
    }
  }
  host.appendChild(grid);
}

function describeCell(cell, r, c) {
  const stats = Object.entries(cell.stats || {}).map(([k, v]) => `${k}: ${v}`).join(", ");
  return `(${r},${c}) ${cell.type}${cell.gateDir ? " [" + cell.gateDir + "]" : ""}${stats ? " — " + stats : ""}`;
}

function paintAt(r, c, e, setSel = true) {
  const paint = currentPaint();
  const isRight = e.button === 2 || e.shiftKey;
  setState(st => {
    const board = st.boards[st.selection.boardIndex];
    const cell = board.cells[r][c];
    if (isRight) {
      cell.type = "empty"; cell.gateDir = undefined; cell.stats = {};
    } else {
      cell.type = paint;
      if (paint === "gate") {
        // infer direction from edge
        const size = board.size;
        cell.gateDir = r === 0 ? "N" : r === size - 1 ? "S" : c === 0 ? "W" : c === size - 1 ? "E" : "N";
      } else {
        cell.gateDir = undefined;
      }
      if (paint === "start") {
        // ensure only one start cell exists per board
        for (let rr = 0; rr < board.size; rr++) for (let cc = 0; cc < board.size; cc++)
          if ((rr !== r || cc !== c) && board.cells[rr][cc].type === "start")
            board.cells[rr][cc] = { type: "empty", stats: {} };
      }
    }
    const selection = setSel ? { ...st.selection, cell: [r, c] } : st.selection;
    return { ...st, selection };
  });
}

function renderNodeEditor() {
  const s = getState();
  const host = $("#node-editor");
  if (!s.selection.cell) { host.innerHTML = "<em>Click a node to edit its stats.</em>"; return; }
  const [r, c] = s.selection.cell;
  const board = s.boards[s.selection.boardIndex];
  const cell = board.cells[r][c];
  host.innerHTML = "";
  const head = document.createElement("div");
  head.innerHTML = `<strong>(${r}, ${c})</strong> — ${cell.type}` +
    (cell.gateDir ? ` [${cell.gateDir}]` : "") +
    (cell.label ? ` — <em>${cell.label}</em>` : "");
  host.appendChild(head);

  if (cell.type !== "empty" && cell.type !== "start") {
    const lbl = document.createElement("label");
    lbl.className = "cell-disable";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = !!cell.disabled;
    cb.onchange = () => setState(st => {
      st.boards[st.selection.boardIndex].cells[r][c].disabled = cb.checked;
      return { ...st };
    });
    lbl.append(cb, document.createTextNode(" Block in optimizer (per-node override)"));
    host.appendChild(lbl);
  }

  if (cell.nodeId) {
    const idLine = document.createElement("div"); idLine.className = "hint";
    idLine.textContent = "Node id: " + cell.nodeId;
    host.appendChild(idLine);
  }

  if (cell.type === "gate") {
    const sel = document.createElement("select");
    for (const d of ["N", "E", "S", "W"]) {
      const o = document.createElement("option"); o.value = d; o.textContent = d;
      if (cell.gateDir === d) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => setState(st => {
      st.boards[st.selection.boardIndex].cells[r][c].gateDir = sel.value;
      return { ...st };
    });
    head.appendChild(document.createTextNode(" Direction: "));
    head.appendChild(sel);
  }

  const note = document.createElement("p"); note.className = "hint";
  note.textContent = "Stats (added when activated). Use any names — they must match bucket stat names to count.";
  host.appendChild(note);

  const list = document.createElement("div");
  for (const [k, v] of Object.entries(cell.stats || {})) {
    list.appendChild(statRow(k, v, (nk, nv) => {
      setState(st => {
        const cs = st.boards[st.selection.boardIndex].cells[r][c].stats;
        delete cs[k];
        if (nk) cs[nk] = nv;
        return { ...st };
      });
    }));
  }
  host.appendChild(list);
  const addBtn = document.createElement("button"); addBtn.textContent = "+ stat";
  addBtn.onclick = () => setState(st => {
    const cs = st.boards[st.selection.boardIndex].cells[r][c].stats;
    let k = "new_stat", i = 1;
    while (k in cs) { k = "new_stat_" + (++i); }
    cs[k] = 0;
    return { ...st };
  });
  host.appendChild(addBtn);

  // legendary node bonus
  if (cell.type === "legendary") {
    const ln = document.createElement("p"); ln.className = "hint";
    ln.textContent = "Note: legendary effects are entered as stats too. Add a synthetic stat like 'legendary_proc' and a bucket weight for it.";
    host.appendChild(ln);
  }
}

function statRow(name, value, onChange) {
  const div = document.createElement("div");
  div.className = "stat-row";
  const nameI = document.createElement("input");
  nameI.value = name;
  const valI = document.createElement("input");
  valI.type = "number"; valI.step = "any"; valI.value = value;
  const rm = document.createElement("button"); rm.textContent = "✕";
  nameI.onchange = () => onChange(nameI.value.trim(), parseFloat(valI.value) || 0);
  valI.onchange = () => onChange(nameI.value.trim(), parseFloat(valI.value) || 0);
  rm.onclick = () => onChange("", 0);
  div.append(nameI, valI, rm);
  return div;
}

export function wireBoardEditor() {
  $("#add-board").onclick = () => setState(st => ({
    ...st, boards: [...st.boards, makeBoard("Board " + (st.boards.length + 1))]
  }));
  $("#board-name").onchange = () => setState(st => {
    st.boards[st.selection.boardIndex].name = $("#board-name").value;
    return { ...st };
  });
  $("#board-size").onchange = () => {
    const sz = Math.max(5, Math.min(31, parseInt($("#board-size").value, 10) || 21));
    setState(st => {
      resizeBoard(st.boards[st.selection.boardIndex], sz);
      return { ...st };
    });
  };
  $("#clear-board").onclick = () => {
    if (!confirm("Clear this board?")) return;
    setState(st => {
      const cur = st.boards[st.selection.boardIndex];
      st.boards[st.selection.boardIndex] = { ...makeBoard(cur.name), size: cur.size };
      // resize to match
      resizeBoard(st.boards[st.selection.boardIndex], cur.size);
      return { ...st };
    });
  };
  document.addEventListener("contextmenu", (e) => {
    if (e.target.classList.contains("cell")) e.preventDefault();
  });
}
