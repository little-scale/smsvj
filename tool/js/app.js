// Look-patcher app: authoring canvas -> bake -> live preview against the fake clock,
// plus .svjb export with a round-trip validation. Wires every module together.
(function () {
  const { color: C, fold: F, svjb: SVJB, scene: SCENE, render: R, clock: CLK } = SVJ;

  const bank = SCENE.makeBank();
  const clk = CLK.make(bank);
  const baked = [null, null, null, null]; // per-scene { tiles, layouts, refsGrid }

  const ui = {
    curScene: 0,      // scene being AUTHORED
    drawIndex: 1,     // paint colour (CRAM index within bank)
    editPal: 0,       // palette being edited
    editCram: 1,      // CRAM entry selected in the editor
    playing: false,
    freeze: false,
    lastBeat: 0,
    lastTs: 0,
    wobblePhase: 0,
    moshSpeed: 1,       // 0-3, matches the ROM's B1+left/right speed
    lastRenderBeat: 0,
  };

  const $ = (id) => document.getElementById(id);
  const scene = () => bank.scenes[ui.curScene];
  const EFFECT_NAMES = ["NONE", "LAYOUT", "INVERT", "ROTATE", "FREEZE_LATCH", "WOBBLE", "BLANK", "MELT", "SCRAMBLE", "CHURN", "SMEAR"];
  const MOVE_NAMES = ["STATIC", "CYCLE_FWD", "CYCLE_BACK", "PINGPONG"];

  // ---- baking ----
  function rebake(i) {
    try {
      baked[i] = SVJB.bakeScene(bank.scenes[i]);
      setStatus(`scene ${i}: ${baked[i].tiles.length} tiles, ${baked[i].layouts.length} layout(s)`, "ok");
    } catch (e) {
      setStatus(String(e.message || e), "err");
    }
  }
  function rebakeAll() { for (let i = 0; i < 4; i++) rebake(i); }

  function setStatus(msg, cls) {
    const el = $("status");
    el.textContent = msg;
    el.className = "status" + (cls ? " " + cls : "");
  }

  // ---- authoring canvas ----
  const authCanvas = $("authCanvas");
  const authCtx = authCanvas.getContext("2d");
  let painting = false;

  function sizeAuthoring() {
    const g = F.geometry(scene().mode);
    authCanvas.width = g.pxW;
    authCanvas.height = g.pxH;
  }
  function drawAuthoring() {
    const g = F.geometry(scene().mode);
    const img = authCtx.createImageData(g.pxW, g.pxH);
    const pal = scene().palettes[ui.editPal];
    const bankOff = scene().bank ? 16 : 0;
    const px = scene().pixels;
    for (let y = 0; y < g.pxH; y++) {
      for (let x = 0; x < g.pxW; x++) {
        const col = C.toRGB(pal[(px[y][x] & 15) + bankOff] || 0);
        const p = (y * g.pxW + x) * 4;
        img.data[p] = col.r; img.data[p + 1] = col.g; img.data[p + 2] = col.b; img.data[p + 3] = 255;
      }
    }
    authCtx.putImageData(img, 0, 0);
  }
  function paintAt(ev) {
    const g = F.geometry(scene().mode);
    const rect = authCanvas.getBoundingClientRect();
    const x = Math.floor(((ev.clientX - rect.left) / rect.width) * g.pxW);
    const y = Math.floor(((ev.clientY - rect.top) / rect.height) * g.pxH);
    if (x < 0 || y < 0 || x >= g.pxW || y >= g.pxH) return;
    scene().pixels[y][x] = ui.drawIndex & 15;
    drawAuthoring();
  }
  authCanvas.addEventListener("mousedown", (e) => { painting = true; paintAt(e); });
  authCanvas.addEventListener("mousemove", (e) => { if (painting) paintAt(e); });
  window.addEventListener("mouseup", () => { if (painting) { painting = false; rebake(ui.curScene); } });

  // ---- draw swatches (bank 0 of edit palette) ----
  function buildDrawSwatches() {
    const host = $("drawSwatches");
    host.innerHTML = "";
    const pal = scene().palettes[ui.editPal];
    for (let i = 0; i < 16; i++) {
      const el = document.createElement("i");
      el.style.background = C.toHex(pal[i]);
      if (i === ui.drawIndex) el.className = "sel";
      el.title = "index " + i;
      el.onclick = () => { ui.drawIndex = i; buildDrawSwatches(); };
      host.appendChild(el);
    }
  }

  // ---- palette editor ----
  function buildCramGrid() {
    const host = $("cramGrid");
    host.innerHTML = "";
    const pal = scene().palettes[ui.editPal];
    for (let i = 0; i < 32; i++) {
      const el = document.createElement("i");
      el.style.background = C.toHex(pal[i]);
      let cls = "";
      if (i === ui.editCram) cls += " sel";
      if (i === scene().primary[ui.editPal]) cls += " prim";
      el.className = cls.trim();
      el.title = "CRAM " + i + (i < 16 ? " (bank0)" : " (bank1)");
      el.onclick = () => { ui.editCram = i; buildCramGrid(); };
      el.ondblclick = () => { scene().primary[ui.editPal] = i; $("primaryVal").textContent = i; buildCramGrid(); };
      host.appendChild(el);
    }
    $("primaryVal").textContent = scene().primary[ui.editPal];
  }
  function buildGamut() {
    const host = $("gamutGrid");
    host.innerHTML = "";
    for (let cram = 0; cram < 64; cram++) {
      const el = document.createElement("i");
      el.style.background = C.toHex(cram);
      el.title = "0x" + cram.toString(16);
      el.onclick = () => {
        scene().palettes[ui.editPal][ui.editCram] = cram;
        buildCramGrid(); buildDrawSwatches(); drawAuthoring();
      };
      host.appendChild(el);
    }
  }

  // ---- effects / movements config ----
  function numInput(val, min, max, on) {
    const el = document.createElement("input");
    el.type = "number"; el.min = min; el.max = max; el.value = val;
    el.oninput = () => on(parseInt(el.value || "0", 10) | 0);
    return el;
  }
  function selInput(names, val, on) {
    const el = document.createElement("select");
    names.forEach((n, i) => {
      const o = document.createElement("option");
      o.value = i; o.textContent = i + ":" + n; if (i === val) o.selected = true;
      el.appendChild(o);
    });
    el.onchange = () => on(parseInt(el.value, 10));
    return el;
  }
  function buildEffectsCfg() {
    const host = $("effectsCfg");
    host.innerHTML = "";
    scene().effects.forEach((fx, i) => {
      const row = document.createElement("div");
      row.className = "rec";
      const lbl = document.createElement("span"); lbl.textContent = i;
      row.appendChild(lbl);
      row.appendChild(selInput(EFFECT_NAMES, fx.type, (v) => { fx.type = v; }));
      row.appendChild(numInput(fx.p0, 0, 255, (v) => { fx.p0 = v; }));
      row.appendChild(numInput(fx.p1, 0, 255, (v) => { fx.p1 = v; }));
      row.appendChild(numInput(fx.p2, 0, 255, (v) => { fx.p2 = v; }));
      host.appendChild(row);
    });
  }
  function buildMovementsCfg() {
    const host = $("movementsCfg");
    host.innerHTML = "";
    scene().movements.forEach((mv, i) => {
      const row = document.createElement("div");
      row.className = "rec";
      const lbl = document.createElement("span"); lbl.textContent = i;
      row.appendChild(lbl);
      row.appendChild(selInput(MOVE_NAMES, mv.type, (v) => { mv.type = v; }));
      row.appendChild(numInput(mv.division, 1, 64, (v) => { mv.division = v; }));
      row.appendChild(numInput(mv.range_start, 0, 31, (v) => { mv.range_start = v; }));
      row.appendChild(numInput(mv.range_len, 0, 32, (v) => { mv.range_len = v; }));
      host.appendChild(row);
    });
  }

  // ---- axis buttons ----  (effect is a 9-way dial; other axes are of 4)
  function buildAxes() {
    document.querySelectorAll(".axbtns").forEach((host) => {
      const axis = host.dataset.axis;
      const n = axis === "effect" ? 9 : 4;
      host.innerHTML = "";
      for (let i = 0; i < n; i++) {
        const b = document.createElement("b");
        b.textContent = axis === "effect" ? EFFECT_NAMES[scene().effects[i].type].slice(0, 3) : i;
        b.title = axis === "effect" ? EFFECT_NAMES[scene().effects[i].type] : "";
        if (clk.state.cur[axis] === i) b.classList.add("cur");
        if (clk.state.pend[axis] === i && clk.state.pend[axis] !== clk.state.cur[axis]) b.classList.add("pend");
        b.onclick = () => {
          clk.set(axis, i);
          if (!ui.playing) { // apply immediately when the clock isn't running
            clk.state.cur[axis] = i;
            if (axis === "scene") syncAuthoringToPreview();
          }
          buildAxes();
        };
        host.appendChild(b);
      }
    });
  }

  function syncAuthoringToPreview() {
    // Keep the authored scene in step with the previewed scene for convenience.
    ui.curScene = clk.state.cur.scene;
    $("sceneSel").value = String(ui.curScene);
    $("modeSel").value = scene().mode;
    sizeAuthoring(); drawAuthoring();
    buildDrawSwatches(); buildCramGrid();
    buildEffectsCfg(); buildMovementsCfg();
  }

  // ---- preview render ----
  const pv = $("previewCanvas");
  const pvCtx = pv.getContext("2d");
  const pvImg = pvCtx.createImageData(R.W, R.H);

  function renderPreview() {
    const si = clk.state.cur.scene;
    const b = baked[si];
    if (!b) return;
    const sc = bank.scenes[si];
    const palIdx = clk.state.cur.palette;
    const fx = sc.effects[clk.state.cur.effect];
    const mv = sc.movements[clk.state.cur.movement];

    // LAYOUT effect selects a mirror variant (clamped to what was baked).
    let layoutIdx = 0;
    if (fx.type === 0x01) layoutIdx = Math.min(fx.p0 | 0, b.layouts.length - 1);

    const eff = R.effectivePalette(sc.palettes[palIdx], {
      movement: mv, movePhase: clk.movePhase(mv.division),
      effect: fx, freeze: ui.freeze, primary: sc.primary[palIdx],
    });
    const wobble = fx.type === 0x05 ? { amp: fx.p0 | 0, freq: (fx.p1 | 0) || 1, phase: ui.wobblePhase } : null;

    // Corruption effects, mirroring the ROM. MELT(7)/CHURN(9) mutate a working
    // copy of the tile patterns; SCRAMBLE(8) toggles flip/palette-bank bits of
    // name-table cells. Copies rebuild clean when off or the scene changes.
    // Corruption amount per frame = speed multiplier, with an extra beat kick.
    const beatNow = Math.floor(clk.state.tick / CLK.BEAT);
    const kick = (beatNow !== ui.lastRenderBeat ? 2 : 1) * (1 << ui.moshSpeed);
    ui.lastRenderBeat = beatNow;

    let tilesForRender = b.tiles;
    let layoutForRender = b.layouts[layoutIdx];
    if (fx.type === 0x07 || fx.type === 0x09) {
      if (!ui.moshTiles || ui.moshBase !== b) {
        ui.moshTiles = b.tiles.map((t) => t.map((r) => r.slice()));
        ui.moshBase = b;
      }
      const rate = ((fx.p0 | 0) || 24) * kick;
      for (let k = 0; k < rate; k++) {
        const ti = (Math.random() * ui.moshTiles.length) | 0;
        ui.moshTiles[ti][(Math.random() * 8) | 0][(Math.random() * 8) | 0] = (Math.random() * 16) | 0;
      }
      if (fx.type === 0x09) {                 // CHURN heals p1 pixels back
        const heal = ((fx.p1 | 0) || 16) * kick;
        for (let k = 0; k < heal; k++) {
          const ti = (Math.random() * ui.moshTiles.length) | 0;
          const py = (Math.random() * 8) | 0, px = (Math.random() * 8) | 0;
          ui.moshTiles[ti][py][px] = b.tiles[ti][py][px];
        }
      }
      tilesForRender = ui.moshTiles;
    } else { ui.moshTiles = null; ui.moshBase = null; }

    if (fx.type === 0x08 || fx.type === 0x0a) { // layout-corrupting effects
      if (!ui.moshLayout || ui.moshLBase !== layoutForRender) {
        ui.moshLayout = layoutForRender.slice();
        ui.moshLBase = layoutForRender;
      }
      const L = ui.moshLayout.length;
      if (fx.type === 0x08) {                  // SCRAMBLE: flip toggles + tile swaps
        const cells = ((fx.p0 | 0) || 24) * kick;
        for (let k = 0; k < cells; k++) {
          ui.moshLayout[(Math.random() * L) | 0] ^= ((Math.random() * 8) | 0) << 9;
        }
        const swaps = (fx.p1 | 0) * kick;
        for (let k = 0; k < swaps; k++) {
          ui.moshLayout[(Math.random() * L) | 0] =
            ((Math.random() * b.tiles.length) | 0) | (((Math.random() * 8) | 0) << 9);
        }
      } else {                                 // SMEAR: drag cells to a neighbour
        const cells = ((fx.p0 | 0) || 40) * kick;
        const off = (fx.p1 | 0) || 1;
        for (let k = 0; k < cells; k++) {
          const ci = (Math.random() * L) | 0;
          ui.moshLayout[(ci + off) % L] = ui.moshLayout[ci];
        }
      }
      layoutForRender = ui.moshLayout;
    } else { ui.moshLayout = null; ui.moshLBase = null; }

    R.renderLayout(pvImg, layoutForRender, tilesForRender, eff.pal, eff.blank, wobble);
    pvCtx.putImageData(pvImg, 0, 0);

    const t = clk.state.tick;
    $("clockReadout").textContent =
      `bar ${Math.floor(t / CLK.BAR)} · beat ${Math.floor(t / CLK.BEAT) % 4} · tick ${t % 16} · ${Math.round(bank.default_bpm)}bpm`;
  }

  function frame(ts) {
    ui.wobblePhase = (ts / 1000) * 4; // ~0.64 Hz base wobble, animates continuously
    if (ui.playing) {
      const dtMs = ui.lastTs ? ts - ui.lastTs : 16;
      const dtFrames = (dtMs / 1000) * clk.state.fps;
      clk.advance(Math.min(dtFrames, 8)); // clamp after a tab-away
      const beat = Math.floor(clk.state.tick / CLK.BEAT);
      if (beat !== ui.lastBeat) {
        if ($("autoPal").checked) clk.nudge("palette", 1);
        if ($("autoFx").checked) clk.nudge("effect", 1);
        if ($("autoMv").checked) clk.nudge("movement", 1);
        ui.lastBeat = beat;
        buildAxes();
      }
    }
    ui.lastTs = ts;
    renderPreview();
    requestAnimationFrame(frame);
  }

  // ---- export ----
  function doExport() {
    try {
      const { bytes } = SVJB.serialize(bank);
      const info = SVJB.decode(bytes); // round-trip validation
      const blob = new Blob([bytes], { type: "application/octet-stream" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "look.svjb";
      a.click();
      URL.revokeObjectURL(a.href);
      const tiles = info.scenes.map((s) => s.tile_count).join("/");
      setStatus(`exported ${bytes.length} B · valid · tiles ${tiles}`, "ok");
    } catch (e) {
      setStatus("export failed: " + (e.message || e), "err");
    }
  }

  // ---- transport / header controls ----
  $("play").onclick = () => {
    ui.playing = !ui.playing;
    $("play").textContent = ui.playing ? "⏸ Pause" : "▶ Play";
    $("play").classList.toggle("on", ui.playing);
    ui.lastTs = 0;
  };
  $("bpm").oninput = (e) => {
    const v = Math.max(20, Math.min(240, parseInt(e.target.value || "120", 10)));
    bank.default_bpm = v; clk.state.bpm = v;
  };
  $("region").onchange = (e) => {
    bank.region = parseInt(e.target.value, 10);
    clk.state.fps = (bank.region & 1) ? 50 : 60;
  };
  $("export").onclick = doExport;

  $("sceneSel").onchange = (e) => {
    ui.curScene = parseInt(e.target.value, 10);
    clk.state.cur.scene = clk.state.pend.scene = ui.curScene; // jump preview too
    $("modeSel").value = scene().mode;
    sizeAuthoring(); drawAuthoring();
    buildDrawSwatches(); buildCramGrid(); buildEffectsCfg(); buildMovementsCfg(); buildAxes();
  };
  $("modeSel").onchange = (e) => {
    scene().mode = e.target.value;
    scene().pixels = SCENE.emptyPixels(scene().mode); // fresh canvas; user re-paints
    sizeAuthoring(); drawAuthoring(); rebake(ui.curScene);
  };
  $("palSel").onchange = (e) => {
    ui.editPal = parseInt(e.target.value, 10);
    buildCramGrid(); buildDrawSwatches(); drawAuthoring();
  };
  $("freeze").onmousedown = () => { ui.freeze = true; };
  window.addEventListener("mouseup", () => { ui.freeze = false; });

  function setSpeed(v) { ui.moshSpeed = Math.max(0, Math.min(3, v)); $("spdVal").textContent = ui.moshSpeed; }
  $("spdUp").onclick = () => setSpeed(ui.moshSpeed + 1);
  $("spdDn").onclick = () => setSpeed(ui.moshSpeed - 1);

  // keyboard: number keys pick draw colour; space toggles play.
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.key === " ") { e.preventDefault(); $("play").click(); }
    const n = parseInt(e.key, 16);
    if (!isNaN(n)) { ui.drawIndex = n & 15; buildDrawSwatches(); }
  });

  // ---- init ----
  function init() {
    $("bpm").value = bank.default_bpm;
    sizeAuthoring();
    rebakeAll();
    drawAuthoring();
    buildDrawSwatches();
    buildCramGrid();
    buildGamut();
    buildEffectsCfg();
    buildMovementsCfg();
    buildAxes();
    requestAnimationFrame(frame);
  }
  init();
})();
