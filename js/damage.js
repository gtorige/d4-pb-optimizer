import { getState, setState } from "./state.js";

const $ = (s) => document.querySelector(s);

export function render() {
  const s = getState();
  const host = $("#bucket-list");
  host.innerHTML = "";
  for (const b of s.buckets) host.appendChild(bucketCard(b));
  $("#base-value").value = s.baseValue;
}

function bucketCard(b) {
  const div = document.createElement("div");
  div.className = "bucket-card";
  const name = document.createElement("input"); name.value = b.name;
  name.onchange = () => setState(st => {
    const x = st.buckets.find(x => x.id === b.id); if (x) x.name = name.value; return { ...st };
  });
  const mode = document.createElement("select");
  for (const m of ["add", "mult"]) {
    const o = document.createElement("option"); o.value = m; o.textContent = m === "add" ? "Additive (within bucket sums, then ×)" : "Multiplicative (each contributor multiplies)";
    if (b.mode === m) o.selected = true;
    mode.appendChild(o);
  }
  mode.onchange = () => setState(st => {
    const x = st.buckets.find(x => x.id === b.id); if (x) x.mode = mode.value; return { ...st };
  });
  const rm = document.createElement("button"); rm.textContent = "✕";
  rm.onclick = () => setState(st => ({ ...st, buckets: st.buckets.filter(x => x.id !== b.id) }));
  const head = document.createElement("div");
  head.append("Name: ", name, " Mode: ", mode, " ", rm);
  div.appendChild(head);

  const note = document.createElement("p"); note.className = "hint";
  note.textContent = "Stat weights (final contribution = sum of stat × weight). Stat names must match those used on nodes/glyphs.";
  div.appendChild(note);

  // store weights as object on bucket (extend schema lazily)
  if (!b.weights) b.weights = Object.fromEntries((b.stats || []).map(s => [s, 1]));

  for (const [k, w] of Object.entries(b.weights)) {
    div.appendChild(weightRow(b, k, w));
  }
  const add = document.createElement("button"); add.textContent = "+ stat";
  add.onclick = () => setState(st => {
    const x = st.buckets.find(x => x.id === b.id); if (!x) return st;
    if (!x.weights) x.weights = {};
    let k = "stat", i = 1; while (k in x.weights) k = "stat_" + (++i);
    x.weights[k] = 1;
    return { ...st };
  });
  div.appendChild(add);
  return div;
}

function weightRow(b, k, w) {
  const div = document.createElement("div"); div.className = "stat-row";
  const ni = document.createElement("input"); ni.value = k;
  const vi = document.createElement("input"); vi.type = "number"; vi.step = "any"; vi.value = w;
  const rm = document.createElement("button"); rm.textContent = "✕";
  let prev = k;
  const commit = () => setState(st => {
    const x = st.buckets.find(x => x.id === b.id); if (!x || !x.weights) return st;
    const nk = ni.value.trim(); const nv = parseFloat(vi.value) || 0;
    delete x.weights[prev];
    if (nk) x.weights[nk] = nv;
    prev = nk;
    return { ...st };
  });
  ni.onchange = commit; vi.onchange = commit;
  rm.onclick = () => setState(st => {
    const x = st.buckets.find(x => x.id === b.id); if (x && x.weights) delete x.weights[prev];
    return { ...st };
  });
  div.append(ni, vi, rm);
  return div;
}

export function wireDamageEditor() {
  $("#add-bucket").onclick = () => setState(st => ({
    ...st,
    buckets: [...st.buckets, { id: "b" + Date.now(), name: "New bucket", mode: "add", weights: {} }]
  }));
  $("#base-value").onchange = () => setState(st => ({
    ...st, baseValue: parseFloat($("#base-value").value) || 0
  }));
}

/**
 * Evaluate damage given accumulated stats record.
 * For "add" buckets: final *= (1 + sum_k weights[k]*stats[k])
 * For "mult" buckets: final *= product_k (1 + weights[k]*stats[k])
 * Stats absent from a bucket are ignored.
 */
export function evaluate(stats, buckets, baseValue) {
  let out = baseValue || 1;
  for (const b of buckets) {
    const w = b.weights || {};
    if (b.mode === "add") {
      let s = 0;
      for (const [k, weight] of Object.entries(w)) s += (stats[k] || 0) * weight;
      out *= (1 + s);
    } else {
      for (const [k, weight] of Object.entries(w)) {
        out *= (1 + (stats[k] || 0) * weight);
      }
    }
  }
  return out;
}
