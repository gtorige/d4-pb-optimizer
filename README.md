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

## Library (v2)

The **Library** tab bundles datamined paragon-board layouts and glyphs for
all five base classes (Barbarian, Druid, Necromancer, Rogue, Sorcerer):

- Pick a class, then click `+ Add to chain` on any board (up to 5) to assemble
  your route.
- Pick glyphs from the same tab to make them available to the optimizer.
- Each chain slot exposes:
  - **Rotation** — 0° / 90° / 180° / 270° picker to manually pin a rotation.
  - **Filters** — independent Magic / Rare / Legendary checkboxes that exclude
    those node types from this slot.

In the **Boards** tab, click any individual node to see its Lothrik node id, its
default stat key (e.g. `magic_DamagePhysical`), and toggle **Block in optimizer**
to exclude that specific cell (overrides the global filter).

In the **Optimize** tab, enable **Try rotations** to let the SA solver also
search over 0/90/180/270° rotations of each board. The solver remaps existing
activations through the rotation, so progress isn't lost when it rotates a slot.
The optimizer reports the best rotations alongside the score, and the
*Apply rotations to chain* button persists them.

### Data source

Bundled paragon data is sourced from
[Lothrik/diablo4-build-calc](https://github.com/Lothrik/diablo4-build-calc).
Localization is stripped to keep the bundle around 290 KB; only English text
is retained.

**The bundled dataset predates Vessel of Hatred and Lord of Hatred**, so it does
not include Spiritborn, Paladin, or Warlock, and base-class boards may be out of
date for Season 13. Use the Library tab's *Load dataset…* button to load a
current JSON file.

### Dataset schema

The loader expects a JSON object keyed by class name (with an optional `Generic`
entry holding shared node definitions). Each class entry looks like:

```json
{
  "Barbarian": {
    "boards": {
      "Start":    [["", "Generic_Gate", ""], ... 21×21 grid of node-id strings],
      "Hemorrhage": [...]
    },
    "nodes": {
      "Barbarian_Legendary_001": { "name": "Crimson Violence", "desc": "..." }
    },
    "glyphs": {
      "ParagonGlyph_011": { "name": "Imbiber", "desc": "...", "bonus": "...", "threshold": "25 Willpower" }
    }
  },
  "Generic": { "nodes": { ... }, "glyphs": {}, "boards": {} }
}
```

Node-id strings encode tier + type via convention:
`<scope>_<tier>_<suffix>` where `tier` is one of
`Normal | Magic | Rare | Legendary | Gate | Socket`. The optimizer's stat keys
are derived from `<tier>_<suffix>`. The starter cell uses any id beginning with
`StartNode`.

## Limitations

- Gate directions are not strictly matched between boards (any activated gate
  on board N + any activated gate on board N+1 still chains).
- Each library node contributes 1 unit of its stat key (5 for normal-attribute
  nodes). Real D4 percent values vary; tune via bucket weights in the
  **Damage Formula** tab.
- Glyph scaling is collapsed to a single `glyph_<id>` stat key — the actual
  per-rank curve isn't modelled.
- Legendary node active effects are exposed as a single `legendary_<id>`
  stat key — model the effect by giving it a bucket weight.
