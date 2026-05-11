# Data refresh

Bundled paragon data is generated from
[DiabloTools/d4data](https://github.com/DiabloTools/d4data). To refresh:

```bash
# 1. Fetch the latest board + glyph JSON dumps to /tmp/d4d/
./fetch-d4data.sh

# 2. Convert into js/paragon-data.js
node build-paragon-data.mjs
```

The output overwrites `../js/paragon-data.js`. Commit the result.

## What's pulled

- `ParagonBoard/Paragon_<Class>_NN.pbd.json` — grid layouts.
- `ParagonGlyph/Rare_NNN_<Stat>_<Pos>.gph.json` — glyph definitions.

`ParagonNode` and `ParagonGlyphAffix` files are intentionally skipped — the
optimizer only needs the node IDs (which are encoded in the board grids) and
each glyph's metadata. Display names are placeholders; resolving them would
require fetching `StringList/` localization data.

## License + attribution

The paragon data ultimately comes from Blizzard's game files via the d4data
project. This project does not redistribute game assets beyond the small JSON
slice required for the optimizer to function.
