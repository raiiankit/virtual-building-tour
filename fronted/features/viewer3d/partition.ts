import type { SceneManifest } from "@/types";

export type V2 = [number, number];
export interface PSeg { a: V2; b: V2; exterior: boolean }
export interface PRoom { index: number; type: string; name: string; mat?: string; center: V2; rects: [number, number, number, number][] }
export interface FloorPlan {
  walls: PSeg[];
  /** `stair` marks a doorway on the boundary of a "staircase"/"lift" room — the caller
   *  should NOT build a normal swinging door leaf for these (a leaf hinged the usual way
   *  can swing straight into the open stairwell void / stair treads); just leave the
   *  opening as a plain walkable gap. */
  doorways: { pos: V2; orient: "h" | "v"; stair: boolean }[];
  rooms: PRoom[]; bounds: { x0: number; z0: number; x1: number; z1: number };
  /** Fraction (0..1) of footprint grid cells that weren't inside any declared room and
   *  had to be nearest-room-assigned instead — i.e. how much of the plan is a gap the
   *  input rooms don't actually cover. ~0 for a normal, fully-tiled floor plan. */
  gapFraction: number;
}

/** Partition the building footprint into clean, non-overlapping rooms from the
 *  (possibly overlapping) detected room rectangles. Smaller rooms take priority so
 *  each room's region = its rectangle minus any smaller room's — giving rectilinear
 *  regions with straight shared walls (never diagonal Voronoi jaggies). Also yields
 *  one doorway per adjacent room pair and merged wall runs. */
