// Board rotation helpers. Quarter-turns clockwise: 0, 1, 2, 3.

/** Rotate a 2D cells grid clockwise by `q` quarter-turns. Returns a new grid. */
export function rotateGrid(cells, q) {
  q = ((q % 4) + 4) % 4;
  if (q === 0) return cells.map(row => row.slice());
  const n = cells.length;
  const out = Array.from({ length: n }, () => Array(n));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      let nr, nc;
      if (q === 1) { nr = c; nc = n - 1 - r; }
      else if (q === 2) { nr = n - 1 - r; nc = n - 1 - c; }
      else { nr = n - 1 - c; nc = r; } // q === 3
      out[nr][nc] = cells[r][c];
    }
  }
  return out;
}

/** Rotate a single (r,c) key string the same way rotateGrid would. */
export function rotateKey(k, q, n) {
  q = ((q % 4) + 4) % 4;
  if (q === 0) return k;
  const [r, c] = k.split(",").map(Number);
  if (q === 1) return (c) + "," + (n - 1 - r);
  if (q === 2) return (n - 1 - r) + "," + (n - 1 - c);
  return (n - 1 - c) + "," + (r);
}

/** Rotate a gate direction. q=1 means rotate the board clockwise; a north-facing gate
 *  becomes east-facing, etc. */
export function rotateGateDir(dir, q) {
  if (!dir) return dir;
  q = ((q % 4) + 4) % 4;
  const order = ["N", "E", "S", "W"];
  const idx = order.indexOf(dir);
  if (idx < 0) return dir;
  return order[(idx + q) % 4];
}

/** Apply rotation to a Board (returns a new Board with rotated cells, no mutation). */
export function rotateBoard(board, q) {
  q = ((q % 4) + 4) % 4;
  if (q === 0) return board;
  const cells = rotateGrid(board.cells, q).map(row =>
    row.map(cell => cell ? {
      ...cell,
      gateDir: cell.gateDir ? rotateGateDir(cell.gateDir, q) : cell.gateDir,
    } : { type: "empty", stats: {} })
  );
  return { ...board, cells };
}
