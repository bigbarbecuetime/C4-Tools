/* Shared Minecraft asset loader for the config designers.
 *
 * Fetches official textures at runtime from public mirrors of the vanilla
 * client assets. Everything is cached; while a texture is loading - or if it
 * can't be resolved anywhere - callers fall back to a flat color from
 * colorFor().
 *
 * API:
 *   MCAssets.item(name)              -> canvas|null   (item model texture)
 *   MCAssets.block(name, face)       -> canvas|null   (face: top|side|bottom)
 *   MCAssets.onReady(cb)             -> cb() fires whenever a texture arrives
 *   MCAssets.colorFor(name)          -> fallback CSS color
 */
"use strict";

const MCAssets = (() => {
  // Game versions to try, newest first. The first entry should match the
  // server (run/ targets Paper 26.1.2); older versions are fallbacks for
  // when a mirror doesn't have the newest branch yet - most block/item
  // textures haven't changed in years, so older copies render identically.
  const VERSIONS = ["26.1.2", "26.1", "1.21.4", "1.21.1"];

  // Vanilla client assets served by mcasset.cloud -
  // https://mcasset.cloud/<version>/ is the browser UI; raw files come from
  // assets.mcasset.cloud. Images load with crossOrigin=anonymous so failures
  // fall through the candidate list instead of tainting the canvas.
  const BASES = [
    (v) => `https://assets.mcasset.cloud/${v}/assets/minecraft/textures`,
  ];

  const cache = new Map();   // cacheKey -> canvas | "pending" | "failed"
  const listeners = [];

  // Grayscale foliage/grass textures that need a biome tint to look right.
  const TINTS = {
    short_grass: "#7cbd6b", tall_grass: "#7cbd6b", grass: "#7cbd6b",
    fern: "#7cbd6b", large_fern: "#7cbd6b", vine: "#48b518",
    oak_leaves: "#48b518", jungle_leaves: "#48b518", acacia_leaves: "#5ca328",
    dark_oak_leaves: "#48b518", mangrove_leaves: "#48b518",
    lily_pad: "#208030", melon_stem: "#5ca328", pumpkin_stem: "#5ca328",
    attached_melon_stem: "#5ca328", attached_pumpkin_stem: "#5ca328",
    grass_block_top: "#7cbd6b", sugar_cane: "#7cbd6b",
  };

  const COLOR_KEYWORDS = [
    ["cactus", "#5b8f2f"], ["short_grass", "#6fa841"], ["tall_grass", "#6fa841"],
    ["fern", "#4f8f2e"], ["dead_bush", "#946428"], ["bush", "#7a8f3a"],
    ["petals", "#e89ac0"], ["blossom", "#d96fb8"], ["wheat", "#d5b962"],
    ["sand", "#dbd3a0"], ["dirt", "#8a5a3b"], ["stone", "#8a8a8a"],
    ["log", "#6a4f30"], ["wood", "#8a6a42"], ["oak", "#8a6a42"],
    ["leaves", "#3e7a26"], ["berries", "#b03030"], ["berry", "#b03030"],
    ["flower", "#d04040"], ["rose", "#d04060"], ["tulip", "#d05a5a"],
    ["stem", "#5ca328"], // gourd stems are green - must precede melon/pumpkin
    ["bamboo", "#7aa53a"], ["kelp", "#3e8a5a"], ["melon", "#6fae3a"],
    ["pumpkin", "#d98a2b"], ["mushroom", "#b08060"], ["nether_wart", "#8a2a2a"],
    ["amethyst", "#9a6fd0"], ["coral", "#e06a8a"], ["vine", "#4a8a3a"],
    ["sugar_cane", "#9ac46a"], ["carrot", "#e8902a"], ["potato", "#cfa050"],
    ["beetroot", "#a8303a"], ["sweet", "#b03030"], ["seagrass", "#3e8a5a"],
    ["moss", "#5a8a3a"], ["azalea", "#5a9a4a"], ["dripleaf", "#4a9a5a"],
    ["seeds", "#a8c46a"], ["paper", "#e8e4d8"], ["water", "#3b6ad4"],
    ["lava", "#e25822"], ["magma", "#a02818"],
  ];

  function clean(name) {
    return String(name || "").toLowerCase().trim()
      .replace(/^minecraft:/, "")
      .replace(/\[[^\]]*\]\s*$/, ""); // strip block-state props: wheat[age=7] -> wheat
  }

  // Vanilla plant blocks that render as flat planes instead of cubes, with
  // per-age stage textures. "hash" = the # pattern of the vanilla crop model,
  // "cross" = two diagonal planes. stages[] maps block age -> texture index.
  // "tex" overrides the texture (blocks with one texture for every age);
  // "grows" scales the plane height by age, like the vanilla stem models.
  const PLANT_BLOCKS = {
    wheat:            { shape: "hash",  stages: [0, 1, 2, 3, 4, 5, 6, 7] },
    carrots:          { shape: "hash",  stages: [0, 0, 1, 1, 2, 2, 2, 3] },
    potatoes:         { shape: "hash",  stages: [0, 0, 1, 1, 2, 2, 2, 3] },
    beetroots:        { shape: "hash",  stages: [0, 1, 2, 3] },
    nether_wart:      { shape: "hash",  stages: [0, 1, 1, 2] },
    sweet_berry_bush: { shape: "cross", stages: [0, 1, 2, 3] },
    // Gourd stems are a tinted X whose single texture grows in height with
    // age; attached stems (after a fruit forms) use their own texture.
    pumpkin_stem:          { shape: "cross", stages: [0, 1, 2, 3, 4, 5, 6, 7], tex: "pumpkin_stem", grows: true },
    melon_stem:            { shape: "cross", stages: [0, 1, 2, 3, 4, 5, 6, 7], tex: "melon_stem", grows: true },
    attached_pumpkin_stem: { shape: "cross", stages: [0], tex: "attached_pumpkin_stem" },
    attached_melon_stem:   { shape: "cross", stages: [0], tex: "attached_melon_stem" },
  };

  // Ageless vanilla blocks whose model is the crossed-diagonal-planes X shape
  // (rendered flat in-game, never as a cube): saplings, flowers, grasses,
  // bushes, corals, mushrooms, roots... Matched by suffix or exact name.
  const CROSS_SUFFIXES = [
    "_sapling", "_fungus", "_roots", "_coral", "_coral_fan", "_coral_wall_fan",
    "_tulip", "_vines", "_propagule", "_bush", "_flower",
  ];
  const CROSS_BLOCKS = new Set([
    "short_grass", "tall_grass", "grass", "fern", "large_fern", "bush",
    "short_dry_grass", "tall_dry_grass", "dandelion", "poppy", "allium",
    "azure_bluet", "oxeye_daisy", "cornflower", "lily_of_the_valley",
    "wither_rose", "torchflower", "open_eyeblossom", "closed_eyeblossom",
    "red_mushroom", "brown_mushroom", "sugar_cane", "kelp", "kelp_plant",
    "nether_sprouts", "cobweb", "sunflower", "lilac", "rose_bush", "peony",
  ]);
  // Ageless blocks whose model is the four-plane # instead: the seagrasses
  // use block/template_seagrass (planes at x/z = 4 and 12), not block/cross.
  const HASH_BLOCKS = new Set(["seagrass", "tall_seagrass"]);
  // blocks a CROSS_SUFFIXES match would misclassify (they have real models)
  const NOT_CROSS = new Set(["chorus_flower", "spore_blossom"]);
  /** "cross" | "hash" for ageless flat-plane blocks, else null. */
  function plantShape(n) {
    if (HASH_BLOCKS.has(n)) return "hash";
    if (NOT_CROSS.has(n)) return null;
    if (CROSS_BLOCKS.has(n) || CROSS_SUFFIXES.some(s => n.endsWith(s))) return "cross";
    return null;
  }

  /**
   * Parses a block string that may carry state properties, e.g. "WHEAT[age=7]".
   * Returns { shape, tex, block, age, h } for plant/cross blocks, else null
   * (h = plane height fraction; below 1 only for growing stems).
   * Age defaults to 0, matching the plugin (createBlockData's default state).
   */
  function cropState(name) {
    const raw = String(name || "").toLowerCase().trim().replace(/^minecraft:/, "");
    const m = raw.match(/^([a-z0-9_]+)\s*(?:\[([^\]]*)\])?$/);
    if (!m) return null;
    const base = m[1];
    const def = PLANT_BLOCKS[base];
    if (!def) {
      const shape = plantShape(base);
      if (!shape) return null;
      // wall fans share the regular fan's texture
      return { shape, tex: base.replace(/_wall_fan$/, "_fan"), block: base, age: 0, h: 1 };
    }
    const props = {};
    if (m[2]) {
      for (const kv of m[2].split(",")) {
        const [k, v] = kv.split("=").map(s => (s || "").trim());
        if (k) props[k] = v;
      }
    }
    let age = parseInt(props.age, 10);
    if (isNaN(age)) age = 0;
    age = Math.max(0, Math.min(age, def.stages.length - 1));
    return {
      shape: def.shape,
      tex: def.tex || `${base}_stage${def.stages[age]}`,
      block: base, age,
      h: def.grows ? (age + 1) / def.stages.length : 1,
    };
  }

  /** Representative sprite for any block string, including plant states.
   *  The _top fallback covers two-tall plants (tall_grass, lilac, ...). */
  function blockSprite(name) {
    const cs = cropState(name);
    if (cs) return loadFirst(`plant:${cs.tex}`, [`block/${cs.tex}.png`, `block/${cs.tex}_top.png`], cs.tex);
    return block(name, "side");
  }

  // ── player head skins (custom-textured heads) ─────────────────────────────

  const headCache = new Map(); // skin url -> {front,back,...} | "pending" | "failed"

  /** Skin URL from a head texture string: a URL as-is, or decoded from the
   * base64 "textures" property value used by configs/minecraft-heads. */
  function skinUrlFrom(texture) {
    const t = String(texture || "").trim();
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return t;
    try {
      const json = JSON.parse(atob(t));
      const url = json && json.textures && json.textures.SKIN && json.textures.SKIN.url;
      return url || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * The six 8x8 face canvases of a head skin (with the hat overlay baked in),
   * or null while loading / unresolvable. Skins load WITHOUT crossOrigin -
   * skin hosts rarely send CORS headers; the canvas becomes write-only,
   * which is fine since the preview only draws and never reads pixels back.
   */
  function headCube(texture) {
    const url = skinUrlFrom(texture);
    if (!url) return null;
    const cached = headCache.get(url);
    if (cached && cached !== "pending" && cached !== "failed") return cached;
    if (cached) return null;
    headCache.set(url, "pending");
    const img = new Image();
    img.onload = () => {
      const scale = img.width / 64;
      const cut = (x, y) => {
        const c = document.createElement("canvas");
        c.width = 8; c.height = 8;
        const g = c.getContext("2d");
        g.imageSmoothingEnabled = false;
        g.drawImage(img, x * scale * 8, y * scale * 8, 8 * scale, 8 * scale, 0, 0, 8, 8);
        g.drawImage(img, (x + 4) * scale * 8, y * scale * 8, 8 * scale, 8 * scale, 0, 0, 8, 8); // hat
        return c;
      };
      // skin head regions in 8px units: front(1,1) right(0,1) left(2,1)
      // back(3,1) top(1,0) bottom(2,0); hat overlay is +4 units on x.
      headCache.set(url, {
        front: cut(1, 1), right: cut(0, 1), left: cut(2, 1),
        back: cut(3, 1), top: cut(1, 0), bottom: cut(2, 0),
      });
      notify();
    };
    img.onerror = () => { headCache.set(url, "failed"); };
    img.src = url;
    return null;
  }

  /** Just the (hat-merged) face of a head texture - for chips and swatches. */
  function headFace(texture) {
    const cube = headCube(texture);
    return cube ? cube.front : null;
  }

  function colorFor(name) {
    const n = clean(name);
    for (const [kw, color] of COLOR_KEYWORDS) {
      if (n.includes(kw)) return color;
    }
    let hash = 0;
    for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) | 0;
    return `hsl(${Math.abs(hash) % 360}, 45%, 55%)`;
  }

  function onReady(cb) { listeners.push(cb); }
  function notify() { for (const cb of listeners) cb(); }

  /** Paints one frame of a (possibly multi-frame) texture onto a square
   *  canvas, applying a multiply tint for grayscale foliage textures. */
  function paintFrame(out, img, frame, size, tintColor) {
    const sy = frame * size;
    const c = out.getContext("2d");
    c.imageSmoothingEnabled = false;
    c.globalCompositeOperation = "copy";
    c.drawImage(img, 0, sy, size, size, 0, 0, size, size);
    if (tintColor) {
      c.globalCompositeOperation = "multiply";
      c.fillStyle = tintColor;
      c.fillRect(0, 0, size, size);
      c.globalCompositeOperation = "destination-in";
      c.drawImage(img, 0, sy, size, size, 0, 0, size, size);
    }
    c.globalCompositeOperation = "source-over";
  }

  // ── animated textures (.mcmeta frame strips) ──────────────────────────────

  // Vanilla animates some textures - seagrass, kelp, fire, water... - by
  // stacking square frames vertically in one PNG, with a sibling
  // "<texture>.png.mcmeta" declaring the frame order and frametime (in ticks).
  // The client always plays these, so previews do too. Callers hold the sprite
  // canvas itself, so a frame change repaints that same canvas in place and
  // notifies listeners to redraw. Frame interpolation is not simulated.
  const TICK_MS = 50;
  const strips = [];   // {canvas, img, tint, size, order, times, period, frame}
  let stripTimer = null;
  let tick = 0;

  const metaCache = new Map(); // url -> Promise<json|null>
  function fetchMeta(url) {
    if (!metaCache.has(url)) {
      metaCache.set(url, (async () => {
        try {
          const res = await fetch(url);
          return res.ok ? await res.json() : null;
        } catch (e) { return null; }
      })());
    }
    return metaCache.get(url);
  }

  /** Per-frame playlist from an .mcmeta animation block: an explicit `frames`
   *  list (plain indices or {index,time} objects) or every frame in order,
   *  each held for its own `time` or the animation's `frametime` (default 1). */
  function playlist(anim, count) {
    const base = anim.frametime > 0 ? anim.frametime : 1;
    const order = [], times = [];
    const push = (index, time) => {
      order.push(Math.max(0, Math.min(index | 0, count - 1)));
      times.push(time > 0 ? time : base);
    };
    if (Array.isArray(anim.frames) && anim.frames.length) {
      for (const f of anim.frames) {
        if (typeof f === "number") push(f, base);
        else if (f && typeof f === "object") push(f.index, f.time);
      }
    } else {
      for (let i = 0; i < count; i++) push(i, base);
    }
    return { order, times, period: times.reduce((a, b) => a + b, 0) };
  }

  /** Registers a frame-strip sprite for playback if its .mcmeta says it
   *  animates. Strips without one (or with no animation block) stay on
   *  frame 0 - a tall texture is not animated by itself. */
  async function animate(canvas, img, tint, size, count, url) {
    const meta = await fetchMeta(`${url}.mcmeta`);
    const anim = meta && meta.animation;
    if (!anim || typeof anim !== "object") return;
    const { order, times, period } = playlist(anim, count);
    if (order.length < 2 || period <= 0) return;
    strips.push({ canvas, img, tint, size, order, times, period, frame: -1 });
    if (!stripTimer) stripTimer = setInterval(step, TICK_MS);
  }

  /** One game tick: repaints every strip whose frame changed, then redraws. */
  function step() {
    tick++;
    let changed = false;
    for (const s of strips) {
      let t = tick % s.period, i = 0;
      while (t >= s.times[i]) t -= s.times[i++];
      if (i === s.frame) continue;
      s.frame = i;
      paintFrame(s.canvas, s.img, s.order[i], s.size, s.tint);
      changed = true;
    }
    if (changed) notify();
  }

  /** Square sprite canvas for a loaded texture image, animated if it is a
   *  frame strip with an .mcmeta animation. */
  function sprite(img, tint, url) {
    const size = img.width;
    const out = document.createElement("canvas");
    out.width = size; out.height = size;
    paintFrame(out, img, 0, size, tint);
    const count = size > 0 && img.height % size === 0 ? img.height / size : 0;
    if (count > 1) animate(out, img, tint, size, count, url);
    return out;
  }

  function loadFirst(key, candidates, tintName) {
    const cached = cache.get(key);
    if (cached === "pending") return null;
    if (cached === "failed") return null;
    if (cached) return cached;
    cache.set(key, "pending");

    // Full URL cascade: newest version first, every path candidate within
    // it. First successful load wins; if a texture doesn't exist for the
    // current game version, we fall back to the older versions automatically.
    const urls = [];
    for (const version of VERSIONS) {
      for (const base of BASES) {
        for (const path of candidates) urls.push(`${base(version)}/${path}`);
      }
    }

    let i = 0;
    const tryNext = () => {
      if (i >= urls.length) { cache.set(key, "failed"); return; }
      const url = urls[i];
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          cache.set(key, sprite(img, TINTS[clean(tintName)] || null, url));
        } catch (e) {
          cache.set(key, "failed");
        }
        notify();
      };
      img.onerror = () => { i++; tryNext(); };
      img.src = url;
    };
    tryNext();
    return null;
  }

  // ── vanilla block models (non-cube shapes) ─────────────────────────────────

  const MODEL_BASES = [
    (v) => `https://assets.mcasset.cloud/${v}/assets/minecraft/models`,
    (v) => `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/${v}/assets/minecraft/models`,
  ];

  const jsonCache = new Map();  // model path -> Promise<json|null>
  const modelCache = new Map(); // block name -> {elements,textures} | "pending" | "failed"

  /** Fetches a model JSON (e.g. "block/cactus.json") through the version cascade. */
  function fetchModelJson(rel) {
    if (!jsonCache.has(rel)) {
      jsonCache.set(rel, (async () => {
        for (const version of VERSIONS) {
          for (const base of MODEL_BASES) {
            try {
              const res = await fetch(`${base(version)}/${rel}`);
              if (res.ok) return await res.json();
            } catch (e) { /* next mirror */ }
          }
        }
        return null;
      })());
    }
    return jsonCache.get(rel);
  }

  /**
   * Resolves a block model's parent chain into { elements, textures }:
   * child texture entries override the parent's, the child-most `elements`
   * wins (vanilla semantics). Returns null for models with no geometry
   * (builtin/*, missing files) - callers fall back to a plain cube.
   */
  async function resolveModel(name) {
    const chain = [];
    let m = await fetchModelJson(`block/${name}.json`);
    while (m) {
      chain.push(m);
      const parent = m.parent && clean(m.parent); // keeps its folder, e.g. "block/cube_column"
      if (!parent || parent.startsWith("builtin")) break;
      m = await fetchModelJson(`${parent}.json`);
    }
    const textures = {};
    for (let i = chain.length - 1; i >= 0; i--) Object.assign(textures, chain[i].textures || {});
    const withEls = chain.find(c => c.elements);
    return withEls ? { elements: withEls.elements, textures } : null;
  }

  // Block entities (chests, ...) have no JSON geometry; hand-built models in
  // the same format. uv is in 0..16 model space over the 64x64 entity texture
  // (texture px / 4). Lid+base match ChestRenderer's cuboids; latch omitted.
  function chestModel(tex) {
    const lid = { from: [1, 9, 1], to: [15, 14, 15], faces: {
      up:    { texture: "#0", uv: [3.5, 0, 7, 3.5] },
      down:  { texture: "#0", uv: [7, 0, 10.5, 3.5] },
      north: { texture: "#0", uv: [3.5, 3.5, 7, 4.75] },
      south: { texture: "#0", uv: [10.5, 3.5, 14, 4.75] },
      west:  { texture: "#0", uv: [0, 3.5, 3.5, 4.75] },
      east:  { texture: "#0", uv: [7, 3.5, 10.5, 4.75] },
    } };
    const base = { from: [1, 0, 1], to: [15, 10, 15], faces: {
      up:    { texture: "#0", uv: [3.5, 4.75, 7, 8.25] },
      down:  { texture: "#0", uv: [7, 4.75, 10.5, 8.25] },
      north: { texture: "#0", uv: [3.5, 8.25, 7, 10.75] },
      south: { texture: "#0", uv: [10.5, 8.25, 14, 10.75] },
      west:  { texture: "#0", uv: [0, 8.25, 3.5, 10.75] },
      east:  { texture: "#0", uv: [7, 8.25, 10.5, 10.75] },
    } };
    return { elements: [lid, base], textures: { 0: `entity/chest/${tex}` } };
  }
  const ENTITY_MODELS = {
    chest: chestModel("normal"),
    trapped_chest: chestModel("trapped"),
    ender_chest: chestModel("ender"),
  };

  /**
   * Merges resolved models (elements + textures) into one, renaming each
   * source's texture variables (e.g. "0" -> "m0_0") so same-named keys from
   * different models don't collide. Inputs are never mutated (their
   * elements/textures stay cached as-is for reuse standalone).
   */
  function mergeModels(models) {
    const elements = [], textures = {};
    models.forEach((m, i) => {
      const remap = {};
      for (const [k, v] of Object.entries(m.textures)) {
        const nk = `m${i}_${k}`;
        remap[k] = nk;
        textures[nk] = v;
      }
      for (const el of m.elements) {
        const el2 = JSON.parse(JSON.stringify(el));
        for (const dir in el2.faces || {}) {
          const f = el2.faces[dir];
          if (f.texture && f.texture[0] === "#" && remap[f.texture.slice(1)]) {
            f.texture = "#" + remap[f.texture.slice(1)];
          }
        }
        elements.push(el2);
      }
    });
    return { elements, textures };
  }

  // Bamboo's blockstate is multipart with no plain "block/bamboo.json" file:
  // the real geometry is a stalk (age 0 = thin, age 1 = thick) optionally
  // layered with a leaf-cluster cross-plane (leaves small/large). Default
  // props (age=0, no leaves) match the plugin's createBlockData() state, per
  // the same convention as cropState()'s age default below.
  const BAMBOO_AGES = ["0", "1"];
  const BAMBOO_LEAVES = ["small", "large"];

  function bambooModelFiles(props) {
    const age = props.age === "1" ? "1" : "0";
    const files = [`bamboo1_age${age}`];
    if (BAMBOO_LEAVES.includes(props.leaves)) files.push(`bamboo_${props.leaves}_leaves`);
    return files;
  }

  // Candle blocks (uncolored + 16 dye colors) are also blockstate `variants`
  // with no plain "block/<color>_candle.json" file - real names encode the
  // clustered candle count in words and a "_lit" suffix, e.g.
  // "white_candle_three_candles_lit". Default props (candles=1, unlit) match
  // the default block state. candle_cake/<color>_candle_cake are unaffected:
  // their real file is just their own name (+ "_lit"), same as any plain
  // block, so they already render fine via the non-stateful path below.
  const CANDLE_COLORS = ["", "white_", "orange_", "magenta_", "light_blue_", "yellow_",
    "lime_", "pink_", "gray_", "light_gray_", "cyan_", "purple_", "blue_", "brown_",
    "green_", "red_", "black_"];
  const CANDLE_COUNT_WORDS = { 1: "one", 2: "two", 3: "three", 4: "four" };

  function isCandleBlock(block) {
    return block === "candle" || (block.endsWith("_candle") && CANDLE_COLORS.includes(block.slice(0, -6)));
  }

  function candleModelFiles(block, props) {
    const prefix = block === "candle" ? "" : block.slice(0, -"candle".length);
    const count = CANDLE_COUNT_WORDS[props.candles] ? +props.candles : 1;
    const lit = props.lit === "true";
    return [`${prefix}candle_${CANDLE_COUNT_WORDS[count]}_candle${count > 1 ? "s" : ""}${lit ? "_lit" : ""}`];
  }

  /** Maps (block, parsed props) to the real vanilla model file name(s) to
   *  fetch+merge, for blocks whose blockstate has no plain
   *  "block/<name>.json" file. Returns null for anything else, so the
   *  caller falls back to fetching "block/<name>.json" as-is. */
  function statefulModelFiles(block, props) {
    if (block === "bamboo") return bambooModelFiles(props);
    if (isCandleBlock(block)) return candleModelFiles(block, props);
    return null;
  }

  /** Every enumerable "<block>[prop=value,...]" state string across all
   *  blocks whose model actually changes with state - single source of
   *  truth for the key-picker's suggestion list, kept in sync with what
   *  cropState()/blockModel() can actually render differently. */
  function stateVariants() {
    const out = [];
    for (const [name, def] of Object.entries(PLANT_BLOCKS)) {
      if (def.stages.length <= 1) continue; // no real "age" property (e.g. attached stems)
      for (let age = 0; age < def.stages.length; age++) out.push(`${name}[age=${age}]`);
    }
    for (const age of BAMBOO_AGES) {
      out.push(`bamboo[age=${age}]`);
      for (const leaves of BAMBOO_LEAVES) out.push(`bamboo[age=${age},leaves=${leaves}]`);
    }
    for (const colorPrefix of CANDLE_COLORS) {
      const name = `${colorPrefix}candle`;
      for (let count = 1; count <= 4; count++) {
        out.push(`${name}[candles=${count}]`);
        out.push(`${name}[candles=${count},lit=true]`);
      }
    }
    return out;
  }

  /** Parses "name[k=v,...]" into { block, props }, or null. Shared shape
   *  with cropState()'s parser, kept separate since callers need it before
   *  clean() would strip the state off. */
  function parseState(raw) {
    const m = String(raw || "").toLowerCase().trim().replace(/^minecraft:/, "")
      .match(/^([a-z0-9_]+)\s*(?:\[([^\]]*)\])?$/);
    if (!m) return null;
    const props = {};
    if (m[2]) for (const kv of m[2].split(",")) {
      const [k, v] = kv.split("=").map(s => (s || "").trim());
      if (k) props[k] = v;
    }
    return { block: m[1], props };
  }

  /**
   * Resolved vanilla model geometry for a block, or null while loading /
   * for blocks that stay a plain cube (no model, builtin geometry).
   * Async under the hood; onReady fires when a model arrives.
   */
  function blockModel(name) {
    const parsed = parseState(name);
    if (!parsed || !parsed.block) return null;
    const { block, props } = parsed;
    if (ENTITY_MODELS[block]) return ENTITY_MODELS[block];
    const statefulFiles = statefulModelFiles(block, props);
    // States change these blocks' geometry, so they cache per exact prop set
    // (order-independent); other blocks ignore state today and cache per
    // bare name. clean(name) would strip the "[...]" back off, colliding
    // every variant onto one cache entry - build the key from the parsed
    // props instead.
    const cacheKey = statefulFiles
      ? `${block}[${Object.keys(props).sort().map(k => `${k}=${props[k]}`).join(",")}]`
      : block;
    const cached = modelCache.get(cacheKey);
    if (cached && cached !== "pending" && cached !== "failed") return cached;
    if (cached) return null;
    modelCache.set(cacheKey, "pending");
    const files = statefulFiles || [block];
    Promise.all(files.map(resolveModel))
      .then(models => {
        const resolved = models.filter(Boolean);
        const merged = resolved.length ? mergeModels(resolved) : null;
        modelCache.set(cacheKey, merged || "failed");
        if (merged) notify();
      })
      .catch(() => modelCache.set(cacheKey, "failed"));
    return null;
  }

  /** Texture canvas for a model face ref ("#side", "side", or a direct path),
   *  or null. Some vanilla files omit the "#", so any ref naming a texture
   *  key resolves as a variable. */
  function modelTexture(model, ref) {
    let r = ref, guard = 0;
    while (r && guard++ < 8) {
      const next = model.textures[r[0] === "#" ? r.slice(1) : r];
      if (next === undefined || next === r) break;
      r = next;
    }
    if (!r || r[0] === "#") return null; // unresolved variable
    const p = clean(r);
    return loadFirst(`mtex:${p}`, [`${p}.png`], p.split("/").pop());
  }

  // ── sprite edge runs (item model extrusion side faces) ────────────────────

  const edgeCache = new WeakMap(); // texture canvas -> runs

  /**
   * Boundary runs of a sprite's opaque pixels, for building the extruded
   * side faces of a generated item model (in-game items are 1 texture pixel
   * deep; each side face shows the edge pixels' colors).
   *
   * Returns { left, right, top, bottom } where left/right entries are
   * { u, v0, v1, col } (vertical boundary at texture x=u spanning rows
   * v0..v1, textured from column col) and top/bottom entries are
   * { v, u0, u1, row }. Computed once per texture and cached; returns null
   * for unreadable (tainted) canvases.
   */
  function edgeRuns(tex) {
    let runs = edgeCache.get(tex);
    if (runs !== undefined) return runs;
    try {
      const w = tex.width, h = tex.height;
      const a = tex.getContext("2d").getImageData(0, 0, w, h).data;
      const solid = (x, y) => x >= 0 && x < w && y >= 0 && y < h && a[(y * w + x) * 4 + 3] > 8;
      runs = { left: [], right: [], top: [], bottom: [] };
      // vertical boundaries, merged along y
      for (let x = 0; x < w; x++) {
        let l = null, r = null;
        for (let y = 0; y <= h; y++) {
          const el = y < h && solid(x, y) && !solid(x - 1, y);
          const er = y < h && solid(x, y) && !solid(x + 1, y);
          if (el) { if (l) l.v1 = y + 1; else l = { u: x, v0: y, v1: y + 1, col: x }; }
          else if (l) { runs.left.push(l); l = null; }
          if (er) { if (r) r.v1 = y + 1; else r = { u: x + 1, v0: y, v1: y + 1, col: x }; }
          else if (r) { runs.right.push(r); r = null; }
        }
      }
      // horizontal boundaries, merged along x
      for (let y = 0; y < h; y++) {
        let t = null, b = null;
        for (let x = 0; x <= w; x++) {
          const et = x < w && solid(x, y) && !solid(x, y - 1);
          const eb = x < w && solid(x, y) && !solid(x, y + 1);
          if (et) { if (t) t.u1 = x + 1; else t = { v: y, u0: x, u1: x + 1, row: y }; }
          else if (t) { runs.top.push(t); t = null; }
          if (eb) { if (b) b.u1 = x + 1; else b = { v: y + 1, u0: x, u1: x + 1, row: y }; }
          else if (b) { runs.bottom.push(b); b = null; }
        }
      }
    } catch (e) {
      runs = null; // tainted canvas - caller falls back to plain planes
    }
    edgeCache.set(tex, runs);
    return runs;
  }

  /** Item model texture: tries item/, then block/ (many "items" are block sprites). */
  function item(name) {
    const n = clean(name);
    if (!n) return null;
    return loadFirst(`item:${n}`, [`item/${n}.png`, `block/${n}.png`], n);
  }

  /** Block face texture with the usual _top/_side/_bottom fallbacks. */
  function block(name, face) {
    const n = clean(name);
    if (!n) return null;
    const candidates = face === "top"
      ? [`block/${n}_top.png`, `block/${n}.png`, `block/${n}_side.png`]
      : face === "bottom"
        ? [`block/${n}_bottom.png`, `block/${n}_top.png`, `block/${n}.png`]
        : [`block/${n}_side.png`, `block/${n}.png`, `block/${n}_top.png`];
    // Vanilla's grass top is grayscale and receives a biome tint in-game.
    // Side/bottom faces do not share that tint, so choose it per face rather
    // than tinting the entire grass block (which produced the gray preview
    // surface visible in the seed playback).
    const tintName = face === "top" && TINTS[`${n}_top`] ? `${n}_top` : n;
    return loadFirst(`block:${n}:${face}`, candidates, tintName);
  }

  return { item, block, blockSprite, blockModel, modelTexture, cropState, stateVariants, headCube, headFace, edgeRuns, onReady, colorFor, clean };
})();
