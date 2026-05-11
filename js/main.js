import { getState, setState, subscribe, resetState, importState } from "./state.js";
import * as boards from "./board-editor.js";
import * as glyphs from "./glyph-editor.js";
import * as damage from "./damage.js";
import * as library from "./library-ui.js";
import { optimize } from "./solver.js";
import { optimizeSteiner } from "./optimizer-steiner.js";
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
    minimizePoints: $("#opt-minpoints").checked,
    algorithm: $("#opt-algorithm")?.value || "steiner",
  }));

  $("#run-optimize").disabled = true;
  $("#stop-optimize").disabled = false;
  stopRequested = false;

  try {
    const st = getState();
    if (st.algorithm === "steiner") {
      status.textContent = "Running Steiner Tree (exact)…";
      const t0 = performance.now();
      const out = optimizeSteiner(st);
      const dt = (performance.now() - t0).toFixed(0);
      status.textContent = `Steiner: ${out.totalPoints} cells across ${out.activeBoards.length}/${st.chain.length} boards (${dt} ms)` +
        (out.infeasibleBoards.length ? ` — infeasible: boards ${out.infeasibleBoards.map(i => i + 1).join(", ")}` : "");
      renderResult(out);
      return;
    }
    const out = await optimize(st, {
      iterations: parseInt($("#sa-iter").value, 10) || 20000,
      startTemp: parseFloat($("#sa-temp").value) || 1,
      seed: parseInt($("#sa-seed").value, 10) || 1,
      onProgress: (info) => {
        let line = `iter ${info.iter}  cur=${info.cur.toFixed(3)}  best=${info.best.toFixed(3)}  pts=${info.points}/${getState().pointBudget}  T=${info.temp.toFixed(3)}`;
        if (info.warning) line += `\n${info.warning}`;
        status.textContent = line;
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

function buildSummary(out) {
  const state = getState();
  const wrap = document.createElement("div");
  wrap.className = "result-summary";

  // 1. Stats grouped by category
  const groups = { attr: {}, magic: {}, rare: {}, legendary: {}, glyph: {}, other: {} };
  for (const [k, v] of Object.entries(out.stats)) {
    if (!v) continue;
    const prefix = k.split("_")[0];
    const target = groups[prefix] || groups.other;
    target[k] = v;
  }
  const statsSec = document.createElement("details");
  statsSec.className = "result-section";
  const sh = document.createElement("summary");
  sh.textContent = "Stats by category";
  statsSec.appendChild(sh);
  for (const [name, obj] of Object.entries(groups)) {
    const keys = Object.keys(obj);
    if (!keys.length) continue;
    const line = document.createElement("div");
    line.className = "stats-line stats-" + name;
    const total = Object.values(obj).reduce((a, b) => a + (+b || 0), 0);
    line.innerHTML = `<strong>${name}</strong> (Σ ${total.toFixed(2)}): ` +
      keys.map(k => `${k.replace(/^[a-z]+_/, "")}=${(+obj[k]).toFixed(2)}`).join(", ");
    statsSec.appendChild(line);
  }
  wrap.appendChild(statsSec);

  // 2. Activated nodes per board, grouped by tier, with their names
  const tiersSec = document.createElement("div");
  tiersSec.className = "result-section";
  const th = document.createElement("h4"); th.textContent = "Activated nodes by board"; tiersSec.appendChild(th);
  for (let bi = 0; bi < out.ctx.chain.length; bi++) {
    const slot = out.ctx.chain[bi];
    const boardIdx = out.order?.[bi] ?? slot.boardIndex;
    const board = state.boards[boardIdx];
    const rotatedCells = out.ctx.idx[bi].rotated?.cells || board.cells;
    const act = out.solution.activated[bi];
    const byTier = { legendary: [], rare: [], magic: [], socket: [], normal: [], gate: [], start: [] };
    let totalNorm = 0;
    for (const k of act) {
      const [r, c] = k.split(",").map(Number);
      const cell = rotatedCells[r]?.[c];
      if (!cell) continue;
      const label = cell.label || cell.nodeId || cell.type;
      if (byTier[cell.type]) byTier[cell.type].push(label);
      if (cell.type === "normal") totalNorm++;
    }
    const boardDiv = document.createElement("div");
    boardDiv.className = "result-board-summary";
    const head = document.createElement("div");
    head.innerHTML = `<strong>${bi + 1}. ${board.name}</strong> — ${act.size} pts ` +
      (slot.pinnedGlyph ? ` · glyph: ${state.glyphs.find(g => g.id === slot.pinnedGlyph)?.name ?? "?"}` :
       out.solution.glyphs[bi] ? ` · glyph: ${state.glyphs.find(g => g.id === out.solution.glyphs[bi])?.name ?? "?"}` : "");
    boardDiv.appendChild(head);

    for (const tier of ["legendary", "rare", "magic"]) {
      if (!byTier[tier].length) continue;
      const counts = countLabels(byTier[tier]);
      const line = document.createElement("div");
      line.className = "tier-line tier-" + tier;
      line.innerHTML = `<span class="tier-tag">${tier}</span> ` +
        Object.entries(counts).map(([n, c]) => c > 1 ? `${n} ×${c}` : n).join(", ");
      boardDiv.appendChild(line);
    }
    if (byTier.socket.length) {
      const line = document.createElement("div");
      line.className = "tier-line tier-socket";
      line.innerHTML = `<span class="tier-tag">socket</span> ×${byTier.socket.length}`;
      boardDiv.appendChild(line);
    }
    if (totalNorm) {
      const line = document.createElement("div");
      line.className = "tier-line tier-normal";
      line.textContent = `normal nodes: ${totalNorm}`;
      boardDiv.appendChild(line);
    }
    tiersSec.appendChild(boardDiv);
  }
  wrap.appendChild(tiersSec);

  return wrap;
}

function countLabels(arr) {
  const m = {};
  for (const x of arr) m[x] = (m[x] || 0) + 1;
  return m;
}

function renderResult(out) {
  const result = $("#run-result");
  result.innerHTML = "";
  const head = document.createElement("div");
  head.innerHTML = `<strong>Best score:</strong> ${out.score.toFixed(3)} &nbsp; ` +
    `<strong>Points:</strong> ${out.totalPoints ?? "?"}/${out.ctx.pointBudget} &nbsp; ` +
    `<strong>Active boards:</strong> ${out.activeBoards.length} / ${out.ctx.chain.length}`;
  result.appendChild(head);
  if (Array.isArray(out.dropped) && out.dropped.length) {
    const warn = document.createElement("div");
    warn.className = "warn";
    const lines = out.dropped.map(d =>
      `<li>board ${d.bi + 1} — <strong>${d.label}</strong> (${d.type})</li>`).join("");
    warn.innerHTML =
      `⚠ Budget too low for everything you marked. Dropped ${out.dropped.length} required node(s) ` +
      `(lowest priority first: magic → rare → socket → legendary):<ul>${lines}</ul>` +
      `Raise <em>Total paragon points</em> above ${out.pointBudget || "the current budget"} or unmark some nodes manually.`;
    result.appendChild(warn);
  } else if (out.missingRequired) {
    const warn = document.createElement("div");
    warn.className = "warn";
    warn.textContent = `⚠ ${out.missingRequired} required node(s) could not be routed — raise budget or check connectivity.`;
    result.appendChild(warn);
  }
  if (out.overBudget) {
    const err = document.createElement("div");
    err.className = "warn warn-strong";
    err.textContent = `⛔ ${out.totalPoints} cells needed but only ${out.pointBudget} paragon points available — the minimum chain alone exceeds the budget.`;
    result.appendChild(err);
  }

  const state = getState();
  const orderLine = document.createElement("div");
  orderLine.innerHTML = "<strong>Order:</strong> " +
    out.order.map((bi, i) => `${i + 1}. ${state.boards[bi]?.name ?? "?"} (rot ${(out.rotations[i] || 0) * 90}°)`).join(" → ");
  result.appendChild(orderLine);

  result.appendChild(buildSummary(out));

  const apply = document.createElement("button");
  apply.textContent = "Apply rotations + order to chain";
  apply.onclick = () => {
    setState(st => {
      const chain = out.order.map((bi, i) => {
        // Find the slot in current state matching this board+rotation pairing.
        // We keep the slot's filters/pinnedGlyph/selectedNodes from the prior slot
        // at position `i` (so user-set per-slot settings stick to their slot index).
        const prior = st.chain[i] || { filters: {}, selectedNodes: {}, pinnedGlyph: null };
        return {
          ...prior,
          boardIndex: bi,
          rotation: out.rotations[i] ?? 0,
        };
      });
      return { ...st, chain };
    });
    alert("Rotations and order applied. Open Library/Boards tab to inspect.");
  };
  result.appendChild(apply);

  // mini-render each rotated board with activations
  for (let bi = 0; bi < out.ctx.chain.length; bi++) {
    const boardIdx = out.order[bi] ?? out.ctx.chain[bi].boardIndex;
    const baseBoard = state.boards[boardIdx];
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
  $("#opt-minpoints").checked = !!s.minimizePoints;
  if ($("#opt-algorithm")) $("#opt-algorithm").value = s.algorithm || "steiner";

  const algoEl = $("#opt-algorithm");
  if (algoEl) {
    const reflectMode = () => {
      const mode = algoEl.value;
      document.body.dataset.algo = mode;
      const hint = $("#opt-mode-hint");
      if (hint) {
        hint.textContent = mode === "sa"
          ? "SA explores routes via simulated annealing to maximize your damage formula within the budget. Configure stat weights in the Damage Formula tab."
          : "Steiner picks the minimum cells that include every required node you marked. Budget caps the route — extras are dropped in order magic → rare → socket → legendary.";
      }
    };
    algoEl.addEventListener("change", reflectMode);
    reflectMode();
  }
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
