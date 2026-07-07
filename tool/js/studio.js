// SMSVJ Tile Studio: compose a scene source by hand-placing 8x8 tiles ripped from a
// ROM or quantised from an image. Exports a .svjt (mode + palette + indexed pixels)
// that the look-patcher imports into a tileset. Reuses color/tiles/fold/render.
(function () {
  const C = SVJ.color, T = SVJ.tiles, F = SVJ.fold, R = SVJ.render;
  const $ = (id) => document.getElementById(id);
  const blankTile = () => Array.from({ length: 8 }, () => new Array(8).fill(0));

  // ---- state ----
  const SRC = { tiles: [], cols: 16 };          // source tile sheet (flat, `cols` wide)
  const ROM = { buf: null, off: 0, palGG: false };
  let pal = greyRamp();                          // 32-entry CRAM (bank1 mirrors bank0)
  let brush = { w: 1, h: 1, tiles: [[blankTile()]] };
  let brushFlip = 0;                             // bit0 = H, bit1 = V
  let editSlot = 1;                              // palette entry being edited
  const TGT = { mode: "quarter", tilesW: 16, tilesH: 12, pixels: null };

  function greyRamp() {
    const p = new Uint8Array(32);
    for (let i = 0; i < 16; i++) { const q = Math.min(3, Math.round((i / 15) * 3)); const v = (q << 4) | (q << 2) | q; p[i] = v; p[16 + i] = v; }
    return p;
  }
  function newTarget(mode) {
    const g = F.geometry(mode);
    TGT.mode = mode; TGT.tilesW = g.tilesW; TGT.tilesH = g.tilesH;
    TGT.pixels = [];
    for (let y = 0; y < g.pxH; y++) TGT.pixels.push(new Array(g.pxW).fill(0));
    $("tgtInfo").textContent = `${g.tilesW}×${g.tilesH} tiles`;
  }
  function setStatus(m, cls) { const e = $("status"); e.textContent = m; e.className = "status" + (cls ? " " + cls : ""); }

  // ---- undo/redo history (compose target) ----
  const HISTORY_MAX = 40;
  let past = [], future = [];
  const clonePixels = (p) => p.map((r) => r.slice());
  function updateHistBtns() { $("undo").disabled = !past.length; $("redo").disabled = !future.length; }
  function pushHistory() { past.push(clonePixels(TGT.pixels)); if (past.length > HISTORY_MAX) past.shift(); future = []; updateHistBtns(); }
  function resetHistory() { past = []; future = []; updateHistBtns(); }
  function undo() { if (!past.length) return; future.push(clonePixels(TGT.pixels)); TGT.pixels = past.pop(); tgtSel = null; renderTarget(); renderPreview(); updateHistBtns(); }
  function redo() { if (!future.length) return; past.push(clonePixels(TGT.pixels)); TGT.pixels = future.pop(); tgtSel = null; renderTarget(); renderPreview(); updateHistBtns(); }

  // ---- source sheet ----
  const srcSheet = $("srcSheet"), sctx = srcSheet.getContext("2d");
  function renderSrc() {
    const n = SRC.tiles.length, cols = SRC.cols, rows = Math.max(1, Math.ceil(n / cols));
    srcSheet.width = cols * 8; srcSheet.height = rows * 8;
    const img = sctx.createImageData(srcSheet.width, srcSheet.height);
    for (let k = 0; k < n; k++) {
      const t = SRC.tiles[k], ox = (k % cols) * 8, oy = ((k / cols) | 0) * 8;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const col = C.toRGB(pal[t[r][c] & 15] || 0);
        const p = ((oy + r) * srcSheet.width + (ox + c)) * 4;
        img.data[p] = col.r; img.data[p + 1] = col.g; img.data[p + 2] = col.b; img.data[p + 3] = 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    if (srcSel) { sctx.strokeStyle = "#57e0c8"; sctx.strokeRect(srcSel.x * 8 + 0.5, srcSel.y * 8 + 0.5, srcSel.w * 8 - 1, srcSel.h * 8 - 1); }
  }
  let srcSel = null, srcDrag = null;
  function srcTileAt(ev) {
    const rect = srcSheet.getBoundingClientRect();
    const cols = SRC.cols, rows = Math.max(1, Math.ceil(SRC.tiles.length / cols));
    return {
      x: Math.max(0, Math.min(cols - 1, (((ev.clientX - rect.left) / rect.width) * cols) | 0)),
      y: Math.max(0, Math.min(rows - 1, (((ev.clientY - rect.top) / rect.height) * rows) | 0)),
    };
  }
  function updateBrushInfo(origin) {
    const fl = brushFlip ? " (flip " + (brushFlip & 1 ? "H" : "") + (brushFlip & 2 ? "V" : "") + ")" : "";
    $("brushInfo").textContent = `brush ${brush.w}×${brush.h}${fl}${origin ? " from " + origin : ""}`;
  }
  function setBrush(sel) {
    const tiles = [];
    for (let j = 0; j < sel.h; j++) {
      const row = [];
      for (let i = 0; i < sel.w; i++) { const idx = (sel.y + j) * SRC.cols + (sel.x + i); row.push(SRC.tiles[idx] || blankTile()); }
      tiles.push(row);
    }
    brush = { w: sel.w, h: sel.h, tiles };
    updateBrushInfo();
  }
  // Capture a rectangular block of the composed target as the brush (clones tiles).
  function captureTarget(sel) {
    const tiles = [];
    for (let j = 0; j < sel.h; j++) {
      const row = [];
      for (let i = 0; i < sel.w; i++) {
        const cx = sel.x + i, cy = sel.y + j, t = blankTile();
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) t[r][c] = TGT.pixels[cy * 8 + r][cx * 8 + c] & 15;
        row.push(t);
      }
      tiles.push(row);
    }
    brush = { w: sel.w, h: sel.h, tiles };
    updateBrushInfo("compose");
  }
  srcSheet.addEventListener("mousedown", (e) => { if (!SRC.tiles.length) return; srcDrag = srcTileAt(e); srcSel = { x: srcDrag.x, y: srcDrag.y, w: 1, h: 1 }; renderSrc(); });
  srcSheet.addEventListener("mousemove", (e) => {
    if (!srcDrag) return; const t = srcTileAt(e);
    srcSel = { x: Math.min(srcDrag.x, t.x), y: Math.min(srcDrag.y, t.y), w: Math.abs(t.x - srcDrag.x) + 1, h: Math.abs(t.y - srcDrag.y) + 1 };
    renderSrc();
  });
  window.addEventListener("mouseup", () => { if (srcDrag && srcSel) setBrush(srcSel); srcDrag = null; });

  // ---- ROM source ----
  function romSheetTiles() {
    const out = [];
    for (let i = 0; i < 256; i++) out.push(T.decode(ROM.buf, ROM.off + i * 32));
    SRC.tiles = out; SRC.cols = 16; renderSrc();
  }
  function loadRom(file) {
    const rd = new FileReader();
    rd.onload = () => {
      ROM.buf = new Uint8Array(rd.result); ROM.off = 0;
      $("romOff").max = Math.max(0, ROM.buf.length - 256 * 32); $("romOff").value = 0; $("romOff").disabled = false;
      $("vRomOff").textContent = "0x0"; $("romGrabPal").disabled = false;
      ROM.palGG = /\.gg$/i.test(file.name); $("romPalGG").checked = ROM.palGG;
      $("romInfo").textContent = `${file.name} · ${(ROM.buf.length / 1024) | 0} KB`;
      romSheetTiles();
    };
    rd.readAsArrayBuffer(file);
  }
  function decodePalAt(off) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      if (ROM.palGG) { const v = (ROM.buf[off + i * 2] || 0) | ((ROM.buf[off + i * 2 + 1] || 0) << 8); out[i] = (((v >> 8) & 0xf) >> 2 << 4) | (((v >> 4) & 0xf) >> 2 << 2) | ((v & 0xf) >> 2); }
      else out[i] = (ROM.buf[off + i] || 0) & 0x3f;
    }
    return out;
  }
  $("romFile").onchange = (e) => e.target.files[0] && loadRom(e.target.files[0]);
  $("romOff").oninput = (e) => { ROM.off = parseInt(e.target.value, 10) & ~31; $("vRomOff").textContent = "0x" + ROM.off.toString(16); romSheetTiles(); };
  $("romGrabPal").onclick = () => { pal = decodePalAt(ROM.off); afterPalChange(); setStatus(`palette ← ROM @ 0x${ROM.off.toString(16)}`, "ok"); };
  $("romPalGG").onchange = (e) => { ROM.palGG = e.target.checked; };

  // ---- image source ----
  let imgEl = null;
  function quantise(data, w, h, k) {
    const hist = new Map(), cram = new Int16Array(w * h);
    for (let i = 0; i < w * h; i++) { const c = C.fromRGB(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]); cram[i] = c; hist.set(c, (hist.get(c) || 0) + 1); }
    const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map((e) => e[0]);
    while (top.length < 16) top.push(top.length ? top[top.length - 1] : 0);
    const trgb = top.map((c) => C.toRGB(c));
    const p = new Uint8Array(32);
    for (let i = 0; i < 16; i++) { p[i] = top[i]; p[16 + i] = top[i]; }
    const px = [];
    for (let y = 0; y < h; y++) {
      const row = new Array(w);
      for (let x = 0; x < w; x++) {
        const rc = C.toRGB(cram[y * w + x]); let best = 0, bd = Infinity;
        for (let q = 0; q < 16; q++) { const t = trgb[q]; const d = (t.r - rc.r) ** 2 + (t.g - rc.g) ** 2 + (t.b - rc.b) ** 2; if (d < bd) { bd = d; best = q; } }
        row[x] = best;
      }
      px.push(row);
    }
    return { pal: p, pixels: px };
  }
  function tilesFromPixels(px, tw, th) {
    const out = [];
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      const t = [];
      for (let r = 0; r < 8; r++) { const row = []; for (let c = 0; c < 8; c++) row.push(px[ty * 8 + r][tx * 8 + c] & 15); t.push(row); }
      out.push(t);
    }
    return out;
  }
  function processImage() {
    if (!imgEl) return;
    const tw = Math.max(1, Math.min(32, parseInt($("imgTilesW").value, 10) || 16));
    const th = Math.max(1, Math.min(32, Math.round((imgEl.naturalHeight / imgEl.naturalWidth) * tw)));
    const w = tw * 8, h = th * 8;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d"); cx.drawImage(imgEl, 0, 0, w, h);
    const q = quantise(cx.getImageData(0, 0, w, h).data, w, h, Math.max(2, Math.min(16, parseInt($("imgColors").value, 10) || 16)));
    pal = q.pal; afterPalChange();
    SRC.tiles = tilesFromPixels(q.pixels, tw, th); SRC.cols = tw; renderSrc();
    $("imgInfo").textContent = `${tw}×${th} tiles`;
    $("imgRequant").disabled = false;
    setStatus("image quantised", "ok");
  }
  function loadImage(file) {
    const url = URL.createObjectURL(file);
    imgEl = new Image();
    imgEl.onload = () => { URL.revokeObjectURL(url); processImage(); };
    imgEl.src = url;
  }
  $("imgFile").onchange = (e) => e.target.files[0] && loadImage(e.target.files[0]);
  $("imgRequant").onclick = processImage;

  // ---- compose target ----
  const tgt = $("tgtCanvas"), tctx = tgt.getContext("2d");
  const tgtScale = () => (TGT.mode === "quarter" ? 4 : 2);
  function renderTarget() {
    const g = F.geometry(TGT.mode), s = tgtScale();
    tgt.width = g.pxW * s; tgt.height = g.pxH * s;
    for (let y = 0; y < g.pxH; y++) for (let x = 0; x < g.pxW; x++) {
      const col = C.toRGB(pal[TGT.pixels[y][x] & 15] || 0);
      tctx.fillStyle = `rgb(${col.r},${col.g},${col.b})`;
      tctx.fillRect(x * s, y * s, s, s);
    }
    tctx.strokeStyle = "rgba(255,255,255,0.08)"; tctx.lineWidth = 1;
    for (let tx = 0; tx <= g.tilesW; tx++) { tctx.beginPath(); tctx.moveTo(tx * 8 * s, 0); tctx.lineTo(tx * 8 * s, g.pxH * s); tctx.stroke(); }
    for (let ty = 0; ty <= g.tilesH; ty++) { tctx.beginPath(); tctx.moveTo(0, ty * 8 * s); tctx.lineTo(g.pxW * s, ty * 8 * s); tctx.stroke(); }
    if (tgtSel) {
      tctx.strokeStyle = "#ff6ac1"; tctx.lineWidth = 2;
      tctx.strokeRect(tgtSel.x * 8 * s + 1, tgtSel.y * 8 * s + 1, tgtSel.w * 8 * s - 2, tgtSel.h * 8 * s - 2);
    }
  }
  function tgtCellAt(ev) {
    const rect = tgt.getBoundingClientRect();
    return {
      tx: Math.max(0, Math.min(TGT.tilesW - 1, (((ev.clientX - rect.left) / rect.width) * TGT.tilesW) | 0)),
      ty: Math.max(0, Math.min(TGT.tilesH - 1, (((ev.clientY - rect.top) / rect.height) * TGT.tilesH) | 0)),
    };
  }
  function writeTileAt(cx, cy, tile) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) TGT.pixels[cy * 8 + r][cx * 8 + c] = tile[r][c] & 15;
  }
  function tileKeyAt(cx, cy) {
    let s = ""; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) s += (TGT.pixels[cy * 8 + r][cx * 8 + c] & 15).toString(16);
    return s;
  }
  // The brush tile that belongs at absolute cell (cx,cy) when tiling the brush across
  // the frame — auto-tessellation wraps the brush in both X and Y.
  function brushTileFor(cx, cy) {
    if ($("eraser").checked) return blankTile();
    const i = ((cx % brush.w) + brush.w) % brush.w, j = ((cy % brush.h) + brush.h) % brush.h;
    const si = (brushFlip & 1) ? brush.w - 1 - i : i, sj = (brushFlip & 2) ? brush.h - 1 - j : j;
    return T.applyFlip(brush.tiles[sj][si], brushFlip);
  }
  function stampAt(tx, ty) {
    const erase = $("eraser").checked;
    for (let j = 0; j < brush.h; j++) for (let i = 0; i < brush.w; i++) {
      const si = (brushFlip & 1) ? brush.w - 1 - i : i, sj = (brushFlip & 2) ? brush.h - 1 - j : j;
      const tile = erase ? blankTile() : T.applyFlip(brush.tiles[sj][si], brushFlip);
      const cx = tx + i, cy = ty + j;
      if (cx < 0 || cy < 0 || cx >= TGT.tilesW || cy >= TGT.tilesH) continue;
      writeTileAt(cx, cy, tile);
    }
    renderTarget(); renderPreview();
  }
  // Auto-tessellate the brush across the whole frame (both axes).
  function fillAll() {
    pushHistory();
    for (let cy = 0; cy < TGT.tilesH; cy++) for (let cx = 0; cx < TGT.tilesW; cx++) writeTileAt(cx, cy, brushTileFor(cx, cy));
    renderTarget(); renderPreview();
  }
  // Flood-fill the contiguous region of cells matching the clicked tile, tessellating
  // the brush into it (anchored to the grid so a group brush keeps its phase).
  function floodFill(sx, sy) {
    const seed = tileKeyAt(sx, sy), seen = new Set(), stack = [[sx, sy]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= TGT.tilesW || cy >= TGT.tilesH) continue;
      const k = cx + "," + cy;
      if (seen.has(k) || tileKeyAt(cx, cy) !== seed) continue;
      seen.add(k);
      writeTileAt(cx, cy, brushTileFor(cx, cy));
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    renderTarget(); renderPreview();
  }
  // ---- tile ops on stamped content (selection, or whole frame) ----
  // Baked into pixels, since Mode 4 can't rotate/invert on-console.
  function afterEdit() { renderTarget(); renderPreview(); }
  const opRegion = () => tgtSel || { x: 0, y: 0, w: TGT.tilesW, h: TGT.tilesH };
  function invertRegion() {
    pushHistory();
    const s = opRegion();
    for (let r = 0; r < s.h * 8; r++) for (let c = 0; c < s.w * 8; c++) {
      const y = s.y * 8 + r, x = s.x * 8 + c; TGT.pixels[y][x] = 15 - (TGT.pixels[y][x] & 15);
    }
    afterEdit();
  }
  function mirrorHRegion() {
    pushHistory();
    const s = opRegion(), W = s.w * 8;
    for (let r = 0; r < s.h * 8; r++) { const y = s.y * 8 + r;
      for (let c = 0; c < W >> 1; c++) { const a = s.x * 8 + c, b = s.x * 8 + W - 1 - c; const t = TGT.pixels[y][a]; TGT.pixels[y][a] = TGT.pixels[y][b]; TGT.pixels[y][b] = t; } }
    afterEdit();
  }
  function mirrorVRegion() {
    pushHistory();
    const s = opRegion(), H = s.h * 8;
    for (let c = 0; c < s.w * 8; c++) { const x = s.x * 8 + c;
      for (let r = 0; r < H >> 1; r++) { const a = s.y * 8 + r, b = s.y * 8 + H - 1 - r; const t = TGT.pixels[a][x]; TGT.pixels[a][x] = TGT.pixels[b][x]; TGT.pixels[b][x] = t; } }
    afterEdit();
  }
  // Rotate the selected block 90 CW in place (dims swap, re-anchored top-left, clipped
  // to the frame). Square selections rotate losslessly.
  function rotateRegion() {
    if (!tgtSel) { setStatus("select a block to rotate", "err"); return; }
    pushHistory();
    const s = tgtSel, W = s.w * 8, H = s.h * 8;
    const src = [];
    for (let r = 0; r < H; r++) { const row = []; for (let c = 0; c < W; c++) row.push(TGT.pixels[s.y * 8 + r][s.x * 8 + c] & 15); src.push(row); }
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) TGT.pixels[s.y * 8 + r][s.x * 8 + c] = 0; // clear original
    const nH = W, nW = H;                                  // rotated pixel dims
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const y = s.y * 8 + c, x = s.x * 8 + (H - 1 - r);    // out[c][H-1-r] = src[r][c]
      if (y < TGT.tilesH * 8 && x < TGT.tilesW * 8) TGT.pixels[y][x] = src[r][c];
    }
    tgtSel = { x: s.x, y: s.y, w: Math.min(s.h, TGT.tilesW - s.x), h: Math.min(s.w, TGT.tilesH - s.y) };
    captureTarget(tgtSel);
    afterEdit();
  }
  $("opRotate").onclick = rotateRegion;
  $("opMirrorH").onclick = mirrorHRegion;
  $("opMirrorV").onclick = mirrorVRegion;
  $("opInvert").onclick = invertRegion;

  let tgtPaint = false, tgtSel = null, tgtSelDrag = null;
  tgt.addEventListener("mousedown", (e) => {
    const c = tgtCellAt(e);
    if ($("selectMode").checked) { tgtSelDrag = c; tgtSel = { x: c.tx, y: c.ty, w: 1, h: 1 }; renderTarget(); return; }
    pushHistory();
    if ($("bucket").checked) { floodFill(c.tx, c.ty); return; }
    tgtSel = null; tgtPaint = true; stampAt(c.tx, c.ty);
  });
  tgt.addEventListener("mousemove", (e) => {
    const c = tgtCellAt(e);
    if (tgtSelDrag) {
      tgtSel = { x: Math.min(tgtSelDrag.tx, c.tx), y: Math.min(tgtSelDrag.ty, c.ty),
        w: Math.abs(c.tx - tgtSelDrag.tx) + 1, h: Math.abs(c.ty - tgtSelDrag.ty) + 1 };
      renderTarget(); return;
    }
    if (tgtPaint) stampAt(c.tx, c.ty);
  });
  window.addEventListener("mouseup", () => {
    if (tgtSelDrag && tgtSel) captureTarget(tgtSel);
    tgtSelDrag = null; tgtPaint = false;
  });
  $("fillAll").onclick = fillAll;

  // ---- folded preview ----
  const pv = $("pvCanvas"), pctx = pv.getContext("2d"), pvImg = pctx.createImageData(R.W, R.H);
  function renderPreview() {
    const b = F.bake(TGT.pixels, TGT.mode, [0], { bank: 0, priority: 0 });
    R.renderLayout(pvImg, b.layouts[0], b.tiles, pal, null, null);
    pctx.putImageData(pvImg, 0, 0);
  }

  // ---- solid (macro) brush: a single 8x8 tile of one palette index ----
  function solidTile(i) { return Array.from({ length: 8 }, () => new Array(8).fill(i & 15)); }
  function buildSolidStrip() {
    const host = $("solidStrip"); host.innerHTML = "";
    for (let i = 0; i < 16; i++) {
      const el = document.createElement("i");
      el.style.background = C.toHex(pal[i]); el.title = "solid index " + i;
      el.onclick = () => { brushFlip = 0; $("flipH").classList.remove("on"); $("flipV").classList.remove("on"); brush = { w: 1, h: 1, tiles: [[solidTile(i)]] }; updateBrushInfo("solid " + i); };
      host.appendChild(el);
    }
  }

  // ---- palette editor ----
  function afterPalChange() { buildPalStrip(); buildSolidStrip(); renderSrc(); renderTarget(); renderPreview(); }
  function buildPalStrip() {
    const host = $("palStrip"); host.innerHTML = "";
    for (let i = 0; i < 16; i++) {
      const el = document.createElement("i");
      el.style.background = C.toHex(pal[i]); if (i === editSlot) el.className = "sel";
      el.title = "entry " + i; el.onclick = () => { editSlot = i; buildPalStrip(); };
      host.appendChild(el);
    }
  }
  function buildGamut() {
    const host = $("gamut"); host.innerHTML = "";
    for (let c = 0; c < 64; c++) {
      const el = document.createElement("i");
      el.style.background = C.toHex(c); el.title = "0x" + c.toString(16);
      el.onclick = () => { pal[editSlot] = c; pal[16 + editSlot] = c; afterPalChange(); };
      host.appendChild(el);
    }
  }

  // ---- tabs / flips / transport ----
  document.querySelectorAll(".tab").forEach((b) => b.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === b));
    $("pane-rom").classList.toggle("hidden", b.dataset.tab !== "rom");
    $("pane-image").classList.toggle("hidden", b.dataset.tab !== "image");
  });
  $("flipH").onclick = () => { brushFlip ^= 1; $("flipH").classList.toggle("on", brushFlip & 1); updateBrushInfo(); };
  $("flipV").onclick = () => { brushFlip ^= 2; $("flipV").classList.toggle("on", brushFlip & 2); updateBrushInfo(); };
  $("mode").onchange = (e) => { newTarget(e.target.value); resetHistory(); renderTarget(); renderPreview(); };
  $("clear").onclick = () => { pushHistory(); newTarget(TGT.mode); renderTarget(); renderPreview(); };
  $("undo").onclick = undo;
  $("redo").onclick = redo;
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (k === "y") { e.preventDefault(); redo(); }
  });

  // ---- export ----
  $("export").onclick = () => {
    const doc = { svjt: 1, mode: TGT.mode, palette: Array.from(pal), pixels: TGT.pixels };
    const blob = new Blob([JSON.stringify(doc)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "scene.svjt"; a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`exported ${TGT.mode} source`, "ok");
  };

  // drag-drop routing: image files -> image tab, else ROM tab
  document.body.addEventListener("dragover", (e) => e.preventDefault());
  document.body.addEventListener("drop", (e) => {
    e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return;
    if (/^image\//.test(f.type)) { document.querySelector('.tab[data-tab="image"]').click(); loadImage(f); }
    else { document.querySelector('.tab[data-tab="rom"]').click(); loadRom(f); }
  });

  // ---- init ----
  newTarget("quarter");
  buildPalStrip(); buildSolidStrip(); buildGamut(); renderSrc(); renderTarget(); renderPreview();
  updateHistBtns();
})();
