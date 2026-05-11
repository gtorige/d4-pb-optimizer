# d4-pb-optimizer

A browser-based Paragon-board route optimizer for Diablo 4. Define your boards,
glyphs, and damage formula, then run a simulated-annealing solver that finds a
high-score allocation of paragon points across a 5-board chain (with glyph
placement).

**No build step.** It's plain HTML + ES modules and runs directly from GitHub Pages.

## Run it

### GitHub Pages

1. Push this repo.
2. In **Settings → Pages**, set **Source = Deploy from a branch**, **Branch =
   main** (or whichever branch you publish), **Folder = /**.
3. Open `https://<user>.github.io/d4-pb-optimizer/`.

The `.nojekyll` file is included so Pages serves the `js/` folder as-is.

### Locally

Open `index.html` in any modern browser. Because it uses ES modules you may
need to serve from a local web server:

```
python3 -m http.server 8000
# then open http://localhost:8000
```

## How it works

1. **Boards tab** — paint a board grid. Cell types:
   - **Start** (one per board, only required on the first board in the chain).
   - **Normal / Magic / Rare / Legendary** — activatable nodes. Costs 1 point each.
   - **Glyph socket** — a magic socket that can host a glyph.
   - **Gate** — connects to the next board in the chain. The solver requires at
     least one activated gate per board to chain through.
   - Click a node to assign per-node stats (e.g. `crit_dmg: 2`).
   - Shift-click or right-click to erase.

2. **Glyphs tab** — define glyphs. Each glyph has two stat blocks:
   - **Base stats** applied when the glyph is placed.
   - **Per-magic-node stats** multiplied by the number of activated magic
     nodes within the glyph's radius (Chebyshev distance, configurable).

3. **Damage Formula tab** — define buckets. Each bucket has:
   - A **mode**: `add` (stats in the bucket sum, then `final *= (1+sum)`) or
     `mult` (each contributor multiplies: `final *= prod (1 + w*stat)`).
   - **Stat weights** — a map of stat names to weights. Stat names must match
     those used on nodes and glyphs.
   - Final score = `base × ∏ buckets`.

4. **Optimize tab** — set point budget, glyph radius, SA iterations, and run.
   The solver:
   - Maintains a connected route per board (starting from the start cell on
     board 1, or any activated gate on boards 2-5).
   - Proposes add / remove / swap moves on routes and glyph (re)placement.
   - Accepts improving moves; accepts worsening moves with `exp(Δ / (T·score))`.
   - Outputs the best solution and renders mini-board previews.

5. **Save / Load tab** — export/import all state as JSON; all data otherwise
   lives in `localStorage`.

## Limitations (v1)

- Gate directions are not strictly matched between boards.
- The solver does not model rotation / mirroring of boards.
- Legendary node *active effects* must be modeled as raw stats (e.g. a stat
  named `legendary_proc` with a bucket weight).
- No bundled class data; you enter the boards manually.

PRs welcome to bundle real class data, add a damage simulator, or swap the SA
core for a proper ILP / branch-and-bound.
