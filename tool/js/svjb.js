// .svjb serializer (+ a light decoder for round-trip validation).
// Byte-for-byte to SCENE_FORMAT.md. Little-endian throughout.
window.SVJ = window.SVJ || {};
SVJ.svjb = (function () {
  const F = SVJ.fold, T = SVJ.tiles;
  const MAGIC = 0x53, VERSION = 0x01; // 'S'
  const LAYOUT_BYTES = F.COLS * F.ROWS * 2; // 1536

  // Writer helper over a growable byte array.
  function Writer() {
    const bytes = [];
    return {
      u8: (v) => bytes.push(v & 0xff),
      u16: (v) => { bytes.push(v & 0xff); bytes.push((v >> 8) & 0xff); },
      raw: (arr) => { for (const b of arr) bytes.push(b & 0xff); },
      at: (i, v) => { bytes[i] = v & 0xff; },
      len: () => bytes.length,
      done: () => Uint8Array.from(bytes),
    };
  }

  // Bake tiles + layouts for a scene from its authoring pixels.
  function bakeScene(scene) {
    return F.bake(scene.pixels, scene.mode, scene.variants, {
      bank: scene.bank ? 1 : 0,
      priority: scene.priority ? 1 : 0,
    });
  }

  // Serialize a whole bank model -> Uint8Array. Throws on constraint violation.
  function serialize(bank) {
    const baked = bank.scenes.map(bakeScene);
    baked.forEach((b, i) => {
      if (b.tiles.length > 255) {
        throw new Error(`Scene ${i}: ${b.tiles.length} unique tiles exceeds 255.`);
      }
    });

    const w = Writer();
    // --- Bank header (20 bytes) ---
    w.raw([0x53, 0x56, 0x4a, 0x42]); // "SVJB"
    w.u8(VERSION);
    w.u8(bank.region & 0xff);
    w.u8(4); // scene_count
    w.u8(bank.default_bpm & 0xff);
    w.u8(bank.boot.scene & 3);
    w.u8(bank.boot.palette & 3);
    w.u8(bank.boot.effect & 3);
    w.u8(bank.boot.movement & 3);
    const scenePtrPos = w.len(); // offset 12
    w.u16(0); w.u16(0); w.u16(0); w.u16(0); // placeholders

    // --- Scenes ---
    const scenePtrs = [];
    bank.scenes.forEach((scene, si) => {
      const b = baked[si];
      const sceneStart = w.len();
      scenePtrs.push(sceneStart);

      const tileCount = b.tiles.length;
      const layoutCount = b.layouts.length;
      const off_tiles = 20;
      const off_layouts = off_tiles + tileCount * 32;
      const off_palettes = off_layouts + layoutCount * LAYOUT_BYTES;
      const off_effects = off_palettes + 4 * 32;
      const off_movements = off_effects + 4 * 4;

      // Scene header (16 bytes) + primary[4]
      w.u8(tileCount);
      w.u8(layoutCount);
      w.u8(0); // flags (no RLE in v1)
      w.u8(0); // reserved
      w.u16(off_tiles);
      w.u16(off_layouts);
      w.u16(off_palettes);
      w.u16(off_effects);
      w.u16(off_movements);
      w.u16(0); // reserved
      for (let p = 0; p < 4; p++) w.u8((scene.primary[p] || 0) & 31); // primary[4]

      // TILES
      for (const t of b.tiles) w.raw(T.encode(t));
      // LAYOUTS
      for (const lay of b.layouts) {
        for (let i = 0; i < lay.length; i++) w.u16(lay[i]);
      }
      // PALETTES (4 x 32)
      for (let p = 0; p < 4; p++) {
        const pal = scene.palettes[p];
        for (let i = 0; i < 32; i++) w.u8(pal[i] & 0x3f);
      }
      // EFFECTS (4 x {type,p0,p1,p2})
      for (let e = 0; e < 4; e++) {
        const fx = scene.effects[e];
        w.u8(fx.type); w.u8(fx.p0 || 0); w.u8(fx.p1 || 0); w.u8(fx.p2 || 0);
      }
      // MOVEMENTS (4 x {type,division,range_start,range_len})
      for (let m = 0; m < 4; m++) {
        const mv = scene.movements[m];
        w.u8(mv.type); w.u8(mv.division || 1); w.u8(mv.range_start || 0); w.u8(mv.range_len || 0);
      }
    });

    // Backfill scene pointers.
    scenePtrs.forEach((ptr, i) => {
      w.at(scenePtrPos + i * 2, ptr & 0xff);
      w.at(scenePtrPos + i * 2 + 1, (ptr >> 8) & 0xff);
    });

    return { bytes: w.done(), baked };
  }

  // Minimal decoder: parse structure and verify offsets/sizes are self-consistent.
  // Returns a summary; throws on the first inconsistency (used as a round-trip check).
  function decode(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== "SVJB") throw new Error("bad magic: " + magic);
    if (bytes[4] !== VERSION) throw new Error("bad version: " + bytes[4]);
    const scene_count = bytes[6];
    const scenePtrs = [];
    for (let i = 0; i < 4; i++) scenePtrs.push(dv.getUint16(12 + i * 2, true));

    const scenes = scenePtrs.map((base) => {
      const tile_count = bytes[base + 0];
      const layout_count = bytes[base + 1];
      const off_tiles = dv.getUint16(base + 4, true);
      const off_layouts = dv.getUint16(base + 6, true);
      const off_palettes = dv.getUint16(base + 8, true);
      const off_effects = dv.getUint16(base + 10, true);
      const off_movements = dv.getUint16(base + 12, true);
      // Consistency: sections in order with expected sizes.
      const expect = {
        off_tiles: 20,
        off_layouts: 20 + tile_count * 32,
        off_palettes: 20 + tile_count * 32 + layout_count * LAYOUT_BYTES,
        off_effects: 20 + tile_count * 32 + layout_count * LAYOUT_BYTES + 128,
        off_movements: 20 + tile_count * 32 + layout_count * LAYOUT_BYTES + 128 + 16,
      };
      for (const [k, v] of Object.entries(expect)) {
        const got = { off_tiles, off_layouts, off_palettes, off_effects, off_movements }[k];
        if (got !== v) throw new Error(`scene@${base} ${k}: got ${got}, expected ${v}`);
      }
      return { base, tile_count, layout_count, off_movements };
    });

    return { magic, version: bytes[4], scene_count, region: bytes[5], default_bpm: bytes[7], scenes };
  }

  return { serialize, decode, bakeScene, LAYOUT_BYTES };
})();
