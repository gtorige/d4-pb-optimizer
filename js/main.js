import { getState, setState, subscribe, resetState, importState } from "./state.js";
import * as boards from "./board-editor.js";
import * as glyphs from "./glyph-editor.js";
import * as damage from "./damage.js";
import * as library from "./library-ui.js";
import { optimize } from "./solver.js";
import { rotateBoard } from "./rotation.js";

const $ = (s) => document.querySelector(s);

function setupTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    };
  });
}

let stopRequested = false;

async function runOptimize() {
  const state = getState();
  const status = $("#run-status");
  const result = $("#run-result");
  result.innerHTML = "";
  status.textContent = "Starting…";

  // sync run-config inputs into state
  setState(st => ({
    ...st,
    pointBudget: parseInt($("#point-budget").value, 10) || 1,
    glyphRadius: parseInt($("#glyph-radius").value, 10) || 1,
    tryAllRotations: $("#opt-rotations").checked,
  }));

  $("#run-optimize").disabled = true;
  $("#stop-optimize").disabled = false;
  stopRequested = false;

  try {
    const out = await optimize(getState(), {
      iterations: parseInt($("#sa-iter").value, 10) || 20000,
      startTemp: parseFloat($("#sa-temp").value) || 1,
      seed: parseInt($("#sa-seed").value, 10) || 1,
      onProgress: (info) => {
        status.textContent = `iter ${info.iter}  cur=${info.cur.toFixed(3)}  best=${info.best.toFixed(3)}  pts=${info.points}/${getState().pointBudget}  T=${info.temp.toFixed(3)}`;
      },
      shouldStop: () => stopRequested,
    });
    renderResult(out);
  } catch (err) {
    status.textContent = "Error: " + err.message;
    console.error(err);
  } finally {
    $("#run-optimize").disabled = false;
    $("#stop-optimize").disabled = true;
  }
}

function renderResult(out) {
  const result = $("#run-result");
  result.innerHTML = "";
  const head = document.createElement("div");
  head.innerHTML = `<strong>Best score:</strong> ${out.score.toFixed(3)} &nbsp; ` +
    `<strong>Active boards:</strong> ${out.activeBoards.length} / ${out.ctx.chain.length}`;
  result.appendChild(head);

  const rotLine = document.createElement("div");
  rotLine.innerHTML = "<strong>Rotations:</strong> " +
    out.rotations.map((q, i) => `#${i + 1}=${q * 90}°`).join(", ");
  result.appendChild(rotLine);

  const statsDiv = document.createElement("div");
  statsDiv.innerHTML = "<strong>Stats:</strong> " +
    Object.entries(out.stats).map(([k, v]) => `${k}=${(+v).toFixed(2)}`).join(", ");
  result.appendChild(statsDiv);

  const apply = document.createElement("button");
  apply.textContent = "Apply rotations to chain";
  apply.onclick = () => {
    setState(st => {
      const chain = st.chain.map((slot, i) => ({ ...slot, rotation: out.rotations[i] ?? slot.rotation }));
      return { ...st, chain };
    });
    alert("Rotations applied. Open Boards tab to inspect.");
  };
  result.appendChild(apply);

  // mini-render each rotated board with activations
  const state = getState();
  for (let bi = 0; bi < out.ctx.chain.length; bi++) {
    const slot = out.ctx.chain[bi];
    const baseBoard = state.boards[slot.boardIndex];
    const rotated = rotateBoard(baseBoard, out.rotations[bi] || 0);
    const act = out.solution.activated[bi];
    const wrap = document.createElement("div");
    wrap.className = "result-board";
    const h = document.createElement("h4");
    h.textContent = `${bi + 1}. ${baseBoard.name} — ${act.size} pts, rot ${out.rotations[bi] * 90}°` +
      (out.solution.glyphs[bi] ? ` (glyph: ${state.glyphs.find(g => g.id === out.solution.glyphs[bi])?.name})` : "");
    wrap.appendChild(h);
    const grid = document.createElement("div");
    grid.className = "grid";
    grid.style.setProperty("--node", "10px");
    grid.style.gridTemplateColumns = `repeat(${rotated.size}, 10px)`;
    for (let r = 0; r < rotated.size; r++) {
      for (let c = 0; c < rotated.size; c++) {
        const cell = rotated.cells[r][c];
        const el = document.createElement("div");
        el.className = "cell " + cell.type;
        const k = r + "," + c;
        if (act.has(k)) el.classList.add("activated");
        if (out.solution.glyphSocket[bi] === k) el.classList.add("glyph-aura");
        grid.appendChild(el);
      }
    }
    wrap.appendChild(grid);
    result.appendChild(wrap);
  }
}

function setupRunControls() {
  $("#run-optimize").onclick = runOptimize;
  $("#stop-optimize").onclick = () => { stopRequested = true; };
  // Sync state to inputs
  const s = getState();
  $("#point-budget").value = s.pointBudget;
  $("#glyph-radius").value = s.glyphRadius;
  $("#opt-rotations").checked = !!s.tryAllRotations;
}

function setupDataTab() {
  $("#export-json").onclick = () => {
    const data = JSON.stringify(getState(), (k, v) => v instanceof Set ? [...v] : v, 2);
    $("#json-preview").textContent = data;
    const blob = new Blob([data], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "d4pb-config.json";
    a.click();
  };
  $("#import-json").onclick = () => $("#import-file").click();
  $("#import-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try { importState(text); } catch (err) { alert("Import failed: " + err.message); }
  };
  $("#reset-all").onclick = () => {
    if (confirm("Reset all data?")) resetState();
  };
}

function rerender() {
  library.render();
  boards.render();
  glyphs.render();
  damage.render();
  $("#json-preview").textContent = JSON.stringify(getState(), (k, v) => v instanceof Set ? [...v] : v, 2);
}

function init() {
  setupTabs();
  library.wireLibraryUI();
  boards.wireBoardEditor();
  glyphs.wireGlyphEditor();
  damage.wireDamageEditor();
  setupRunControls();
  setupDataTab();
  subscribe(rerender);
  rerender();
}

init();