export function partitionFloor(manifest: SceneManifest, level: number, cell = 0.3): FloorPlan {
  const rooms = (manifest.rooms ?? []).filter((r) => r.level === level)
    .map((r) => ({ cx: r.center[0], cz: r.center[1], w: r.size[0], h: r.size[1], type: r.type, name: r.name, mat: r.floor_material }));
  const pts: V2[] = [];
  for (const w of manifest.walls ?? []) pts.push(w.a as V2, w.b as V2);
  if (!pts.length) for (const r of rooms) pts.push([r.cx - r.w / 2, r.cz - r.h / 2], [r.cx + r.w / 2, r.cz + r.h / 2]);
  const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
  const z0 = Math.min(...pts.map((p) => p[1])), z1 = Math.max(...pts.map((p) => p[1]));
  const nx = Math.max(1, Math.round((x1 - x0) / cell)), nz = Math.max(1, Math.round((z1 - z0) / cell));
  if (!rooms.length) return { walls: [], doorways: [], rooms: [], bounds: { x0, z0, x1, z1 }, gapFraction: 0 };

  const area = (r: typeof rooms[number]) => r.w * r.h;
  const order = rooms.map((_, i) => i).sort((a, b) => area(rooms[a]) - area(rooms[b]));
  const inside = (px: number, pz: number, r: typeof rooms[number]) => Math.abs(px - r.cx) <= r.w / 2 && Math.abs(pz - r.cz) <= r.h / 2;
  const distRect = (px: number, pz: number, r: typeof rooms[number]) => {
    const dx = Math.max(Math.abs(px - r.cx) - r.w / 2, 0), dz = Math.max(Math.abs(pz - r.cz) - r.h / 2, 0);
    return Math.hypot(dx, dz);
  };
  const lab = new Int16Array(nx * nz).fill(-1);
  // Cells genuinely inside a declared room vs. ones only reached via the nearest-room
  // fallback (a "gap" in the input plan) — kept separate so smoothing below only ever
  // touches fallback cells, never a real room's own (already-clean) rectangle edges.
  const isGap = new Uint8Array(nx * nz);
  let gapCount = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const px = x0 + (i + 0.5) * cell, pz = z0 + (j + 0.5) * cell;
    let best = -1;
    for (const r of order) if (inside(px, pz, rooms[r])) { best = r; break; }
    if (best === -1) {
      isGap[i * nz + j] = 1; gapCount++;
      let bd = Infinity; for (let r = 0; r < rooms.length; r++) { const dd = distRect(px, pz, rooms[r]); if (dd < bd) { bd = dd; best = r; } }
    }
    lab[i * nz + j] = best;
  }
  const gapFraction = gapCount / (nx * nz);

  // Gap cells straddling two nearly-equidistant rooms alias into a staircase (each
  // cell independently picks its own nearest room, so the boundary zigzags instead of
  // running straight/diagonal). Smooth ONLY gap cells with a small majority-vote
  // despeckle over their 3x3 neighborhood — real room-owned cells (rectangle edges)
  // are never touched, so ordinary fully-tiled floor plans are completely unaffected.
  if (gapCount > 0) {
    const atRaw = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= nz) ? -1 : lab[i * nz + j];
    for (let pass = 0; pass < 2; pass++) {
      const next = lab.slice();
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const idx = i * nz + j;
        if (!isGap[idx]) continue;
        const counts = new Map<number, number>();
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
          const v = atRaw(i + di, j + dj); if (v < 0) continue;
          counts.set(v, (counts.get(v) ?? 0) + (di === 0 && dj === 0 ? 2 : 1)); // self counts double, a mild bias to stability
        }
        let bestLab = lab[idx], bestCount = -1;
        for (const [v, c] of counts) if (c > bestCount) { bestCount = c; bestLab = v; }
        next[idx] = bestLab;
      }
      lab.set(next);
    }
  }
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= nz) ? -1 : lab[i * nz + j];

  // wall edges between differing labels, grouped by grid line + room pair, merged into runs
  const pairKey = (a: number, b: number) => a < b ? `${a}|${b}` : `${b}|${a}`;
  const vRuns = new Map<string, number[]>(), hRuns = new Map<string, number[]>();
  const push = (m: Map<string, number[]>, k: string, v: number) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  for (let i = 0; i <= nx; i++) for (let j = 0; j < nz; j++) { const l = at(i - 1, j), r = at(i, j); if (l !== r) push(vRuns, `${i}#${pairKey(l, r)}`, j); }
  for (let j = 0; j <= nz; j++) for (let i = 0; i < nx; i++) { const l = at(i, j - 1), r = at(i, j); if (l !== r) push(hRuns, `${j}#${pairKey(l, r)}`, i); }
  const toSegs = (arr: number[]) => { arr.sort((a, b) => a - b); const s: [number, number][] = []; let a = arr[0], p = arr[0]; for (let k = 1; k < arr.length; k++) { if (arr[k] === p + 1) p = arr[k]; else { s.push([a, p]); a = p = arr[k]; } } s.push([a, p]); return s; };

  const walls: PSeg[] = [];
  const doorCand: { pair: string; len: number; pos: V2; orient: "h" | "v" }[] = [];
  for (const [k, arr] of vRuns) {
    const [is, pr] = k.split("#"); const i = +is; const [la, lb] = pr.split("|").map(Number); const x = x0 + i * cell;
    for (const [j0, j1] of toSegs(arr)) {
      const za = z0 + j0 * cell, zb = z0 + (j1 + 1) * cell; const ext = la === -1 || lb === -1;
      walls.push({ a: [x, za], b: [x, zb], exterior: ext });
      if (!ext) doorCand.push({ pair: pr, len: zb - za, pos: [x, (za + zb) / 2], orient: "v" });
    }
  }
  for (const [k, arr] of hRuns) {
    const [js, pr] = k.split("#"); const j = +js; const [la, lb] = pr.split("|").map(Number); const z = z0 + j * cell;
    for (const [i0, i1] of toSegs(arr)) {
      const xa = x0 + i0 * cell, xb = x0 + (i1 + 1) * cell; const ext = la === -1 || lb === -1;
      walls.push({ a: [xa, z], b: [xb, z], exterior: ext });
      if (!ext) doorCand.push({ pair: pr, len: xb - xa, pos: [(xa + xb) / 2, z], orient: "h" });
    }
  }
  const bestByPair = new Map<string, typeof doorCand[number]>();
  for (const dc of doorCand) if (dc.len >= 0.9 && (!bestByPair.has(dc.pair) || dc.len > bestByPair.get(dc.pair)!.len)) bestByPair.set(dc.pair, dc);
  const isStairIdx = (idx: number) => idx >= 0 && (rooms[idx]?.type === "staircase" || rooms[idx]?.type === "lift");
  // one door per pair, and no two doors clustered on the same wall junction (keep the widest)
  const doorways: { pos: V2; orient: "h" | "v"; stair: boolean }[] = [];
  for (const dc of [...bestByPair.values()].sort((a, b) => b.len - a.len)) {
    if (doorways.some((d) => Math.hypot(d.pos[0] - dc.pos[0], d.pos[1] - dc.pos[1]) < 1.2)) continue;
    const [la, lb] = dc.pair.split("|").map(Number);
    doorways.push({ pos: dc.pos, orient: dc.orient, stair: isStairIdx(la) || isStairIdx(lb) });
  }

  // per-room floor rectangles: horizontal runs merged vertically where identical
  const outRooms: PRoom[] = rooms.map((r, idx) => {
    const rects: [number, number, number, number][] = [];
    let active: { i0: number; i1: number; j0: number }[] = [];
    for (let j = 0; j < nz; j++) {
      const runs: [number, number][] = []; let s = -1;
      for (let i = 0; i < nx; i++) { const is = lab[i * nz + j] === idx; if (is && s < 0) s = i; else if (!is && s >= 0) { runs.push([s, i - 1]); s = -1; } }
      if (s >= 0) runs.push([s, nx - 1]);
      const used = new Array(active.length).fill(false); const next: typeof active = [];
      for (const [i0, i1] of runs) { const ai = active.findIndex((a, k) => !used[k] && a.i0 === i0 && a.i1 === i1); if (ai >= 0) { used[ai] = true; next.push(active[ai]); } else next.push({ i0, i1, j0: j }); }
      active.forEach((a, k) => { if (!used[k]) rects.push([x0 + a.i0 * cell, z0 + a.j0 * cell, x0 + (a.i1 + 1) * cell, z0 + j * cell]); });
      active = next;
    }
    active.forEach((a) => rects.push([x0 + a.i0 * cell, z0 + a.j0 * cell, x0 + (a.i1 + 1) * cell, z0 + nz * cell]));
    return { index: idx, type: r.type, name: r.name, mat: r.mat, center: [r.cx, r.cz] as V2, rects };
  });

  return { walls: simplifyStaircases(walls, cell), doorways, rooms: outRooms, bounds: { x0, z0, x1, z1 }, gapFraction };
}

