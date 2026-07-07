// Look-patcher app: authoring canvas -> bake -> live preview against the fake clock,
// plus .svjb export with a round-trip validation. Wires every module together.
(function () {
  const { color: C, fold: F, svjb: SVJB, scene: SCENE, render: R, clock: CLK } = SVJ;

  const bank = SCENE.makeBank();
  const clk = CLK.make(bank);
  const baked = bank.scenes.map(() => null); // per-tileset { tiles, layouts, refsGrid }

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
    moshSpeed: 6,       // 0-15, matches the ROM's B1+left/right speed
    moshAcc: 0,
    lastRenderBeat: 0,
  };

  const $ = (id) => document.getElementById(id);
  const scene = () => bank.scenes[ui.curScene];
  const EFFECT_NAMES = ["NONE", "LAYOUT", "INVERT", "ROTATE", "FREEZE_LATCH", "WOBBLE", "BLANK",
    "MELT", "SCRAMBLE", "CHURN", "SMEAR", "MORPH", "XOR", "STAMP"];
  const MOVE_NAMES = ["STATIC", "CYCLE_FWD", "CYCLE_BACK", "WOBBLE_A", "WOBBLE_B"];
  // matches the ROM speed_rate table (1/8-frame units, 16 clamped levels)
  const SPEED_RATE = [1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128, 160, 192, 224, 240, 248];

  // ---- baking ----
  function rebake(i) {
    try {
      baked[i] = SVJB.bakeScene(bank.scenes[i]);
      setStatus(`tileset ${i}: ${baked[i].tiles.length} tiles, ${baked[i].layouts.length} layout(s)`, "ok");
      if (i === ui.curScene) $("tileCount").textContent = `${baked[i].tiles.length} tiles`;
    } catch (e) {
      setStatus(String(e.message || e), "err");
    }
  }
  function rebakeAll() { for (let i = 0; i < bank.scenes.length; i++) rebake(i); }

  // ---- geometry generator panel ----
  const GEN_FIELDS = { genPeriod: ["period", "vPeriod"], genThick: ["thickness", "vThick"],
    genRot: ["rotation", "vRot"], genSpin: ["spin", "vSpin"], genCell: ["cell", "vCell"] };

  function buildGeneratorControls() {
    const styleSel = $("genStyle"), metSel = $("genMetric");
    styleSel.innerHTML = SVJ.generators.STYLES.map((s) => `<option>${s}</option>`).join("");
    metSel.innerHTML = SVJ.generators.METRIC_KEYS.map((m) => `<option>${m}</option>`).join("");
    const onChange = () => applyGenerator();
    styleSel.onchange = onChange; metSel.onchange = onChange;
    for (const id of Object.keys(GEN_FIELDS)) $(id).oninput = onChange;
    $("tileBudgetHint").textContent = "budget " + (scene().tileBudget || 48) + " tiles";
  }

  // Sync the controls from the current tileset's generator params.
  function syncGeneratorControls() {
    const g = Object.assign(SVJ.generators.defaults(), scene().generator || {});
    $("genStyle").value = g.style;
    $("genMetric").value = g.metric;
    for (const [id, [key, span]] of Object.entries(GEN_FIELDS)) {
      $(id).value = g[key]; $(span).textContent = g[key];
    }
    $("genMetric").parentElement.style.opacity = g.style === "metric" ? 1 : 0.4;
    $("tileBudgetHint").textContent = "budget " + (scene().tileBudget || 48) + " tiles";
  }

  // Read the controls, regenerate this tileset's pixels, re-bake + redraw.
  function applyGenerator() {
    const g = Object.assign(SVJ.generators.defaults(), scene().generator || {});
    g.style = $("genStyle").value;
    g.metric = $("genMetric").value;
    for (const [id, [key, span]] of Object.entries(GEN_FIELDS)) {
      g[key] = parseFloat($(id).value); $(span).textContent = $(id).value;
    }
    scene().generator = g;
    $("genMetric").parentElement.style.opacity = g.style === "metric" ? 1 : 0.4;
    const geo = F.geometry(scene().mode);
    scene().pixels = SVJ.generators.generate(g, geo.pxW, geo.pxH);
    drawAuthoring();
    rebake(ui.curScene);
  }

  function randomizeGenerator() {
    const pick = (a) => a[(Math.random() * a.length) | 0];
    const g = {
      style: pick(SVJ.generators.STYLES),
      metric: pick(SVJ.generators.METRIC_KEYS),
      period: [0, 16, 24, 32, 40, 48][(Math.random() * 6) | 0],
      thickness: 2 + ((Math.random() * 5) | 0),
      rotation: pick([0, 0, 0, 45, 30, 20]),
      spin: pick([0, 0, 30, 60, 90, 6, 10]),
      cell: [12, 16, 20, 24][(Math.random() * 4) | 0],
    };
    scene().generator = g;
    syncGeneratorControls();
    applyGenerator();
  }

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
      const n = { effect: 9, scene: 16, palette: 8, movement: 7 }[axis] || 4;
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
    syncGeneratorControls();
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

    // colour freeze: hold the movement phase at the moment it engaged
    const livePhase = clk.movePhase(mv.division);
    if (!ui.freeze) ui.freezePhase = livePhase;
    const eff = R.effectivePalette(sc.palettes[palIdx], {
      movement: mv, movePhase: ui.freeze ? ui.freezePhase : livePhase,
      effect: fx, primary: sc.primary[palIdx],
    });
    const wobble = fx.type === 0x05 ? { amp: fx.p0 | 0, freq: (fx.p1 | 0) || 1, phase: ui.wobblePhase } : null;

    // Corruption effects, mirroring the ROM. MELT(7)/CHURN(9) mutate a working
    // copy of the tile patterns; SCRAMBLE(8) toggles flip/palette-bank bits of
    // name-table cells. Copies rebuild clean when off or the scene changes.
    // Corruption per frame: accumulate the speed rate (1/8-frame units), run
    // floor(acc/8) passes this frame, with an extra kick on the beat.
    const beatNow = Math.floor(clk.state.tick / CLK.BEAT);
    ui.moshAcc += SPEED_RATE[ui.moshSpeed];
    const passes = ui.moshAcc >> 3;
    ui.moshAcc &= 7;
    const kick = passes * (beatNow !== ui.lastRenderBeat ? 2 : 1);
    ui.lastRenderBeat = beatNow;

    let tilesForRender = b.tiles;
    let layoutForRender = b.layouts[layoutIdx];
    const patMosh = fx.type === 0x07 || fx.type === 0x09 || fx.type === 0x0c || fx.type === 0x0d;
    const layMosh = fx.type === 0x08 || fx.type === 0x0a || fx.type === 0x0b;
    if (patMosh) {
      if (!ui.moshTiles || ui.moshBase !== b) {
        ui.moshTiles = b.tiles.map((t) => t.map((r) => r.slice()));
        ui.moshBase = b;
      }
      const rate = ((fx.p0 | 0) || 8) * kick, T = ui.moshTiles;
      for (let k = 0; k < rate; k++) {
        const ti = (Math.random() * T.length) | 0, py = (Math.random() * 8) | 0, px = (Math.random() * 8) | 0;
        if (fx.type === 0x0c) T[ti][py][px] ^= (Math.random() * 16) | 0;        // XOR bit-flip
        else if (fx.type === 0x0d) {                                           // STAMP tile copy
          const src = (Math.random() * b.tiles.length) | 0, dst = (Math.random() * T.length) | 0;
          T[dst] = b.tiles[src].map((r) => r.slice());
        } else T[ti][py][px] = (Math.random() * 16) | 0;                       // MELT/CHURN noise
      }
      if (fx.type === 0x09) {                 // CHURN heals p1 pixels back
        const heal = ((fx.p1 | 0) || 16) * kick;
        for (let k = 0; k < heal; k++) {
          const ti = (Math.random() * T.length) | 0, py = (Math.random() * 8) | 0, px = (Math.random() * 8) | 0;
          T[ti][py][px] = b.tiles[ti][py][px];
        }
      }
      tilesForRender = T;
    } else { ui.moshTiles = null; ui.moshBase = null; }

    if (layMosh) {
      if (!ui.moshLayout || ui.moshLBase !== layoutForRender) {
        ui.moshLayout = layoutForRender.slice();
        ui.moshLBase = layoutForRender;
      }
      const L = ui.moshLayout.length, nt = b.tiles.length;
      if (fx.type === 0x08) {                  // SCRAMBLE: flip toggles + tile swaps
        const cells = ((fx.p0 | 0) || 24) * kick;
        for (let k = 0; k < cells; k++) ui.moshLayout[(Math.random() * L) | 0] ^= ((Math.random() * 8) | 0) << 9;
        const swaps = (fx.p1 | 0) * kick;
        for (let k = 0; k < swaps; k++) {
          ui.moshLayout[(Math.random() * L) | 0] = ((Math.random() * nt) | 0) | (((Math.random() * 8) | 0) << 9);
        }
      } else if (fx.type === 0x0b) {           // MORPH: drift tile index +1 (wrap)
        const cells = ((fx.p0 | 0) || 16) * kick;
        for (let k = 0; k < cells; k++) {
          const ci = (Math.random() * L) | 0, w = ui.moshLayout[ci];
          ui.moshLayout[ci] = (w & 0xfe00) | (((w & 0x1ff) + 1) % nt);
        }
      } else {                                 // SMEAR: drag cells to a neighbour
        const cells = ((fx.p0 | 0) || 12) * kick, off = (fx.p1 | 0) || 1;
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
  // Emit the ROM-ready image: scenes page-aligned to 16 KB and padded to 4 pages
  // (64 KB), exactly what rom/assets/look.svjb must be. Drop the download straight
  // into rom/assets/ and `make`.
  const PAGE = 0x4000, PAGES = 4;
  function doExport() {
    try {
      const { bytes } = SVJB.serialize(bank, { pageSize: PAGE });
      const info = SVJB.decode(bytes); // round-trip validation
      if (bytes.length > PAGE * PAGES) {
        throw new Error(`aligned bank ${bytes.length} B exceeds ${PAGE * PAGES} B (${PAGES} pages)`);
      }
      const padded = new Uint8Array(PAGE * PAGES);
      padded.set(bytes);
      const blob = new Blob([padded], { type: "application/octet-stream" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "look.svjb";
      a.click();
      URL.revokeObjectURL(a.href);
      const tiles = info.scenes.map((s) => s.tile_count).join("/");
      setStatus(`exported ${padded.length} B (${bytes.length} used) · valid · tiles ${tiles}`, "ok");
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

  // Export the current tileset's source as .svjt (round-trips into the tile studio).
  $("exportSrc").onclick = () => {
    const sc = scene();
    const doc = { svjt: 1, mode: sc.mode, palette: Array.from(sc.palettes[ui.editPal]), pixels: sc.pixels.map((r) => Array.from(r)) };
    const blob = new Blob([JSON.stringify(doc)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `tileset${ui.curScene}.svjt`; a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`exported tileset ${ui.curScene} source`, "ok");
  };

  // Import a .svjt scene source (from the tile studio) into the current tileset.
  $("importSrc").onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const doc = JSON.parse(reader.result);
        if (doc.svjt !== 1 || !Array.isArray(doc.pixels)) throw new Error("not a .svjt source");
        scene().mode = doc.mode === "full" ? "full" : "quarter";
        scene().generator = null;                       // hand-composed, not generated
        scene().pixels = doc.pixels.map((r) => r.slice());
        if (Array.isArray(doc.palette) && doc.palette.length >= 32) {
          scene().palettes[ui.editPal] = Uint8Array.from(doc.palette.slice(0, 32));
        }
        $("modeSel").value = scene().mode;
        sizeAuthoring(); drawAuthoring();
        buildCramGrid(); buildDrawSwatches();
        rebake(ui.curScene);
        setStatus(`imported ${scene().mode} source into tileset ${ui.curScene}`, "ok");
      } catch (err) { setStatus("import failed: " + (err.message || err), "err"); }
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  $("sceneSel").onchange = (e) => {
    ui.curScene = parseInt(e.target.value, 10);
    clk.state.cur.scene = clk.state.pend.scene = ui.curScene; // jump preview too
    $("modeSel").value = scene().mode;
    sizeAuthoring(); drawAuthoring();
    buildDrawSwatches(); buildCramGrid(); buildEffectsCfg(); buildMovementsCfg(); buildAxes();
    syncGeneratorControls();
  };
  $("modeSel").onchange = (e) => {
    scene().mode = e.target.value;
    sizeAuthoring(); applyGenerator();          // regenerate for the new geometry
  };
  $("genRandom").onclick = randomizeGenerator;
  $("palSel").onchange = (e) => {
    ui.editPal = parseInt(e.target.value, 10);
    $("palGenTarget").textContent = ui.editPal;
    buildCramGrid(); buildDrawSwatches(); drawAuthoring();
  };

  // Palette generator: build palette editPal from up to 3 seeds. Palettes are
  // global (identical across tilesets), so write the result to every scene.
  function applyPalGen(mode) {
    const seeds = ["seed0", "seed1", "seed2"].map((id) => C.fromHex($(id).value));
    const backdrop = scene().palettes[ui.editPal][0];
    const pal = SVJ.palgen.build(mode, seeds, backdrop);
    for (const s of bank.scenes) s.palettes[ui.editPal] = Uint8Array.from(pal);
    buildCramGrid(); buildDrawSwatches(); drawAuthoring();
    setStatus(`palette ${ui.editPal}: ${mode}`, "ok");
  }
  $("palInterp").onclick = () => applyPalGen("interpolate");
  $("palHarm").onclick = () => applyPalGen("harmonize");
  $("palOppose").onclick = () => applyPalGen("opposition");
  $("freeze").onclick = () => {           // colour freeze = pause-button toggle
    ui.freeze = !ui.freeze;
    $("freeze").classList.toggle("on", ui.freeze);
  };

  function setSpeed(v) { ui.moshSpeed = Math.max(0, Math.min(15, v)); $("spdVal").textContent = ui.moshSpeed; }
  $("spdUp").onclick = () => setSpeed(ui.moshSpeed + 1);
  $("spdDn").onclick = () => setSpeed(ui.moshSpeed - 1);

  // ---- ROM tile importer (drop a ROM, select a block, fill the source) ----
  // Reads raw Mode 4 tiles from any file. The selected WxH tile block tiles across the
  // whole source, then folds/dedups/bakes like any other pattern.
  const ROM = { buf: null, off: 0, phase: 0, sw: 16, sh: 16, sel: null, palGG: false, format: "raw", tileBytes: null };
  const romSheet = $("romSheet");
  const romCtx = romSheet.getContext("2d");
  romSheet.width = ROM.sw * 8; romSheet.height = ROM.sh * 8;
  let romDrag = null;

  // Tiles come from the decoded byte stream (raw = a view from the offset; a compressed
  // format decompresses the block starting at the offset). Tile k = tileBytes[k*32..].
  const romTileByte = (col, row) => (row * ROM.sw + col) * 32;
  function recomputeRomTiles() {
    if (!ROM.buf) return;
    const rd = ROM.off + ROM.phase;                    // effective read offset (base + phase)
    if (ROM.format === "rnc") {
      const r = SVJ.romdecode.rncUnpack(ROM.buf, rd);
      ROM.tileBytes = r.bytes;
      setStatus(`RNC ${r.ok ? "✓ CRC ok" : "✗ no/!CRC"} · ${r.bytes.length} B @ 0x${rd.toString(16)}`, r.ok ? "ok" : "err");
    } else ROM.tileBytes = SVJ.romdecode.decode(ROM.buf, rd, ROM.format);
  }

  // Set the ROM offset (byte-precise) and refresh everything that reads it.
  function setRomOff(off) {
    ROM.off = Math.max(0, Math.min(off, ROM.buf ? ROM.buf.length : 0));
    const slider = $("romOff");
    slider.value = Math.min(ROM.off, parseInt(slider.max, 10));
    $("vRomOff").textContent = "0x" + ROM.off.toString(16);
    recomputeRomTiles();
    renderRomSheet(); renderRomPalStrip(); updateRomSel();
  }

  function renderRomSheet() {
    if (!ROM.buf) return;
    const img = romCtx.createImageData(romSheet.width, romSheet.height);
    for (let row = 0; row < ROM.sh; row++) {
      for (let col = 0; col < ROM.sw; col++) {
        const t = SVJ.tiles.decode(ROM.tileBytes, romTileByte(col, row));
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
          const g = (t[r][c] & 15) * 17;                       // greyscale so structure reads
          const p = ((row * 8 + r) * romSheet.width + (col * 8 + c)) * 4;
          img.data[p] = g; img.data[p + 1] = g; img.data[p + 2] = g; img.data[p + 3] = 255;
        }
      }
    }
    romCtx.putImageData(img, 0, 0);
    if (ROM.sel) {
      romCtx.strokeStyle = "#57e0c8"; romCtx.lineWidth = 1;
      romCtx.strokeRect(ROM.sel.x * 8 + 0.5, ROM.sel.y * 8 + 0.5, ROM.sel.w * 8 - 1, ROM.sel.h * 8 - 1);
    }
  }
  function romMouseTile(ev) {
    const rect = romSheet.getBoundingClientRect();
    return {
      col: Math.max(0, Math.min(ROM.sw - 1, Math.floor((ev.clientX - rect.left) / rect.width * ROM.sw))),
      row: Math.max(0, Math.min(ROM.sh - 1, Math.floor((ev.clientY - rect.top) / rect.height * ROM.sh))),
    };
  }
  function updateRomSel() {
    if (!ROM.sel) { $("romSel").textContent = "drag to select a tile block"; return; }
    const at = ROM.format === "raw" ? `@ 0x${(ROM.off + romTileByte(ROM.sel.x, ROM.sel.y)).toString(16)}` : `tile (${ROM.sel.x},${ROM.sel.y})`;
    $("romSel").textContent = `sel ${ROM.sel.w}×${ROM.sel.h} tiles ${at}`;
    $("romFill").disabled = false;
  }
  romSheet.addEventListener("mousedown", (e) => {
    if (!ROM.buf) return;
    romDrag = romMouseTile(e);
    ROM.sel = { x: romDrag.col, y: romDrag.row, w: 1, h: 1 };
    renderRomSheet(); updateRomSel();
  });
  romSheet.addEventListener("mousemove", (e) => {
    if (!romDrag) return;
    const t = romMouseTile(e);
    ROM.sel = { x: Math.min(romDrag.col, t.col), y: Math.min(romDrag.row, t.row),
      w: Math.abs(t.col - romDrag.col) + 1, h: Math.abs(t.row - romDrag.row) + 1 };
    renderRomSheet(); updateRomSel();
  });
  window.addEventListener("mouseup", () => { romDrag = null; });

  function loadRom(file) {
    const reader = new FileReader();
    reader.onload = () => {
      ROM.buf = new Uint8Array(reader.result);
      ROM.off = 0; ROM.sel = null;
      $("romOff").max = Math.max(0, ROM.buf.length - ROM.sw * ROM.sh * 32);
      $("romOff").disabled = false;
      $("romInfo").textContent = `${file.name} · ${(ROM.buf.length / 1024) | 0} KB · ${(ROM.buf.length / 32) | 0} tiles`;
      $("romFill").disabled = true;
      $("romPalScan").disabled = false;
      $("romPalUse").disabled = false;
      $("romFindRnc").disabled = false;
      $("romPhase").disabled = false; ROM.phase = 0; $("romPhase").value = 0; $("vRomPhase").textContent = "0";
      ROM.palGG = /\.gg$/i.test(file.name);
      $("romPalGG").checked = ROM.palGG;
      setRomOff(0);
    };
    reader.readAsArrayBuffer(file);
  }

  // ---- palette import ----
  // Decode 32 CRAM entries at `off`. SMS = 1 byte/entry (6-bit 00BBGGRR); Game Gear =
  // 2 bytes/entry (12-bit 0000BBBBGGGGRRRR), downsampled to 6-bit.
  function decodePalAt(off) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      if (ROM.palGG) {
        const v = (ROM.buf[off + i * 2] || 0) | ((ROM.buf[off + i * 2 + 1] || 0) << 8);
        out[i] = (((v >> 8) & 0xf) >> 2 << 4) | (((v >> 4) & 0xf) >> 2 << 2) | ((v & 0xf) >> 2);
      } else {
        out[i] = (ROM.buf[off + i] || 0) & 0x3f;
      }
    }
    return out;
  }
  function renderRomPalStrip() {
    const host = $("romPalStrip");
    host.innerHTML = "";
    if (!ROM.buf) return;
    const pal = decodePalAt(ROM.off);
    for (let i = 0; i < 32; i++) {
      const el = document.createElement("i");
      el.style.background = C.toHex(pal[i]);
      el.title = `entry ${i} = 0x${pal[i].toString(16)}`;
      host.appendChild(el);
    }
  }
  // A 32-byte run reads as CRAM if every byte has its top 2 bits clear (<=0x3F),
  // with some variety and not mostly zero. Game Gear: every colour's high byte <=0x0F.
  function looksLikePalette(off) {
    if (ROM.palGG) {
      for (let i = 0; i < 32; i++) { const hi = ROM.buf[off + i * 2 + 1]; if (hi === undefined || hi > 0x0f) return false; }
      return true;
    }
    const seen = new Set(); let zeros = 0;
    for (let i = 0; i < 32; i++) {
      const b = ROM.buf[off + i];
      if (b === undefined || (b & 0xc0)) return false;
      if (b === 0) zeros++;
      seen.add(b);
    }
    return seen.size >= 8 && zeros <= 20;
  }
  function findPalettesFrom(from) {
    const step = ROM.palGG ? 2 : 1, span = ROM.palGG ? 64 : 32;
    for (let o = from; o <= ROM.buf.length - span; o += step) if (looksLikePalette(o)) return o;
    return -1;
  }
  function scanPalettes() {
    const o = findPalettesFrom(ROM.off + 1);
    if (o < 0) { $("romPalInfo").textContent = "no more palette-like runs found — wrapping"; setRomOff(0); return; }
    setRomOff(o);
    $("romPalInfo").textContent = `palette candidate @ 0x${o.toString(16)} — Use palette to apply, or Find again`;
  }
  function useRomPalette() {
    const pal = decodePalAt(ROM.off);
    for (const s of bank.scenes) s.palettes[ui.editPal] = Uint8Array.from(pal);
    buildCramGrid(); buildDrawSwatches(); drawAuthoring();
    setStatus(`palette ${ui.editPal} ← ROM @ 0x${ROM.off.toString(16)}`, "ok");
  }
  $("romPalScan").onclick = scanPalettes;
  $("romPalUse").onclick = useRomPalette;
  $("romPalGG").onchange = (e) => { ROM.palGG = e.target.checked; renderRomPalStrip(); };
  function fillSourceFromRom() {
    if (!ROM.buf || !ROM.sel) return;
    const g = F.geometry(scene().mode);
    const px = [];
    for (let y = 0; y < g.pxH; y++) px.push(new Array(g.pxW).fill(0));
    for (let ty = 0; ty < g.tilesH; ty++) {
      for (let tx = 0; tx < g.tilesW; tx++) {
        const t = SVJ.tiles.decode(ROM.tileBytes, romTileByte(ROM.sel.x + (tx % ROM.sel.w), ROM.sel.y + (ty % ROM.sel.h)));
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) px[ty * 8 + r][tx * 8 + c] = t[r][c];
      }
    }
    scene().pixels = px;
    drawAuthoring();
    rebake(ui.curScene);
    setStatus(`filled tileset ${ui.curScene} from ROM (${ROM.sel.w}×${ROM.sel.h} block)`, "ok");
  }
  $("romFmt").innerHTML = SVJ.romdecode.FORMATS.map((f) => `<option value="${f.key}">${f.label}</option>`).join("");
  $("romFmt").onchange = (e) => { ROM.format = e.target.value; $("romOff").step = ROM.format === "raw" ? 32 : 1; if (ROM.buf) setRomOff(ROM.off); };
  $("romFindRnc").onclick = () => {
    const o = SVJ.romdecode.findRnc(ROM.buf, ROM.off + 1);
    if (o < 0) { setStatus("no more RNC blocks found — wrapping", "err"); ROM.format = "rnc"; $("romFmt").value = "rnc"; $("romOff").step = 1; setRomOff(0); return; }
    ROM.format = "rnc"; $("romFmt").value = "rnc"; $("romOff").step = 1; setRomOff(o);
  };
  $("romFile").onchange = (e) => { if (e.target.files[0]) loadRom(e.target.files[0]); };
  $("romOff").oninput = (e) => setRomOff(ROM.format === "raw" ? (parseInt(e.target.value, 10) & ~31) : parseInt(e.target.value, 10));
  $("romPhase").oninput = (e) => { ROM.phase = parseInt(e.target.value, 10) & 31; $("vRomPhase").textContent = ROM.phase; setRomOff(ROM.off); };
  $("romFill").onclick = fillSourceFromRom;
  const romImp = $("romImp");
  ["dragover", "dragenter"].forEach((ev) => romImp.addEventListener(ev, (e) => { e.preventDefault(); romImp.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => romImp.addEventListener(ev, (e) => { e.preventDefault(); romImp.classList.remove("drag"); }));
  romImp.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) { romImp.open = true; loadRom(f); } });

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
    $("spdVal").textContent = ui.moshSpeed;
    $("sceneSel").innerHTML = bank.scenes.map((s, i) => `<option>${i}</option>`).join("");
    buildGeneratorControls();
    syncGeneratorControls();
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