/** Collapse a "staircase" — a chain of 3+ short, alternating-orientation wall segments
 *  (the classic grid-rasterization artifact of a genuinely diagonal nearest-room
 *  boundary between two rooms that don't share a straight edge, e.g. either side of
 *  an input gap the declared rooms don't cover) — into ONE clean diagonal wall
 *  segment from the chain's start to its end. A single diagonal wall reads as an
 *  ordinary chamfered/cut corner, which is normal architecture, instead of a jagged
 *  flight of steps. Deliberately conservative: only touches segments short enough to
 *  be step-sized (not a real small room's own wall run) that chain into a simple
 *  (non-branching) path of at least 3 links — anything else is left untouched. */
function simplifyStaircases(walls: PSeg[], cell: number): PSeg[] {
  const maxStep = cell * 1.6;
  const len = (w: PSeg) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const shortIdx: number[] = [];
  walls.forEach((w, i) => { if (len(w) > 1e-6 && len(w) <= maxStep) shortIdx.push(i); });
  if (shortIdx.length < 3) return walls;

  const eps = 0.02;
  const close = (p: V2, q: V2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < eps;
  const parent = shortIdx.map((_, k) => k);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let a = 0; a < shortIdx.length; a++) for (let b = a + 1; b < shortIdx.length; b++) {
    const wa = walls[shortIdx[a]], wb = walls[shortIdx[b]];
    if (close(wa.a, wb.a) || close(wa.a, wb.b) || close(wa.b, wb.a) || close(wa.b, wb.b)) union(a, b);
  }
  const groups = new Map<number, number[]>();
  shortIdx.forEach((_, k) => { const r = find(k); const g = groups.get(r); if (g) g.push(k); else groups.set(r, [k]); });

  const toRemove = new Set<number>();
  const extra: PSeg[] = [];
  const pk = (p: V2) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  for (const ks of groups.values()) {
    if (ks.length < 3) continue; // an isolated short wall (e.g. a small room's own edge) — not a staircase, leave it
    const segIdxs = ks.map((k) => shortIdx[k]);
    const endpointCount = new Map<string, number>(), endpointPos = new Map<string, V2>();
    for (const si of segIdxs) for (const p of [walls[si].a, walls[si].b]) {
      const key = pk(p); endpointCount.set(key, (endpointCount.get(key) ?? 0) + 1); endpointPos.set(key, p);
    }
    const ends = [...endpointCount.entries()].filter(([, c]) => c === 1).map(([k]) => endpointPos.get(k)!);
    if (ends.length !== 2) continue; // branching/loop, not a simple chain — be conservative, leave untouched
    const extCount = segIdxs.filter((si) => walls[si].exterior).length;
    extra.push({ a: ends[0], b: ends[1], exterior: extCount > segIdxs.length / 2 });
    segIdxs.forEach((si) => toRemove.add(si));
  }
  if (!extra.length) return walls;
  return walls.filter((_, i) => !toRemove.has(i)).concat(extra);
}

/** Merge collinear wall segments (same line + exterior flag) into long runs so an
 *  opening spanning several partition cells cuts one clean gap. */
export function mergeColinear(segs: PSeg[]): PSeg[] {
  const groups = new Map<string, PSeg[]>();
  for (const s of segs) {
    const vert = Math.abs(s.a[0] - s.b[0]) < 1e-6;
    const line = vert ? s.a[0] : s.a[1];
    const k = `${vert ? "V" : "H"}:${line.toFixed(3)}:${s.exterior ? 1 : 0}`;
    const g = groups.get(k); if (g) g.push(s); else groups.set(k, [s]);
  }
  const out: PSeg[] = [];
  for (const [k, g] of groups) {
    const vert = k[0] === "V"; const line = vert ? g[0].a[0] : g[0].a[1]; const ext = g[0].exterior;
    const iv = g.map((s) => { const a = vert ? s.a[1] : s.a[0], b = vert ? s.b[1] : s.b[0]; return [Math.min(a, b), Math.max(a, b)] as [number, number]; }).sort((p, q) => p[0] - q[0]);
    let [cs, ce] = iv[0];
    for (let i = 1; i < iv.length; i++) { const [s, e] = iv[i]; if (s <= ce + 1e-6) ce = Math.max(ce, e); else { out.push(vert ? { a: [line, cs], b: [line, ce], exterior: ext } : { a: [cs, line], b: [ce, line], exterior: ext }); cs = s; ce = e; } }
    out.push(vert ? { a: [line, cs], b: [line, ce], exterior: ext } : { a: [cs, line], b: [ce, line], exterior: ext });
  }
  return out;
}
