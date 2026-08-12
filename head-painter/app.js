/**
 * Head Painter - paint the six faces of a player head plus its hat overlay,
 * and turn the result into the base64 "textures" value C4 configs use.
 *
 * A texture value is base64 of {"textures":{"SKIN":{"url":"..."}}} - a link to
 * a skin hosted by Mojang, never the pixels themselves, and the vanilla client
 * only loads skin URLs under minecraft.net / mojang.com. So painting is local
 * and instant, but producing a value means uploading the PNG to MineSkin, which
 * puts it on Mojang's texture server and hands the value back. The PNG itself
 * loads from and saves to disk directly, needing no network at all.
 *
 * The whole model is one 64x64 canvas holding the entire skin. Net cells map to
 * rectangles inside it, which keeps export a straight copy and means the body
 * pixels of an imported skin survive a round trip untouched.
 */
(() => {
  "use strict";

  // ── skin geometry ────────────────────────────────────────────────────────
  //
  // Head face origins inside the 64x64 skin, in pixels. The hat overlay is the
  // same six rectangles shifted 32px right.

  const FACE_UV = {
    top: [8, 0], bottom: [16, 0],
    right: [0, 8], front: [8, 8], left: [16, 8], back: [24, 8],
  };
  const HAT_DX = 32;
  const FACE = 8;

  /** Net layout: the conventional cross, top over the side row over bottom. */
  const NET = [
    { face: "top", col: 1, row: 0 },
    { face: "right", col: 0, row: 1 },
    { face: "front", col: 1, row: 1 },
    { face: "left", col: 2, row: 1 },
    { face: "back", col: 3, row: 1 },
    { face: "bottom", col: 1, row: 2 },
  ];
  const NET_COLS = 4, NET_ROWS = 3;

  const MINESKIN_API = "https://api.mineskin.org/v2";
  const USER_AGENT = "C4-HeadPainter/1.0";
  const TEXTURE_HOST = "http://textures.minecraft.net/texture/";
  const DEFAULT_COLOR = "#8B8B8B";
  const UNDO_LIMIT = 80;
  const STORE = { key: "c4.headpainter.key", skin: "c4.headpainter.skin", meta: "c4.headpainter.meta" };

  // ── state ────────────────────────────────────────────────────────────────

  const skin = document.createElement("canvas");
  skin.width = 64; skin.height = 64;
  const sctx = skin.getContext("2d", { willReadFrequently: true });
  sctx.imageSmoothingEnabled = false;

  const state = {
    tool: "pencil",
    layer: "base",
    color: [0x8b, 0x8b, 0x8b],
    alpha: 255,
    zoom: 16,
    grid: true,
    mirror: false,
    hatVisible: true,
    recent: [],
    // Positive pitch tips the top toward the camera, so the head opens at a
    // three-quarter view from slightly above.
    yaw: -0.5, pitch: 0.35, dist: 1,
    spinning: false,
  };

  /** Snapshots of the whole 64x64 skin. `idx` is the state on screen. */
  const hist = { steps: [], idx: -1 };

  const $ = (id) => document.getElementById(id);
  const netCanvas = $("net"), nctx = netCanvas.getContext("2d");
  const preview = $("preview"), pctx = preview.getContext("2d");

  // ── coordinate mapping ───────────────────────────────────────────────────

  /** Pixel origin of a face in the skin for the given layer. */
  function faceOrigin(face, layer) {
    const [x, y] = FACE_UV[face];
    return [x + (layer === "hat" ? HAT_DX : 0), y];
  }

  /** Layout of the net canvas at the current zoom, in canvas pixels. */
  function netLayout() {
    const z = state.zoom;
    const cell = FACE * z;
    const gap = Math.max(10, Math.round(z * 0.9));
    const padX = 8, padTop = 16, padBottom = 8;
    return {
      z, cell, gap, padX, padTop,
      width: NET_COLS * cell + (NET_COLS - 1) * gap + padX * 2,
      height: NET_ROWS * cell + (NET_ROWS - 1) * gap + padTop + padBottom,
      cellX: (col) => padX + col * (cell + gap),
      cellY: (row) => padTop + row * (cell + gap),
    };
  }

  /** Canvas point -> {face, lx, ly} inside a face, or null when between cells. */
  function hitNet(px, py) {
    const L = netLayout();
    for (const c of NET) {
      const x0 = L.cellX(c.col), y0 = L.cellY(c.row);
      if (px < x0 || py < y0 || px >= x0 + L.cell || py >= y0 + L.cell) continue;
      return {
        face: c.face,
        lx: Math.min(FACE - 1, Math.floor((px - x0) / L.z)),
        ly: Math.min(FACE - 1, Math.floor((py - y0) / L.z)),
      };
    }
    return null;
  }

  /** Pointer event -> net canvas coordinates (the canvas is CSS-scaled). */
  function eventToCanvas(e, canvas) {
    const r = canvas.getBoundingClientRect();
    return [
      (e.clientX - r.left) * (canvas.width / r.width),
      (e.clientY - r.top) * (canvas.height / r.height),
    ];
  }

  // ── pixel access ─────────────────────────────────────────────────────────

  function readPixel(face, layer, lx, ly) {
    const [ox, oy] = faceOrigin(face, layer);
    return sctx.getImageData(ox + lx, oy + ly, 1, 1).data;
  }

  /** @returns {boolean} whether the pixel actually changed. */
  function writePixel(face, layer, lx, ly, rgba) {
    const [ox, oy] = faceOrigin(face, layer);
    const was = sctx.getImageData(ox + lx, oy + ly, 1, 1);
    const d = was.data;
    if (d[0] === rgba[0] && d[1] === rgba[1] && d[2] === rgba[2] && d[3] === rgba[3]) return false;
    const img = sctx.createImageData(1, 1);
    img.data.set(rgba);
    sctx.putImageData(img, ox + lx, oy + ly);
    return true;
  }

  /** Flood fill the matching region, bounded to this one 8x8 face.
   *  @returns {boolean} whether any pixel changed. */
  function floodFill(face, layer, lx, ly, rgba) {
    const [ox, oy] = faceOrigin(face, layer);
    const img = sctx.getImageData(ox, oy, FACE, FACE);
    const d = img.data;
    const at = (x, y) => (y * FACE + x) * 4;
    const start = at(lx, ly);
    const target = [d[start], d[start + 1], d[start + 2], d[start + 3]];
    const same = (i) => d[i] === target[0] && d[i + 1] === target[1]
      && d[i + 2] === target[2] && d[i + 3] === target[3];
    if (target[0] === rgba[0] && target[1] === rgba[1]
      && target[2] === rgba[2] && target[3] === rgba[3]) return false;
    const queue = [[lx, ly]];
    while (queue.length) {
      const [x, y] = queue.pop();
      if (x < 0 || y < 0 || x >= FACE || y >= FACE) continue;
      const i = at(x, y);
      if (!same(i)) continue;
      d[i] = rgba[0]; d[i + 1] = rgba[1]; d[i + 2] = rgba[2]; d[i + 3] = rgba[3];
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    sctx.putImageData(img, ox, oy);
    return true;
  }

  // ── painting ─────────────────────────────────────────────────────────────

  /** Effective tool for this event: Alt picks, Ctrl and right-click erase. */
  function effectiveTool(e) {
    if (e.altKey) return "picker";
    if (e.ctrlKey || e.button === 2 || e.buttons === 2) return "eraser";
    return state.tool;
  }

  function currentRgba(tool) {
    if (tool === "eraser") return [0, 0, 0, 0];
    return [state.color[0], state.color[1], state.color[2], state.alpha];
  }

  function applyAt(hit, tool) {
    if (!hit) return false;
    if (tool === "picker") {
      const p = readPixel(hit.face, state.layer, hit.lx, hit.ly);
      setColor([p[0], p[1], p[2]], p[3]);
      return false;
    }
    const rgba = currentRgba(tool);
    const paint = tool === "fill" ? floodFill : writePixel;
    let changed = paint(hit.face, state.layer, hit.lx, hit.ly, rgba);
    if (state.mirror) {
      changed = paint(hit.face, state.layer, FACE - 1 - hit.lx, hit.ly, rgba) || changed;
    }
    if (tool !== "eraser") rememberColor(rgba);
    return changed;
  }

  /** Fast drags skip pixels, so walk the line between samples (Bresenham). */
  function applyLine(from, to, tool) {
    if (!from || from.face !== to.face) return applyAt(to, tool);
    let x0 = from.lx, y0 = from.ly;
    const x1 = to.lx, y1 = to.ly;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, changed = false;
    for (;;) {
      changed = applyAt({ face: to.face, lx: x0, ly: y0 }, tool) || changed;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return changed;
  }

  let stroke = null;

  netCanvas.addEventListener("contextmenu", (e) => e.preventDefault());

  netCanvas.addEventListener("pointerdown", (e) => {
    const hit = hitNet(...eventToCanvas(e, netCanvas));
    if (!hit) return;
    const tool = effectiveTool(e);
    if (tool === "picker") { applyAt(hit, tool); return; }
    netCanvas.setPointerCapture(e.pointerId);
    stroke = { tool, last: hit, dirty: false };
    stroke.dirty = applyAt(hit, tool);
    repaint();
    e.preventDefault();
  });

  netCanvas.addEventListener("pointermove", (e) => {
    const pt = eventToCanvas(e, netCanvas);
    const hit = hitNet(...pt);
    showReadout(hit);
    if (!stroke) return;
    if (hit) {
      stroke.dirty = applyLine(stroke.last, hit, stroke.tool) || stroke.dirty;
      stroke.last = hit;
    } else {
      stroke.last = null;
    }
    repaint();
  });

  const endStroke = () => {
    if (!stroke) return;
    const changed = stroke.dirty;
    stroke = null;
    if (!changed) return;  // a click that painted nothing is not a history step
    commit();
    persist();
    refreshOpacityNote();
  };
  netCanvas.addEventListener("pointerup", endStroke);
  netCanvas.addEventListener("pointercancel", endStroke);
  netCanvas.addEventListener("pointerleave", () => showReadout(null));

  function showReadout(hit) {
    const el = $("net-readout");
    if (!hit) { el.innerHTML = "&nbsp;"; return; }
    const p = readPixel(hit.face, state.layer, hit.lx, hit.ly);
    const swatch = p[3] === 0 ? "empty" : `${hex(p[0], p[1], p[2])}${p[3] < 255 ? " a" + p[3] : ""}`;
    el.textContent = `${hit.face} · ${hit.lx},${hit.ly} · ${state.layer} · ${swatch}`;
  }

  // ── undo ─────────────────────────────────────────────────────────────────

  function snapshot() { return sctx.getImageData(0, 0, 64, 64); }

  /** Forget the past and make the current pixels the only state. */
  function resetHistory() {
    hist.steps = [snapshot()];
    hist.idx = 0;
    syncUndoButtons();
  }

  /** Record the pixels as they are now, dropping any redo branch. */
  function commit() {
    hist.steps.length = hist.idx + 1;
    hist.steps.push(snapshot());
    if (hist.steps.length > UNDO_LIMIT) hist.steps.shift();
    hist.idx = hist.steps.length - 1;
    syncUndoButtons();
  }

  function travel(to) {
    if (to < 0 || to >= hist.steps.length || to === hist.idx) return;
    hist.idx = to;
    sctx.putImageData(hist.steps[to], 0, 0);
    syncUndoButtons();
    repaint();
    persist();
    refreshOpacityNote();
  }

  const doUndo = () => travel(hist.idx - 1);
  const doRedo = () => travel(hist.idx + 1);

  function syncUndoButtons() {
    $("btn-undo").disabled = hist.idx <= 0;
    $("btn-redo").disabled = hist.idx >= hist.steps.length - 1;
  }

  // ── theme ────────────────────────────────────────────────────────────────
  //
  // Canvas takes colors as strings, so the shared theme variables are read out
  // of common.css once rather than duplicated as hex literals here.

  const theme = (() => {
    const cs = getComputedStyle(document.documentElement);
    const read = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
    return {
      panel: read("--panel", "#1c2128"),
      panel2: read("--panel2", "#232a33"),
      border: read("--border", "#313a45"),
      muted: read("--muted", "#8a94a1"),
    };
  })();

  // ── net rendering ────────────────────────────────────────────────────────

  /** Shaded 8x8 faces for the 3D preview, keyed "face|layer". Orbiting and
   *  spinning redraw many times per second without the pixels changing, so the
   *  cache is dropped only when an edit routes through repaint(). */
  const faceCache = new Map();

  function repaint() {
    faceCache.clear();
    drawNet();
    drawPreview();
  }

  function drawNet() {
    const L = netLayout();
    if (netCanvas.width !== L.width || netCanvas.height !== L.height) {
      netCanvas.width = L.width;
      netCanvas.height = L.height;
    }
    nctx.imageSmoothingEnabled = false;
    nctx.clearRect(0, 0, L.width, L.height);

    for (const c of NET) {
      const x = L.cellX(c.col), y = L.cellY(c.row);

      checkerboard(x, y, L.cell, L.z * 2);

      // Base first, then the hat over it. The layer you are not editing drops
      // to 30% so the active one reads clearly without hiding its context.
      for (const layer of ["base", "hat"]) {
        const [ox, oy] = faceOrigin(c.face, layer);
        nctx.globalAlpha = layer === state.layer ? 1 : 0.3;
        nctx.drawImage(skin, ox, oy, FACE, FACE, x, y, L.cell, L.cell);
      }
      nctx.globalAlpha = 1;

      if (state.grid && L.z >= 8) {
        nctx.strokeStyle = "rgba(255,255,255,0.08)";
        nctx.lineWidth = 1;
        nctx.beginPath();
        for (let i = 1; i < FACE; i++) {
          nctx.moveTo(x + i * L.z + 0.5, y);
          nctx.lineTo(x + i * L.z + 0.5, y + L.cell);
          nctx.moveTo(x, y + i * L.z + 0.5);
          nctx.lineTo(x + L.cell, y + i * L.z + 0.5);
        }
        nctx.stroke();
      }

      nctx.strokeStyle = theme.border;
      nctx.lineWidth = 1;
      nctx.strokeRect(x - 0.5, y - 0.5, L.cell + 1, L.cell + 1);

      nctx.fillStyle = theme.muted;
      nctx.font = '11px Consolas, monospace';
      nctx.textAlign = "left";
      nctx.fillText(c.face, x, y - 4);
    }
  }

  function checkerboard(x, y, size, sq) {
    for (let cy = 0; cy < size; cy += sq) {
      for (let cx = 0; cx < size; cx += sq) {
        nctx.fillStyle = ((cx / sq + cy / sq) & 1) ? theme.panel2 : theme.panel;
        nctx.fillRect(x + cx, y + cy, Math.min(sq, size - cx), Math.min(sq, size - cy));
      }
    }
  }

  // ── 3D preview ───────────────────────────────────────────────────────────
  //
  // Orthographic, two nested cubes: the head at 8 units and the hat shell at
  // 8.5 (vanilla's SkullModel inflates the overlay by 0.25 on every side).
  // Nested convex shells have an exact draw order - hat backfaces, then the
  // opaque head, then hat frontfaces - so no depth sorting is needed.

  /** Corner picks for a face: [origin(u0,v0), u-axis end, v-axis end], and the
   *  outward normal. h is the half-size of the cube.
   *  +X right, +Y up, +Z toward the viewer; the head's face looks down +Z. */
  const CUBE_FACES = [
    { face: "front", n: [0, 0, 1], c: (h) => [[-h, h, h], [h, h, h], [-h, -h, h]] },
    { face: "back", n: [0, 0, -1], c: (h) => [[h, h, -h], [-h, h, -h], [h, -h, -h]] },
    { face: "right", n: [-1, 0, 0], c: (h) => [[-h, h, -h], [-h, h, h], [-h, -h, -h]] },
    { face: "left", n: [1, 0, 0], c: (h) => [[h, h, h], [h, h, -h], [h, -h, h]] },
    { face: "top", n: [0, 1, 0], c: (h) => [[-h, h, -h], [h, h, -h], [-h, h, h]] },
    { face: "bottom", n: [0, -1, 0], c: (h) => [[-h, -h, h], [h, -h, h], [-h, -h, -h]] },
  ];
  const SHADE = { top: 1, front: 0.86, back: 0.86, left: 0.72, right: 0.72, bottom: 0.58 };

  /** An 8x8 face lifted out of the skin, multiplied by its lighting factor.
   *  The multiply is masked back to the source alpha so transparent overlay
   *  pixels stay transparent instead of turning into shaded black. */
  function faceCanvas(face, layer, shade) {
    const key = `${face}|${layer}`;
    const hit = faceCache.get(key);
    if (hit) return hit;
    const [ox, oy] = faceOrigin(face, layer);
    const c = document.createElement("canvas");
    c.width = FACE; c.height = FACE;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(skin, ox, oy, FACE, FACE, 0, 0, FACE, FACE);
    if (shade < 1) {
      g.globalCompositeOperation = "multiply";
      const v = Math.round(255 * shade);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(0, 0, FACE, FACE);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(skin, ox, oy, FACE, FACE, 0, 0, FACE, FACE);
    }
    faceCache.set(key, c);
    return c;
  }

  function rotate(p) {
    const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
    const x = p[0] * cy + p[2] * sy;
    const z = -p[0] * sy + p[2] * cy;
    const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    return [x, p[1] * cp - z * sp, p[1] * sp + z * cp];
  }

  function drawPreview() {
    const w = preview.width, h = preview.height;
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, w, h);
    pctx.imageSmoothingEnabled = false;

    const scale = (Math.min(w, h) / 12) * state.dist;
    const cx = w / 2, cy = h / 2;
    const toScreen = (p) => {
      const r = rotate(p);
      return [cx + r[0] * scale, cy - r[1] * scale, r[2]];
    };

    const shells = [{ layer: "base", h: 4 }];
    if (state.hatVisible) shells.push({ layer: "hat", h: 4.25 });

    const quads = [];
    for (const shell of shells) {
      for (const f of CUBE_FACES) {
        const [p0, pu, pv] = f.c(shell.h);
        const s0 = toScreen(p0), su = toScreen(pu), sv = toScreen(pv);
        const facing = rotate(f.n)[2] > 0;
        quads.push({ layer: shell.layer, face: f.face, s0, su, sv, facing });
      }
    }

    // hat backfaces -> opaque head -> hat frontfaces
    const order = [
      ...quads.filter((q) => q.layer === "hat" && !q.facing),
      ...quads.filter((q) => q.layer === "base" && q.facing),
      ...quads.filter((q) => q.layer === "hat" && q.facing),
    ];

    for (const q of order) {
      const tex = faceCanvas(q.face, q.layer, SHADE[q.face]);
      const ax = (q.su[0] - q.s0[0]) / FACE, ay = (q.su[1] - q.s0[1]) / FACE;
      const bx = (q.sv[0] - q.s0[0]) / FACE, by = (q.sv[1] - q.s0[1]) / FACE;
      pctx.setTransform(ax, ay, bx, by, q.s0[0], q.s0[1]);
      // Slight overdraw hides the hairline seams between adjacent faces.
      pctx.drawImage(tex, -0.03, -0.03, FACE + 0.06, FACE + 0.06);
    }
    pctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // orbit + zoom
  let orbit = null;
  preview.addEventListener("pointerdown", (e) => {
    orbit = { x: e.clientX, y: e.clientY };
    preview.setPointerCapture(e.pointerId);
    stopSpin();
  });
  preview.addEventListener("pointermove", (e) => {
    if (!orbit) return;
    state.yaw += (e.clientX - orbit.x) * 0.012;
    state.pitch = clamp(state.pitch + (e.clientY - orbit.y) * 0.012, -1.4, 1.4);
    orbit = { x: e.clientX, y: e.clientY };
    drawPreview();
  });
  const endOrbit = () => { orbit = null; };
  preview.addEventListener("pointerup", endOrbit);
  preview.addEventListener("pointercancel", endOrbit);
  preview.addEventListener("wheel", (e) => {
    e.preventDefault();
    state.dist = clamp(state.dist * (e.deltaY > 0 ? 0.9 : 1.1), 0.4, 3);
    drawPreview();
  }, { passive: false });

  let spinTimer = null;
  function stopSpin() {
    if (!spinTimer) return;
    cancelAnimationFrame(spinTimer);
    spinTimer = null;
    state.spinning = false;
    $("btn-spin").textContent = "▶ spin";
  }
  $("btn-spin").addEventListener("click", () => {
    if (state.spinning) { stopSpin(); return; }
    state.spinning = true;
    $("btn-spin").textContent = "❚❚ stop";
    const step = () => {
      state.yaw += 0.012;
      drawPreview();
      spinTimer = requestAnimationFrame(step);
    };
    spinTimer = requestAnimationFrame(step);
  });

  // ── colors ───────────────────────────────────────────────────────────────

  const hex2 = (n) => n.toString(16).padStart(2, "0").toUpperCase();
  const hex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function setColor(rgb, alpha) {
    state.color = rgb;
    if (alpha !== undefined) {
      state.alpha = alpha;
      $("alpha-slider").value = String(alpha);
      $("alpha-label").textContent = String(alpha);
      $("alpha-hint").style.display = alpha < 255 ? "" : "none";
    }
    const h = hex(rgb[0], rgb[1], rgb[2]);
    $("color-swatch").value = h.toLowerCase();
    $("color-hex").value = h;
  }

  function rememberColor(rgba) {
    const key = rgba.join(",");
    state.recent = [key, ...state.recent.filter((k) => k !== key)].slice(0, 18);
    drawPalette();
  }

  function drawPalette() {
    const el = $("palette");
    el.textContent = "";
    for (const key of state.recent) {
      const [r, g, b, a] = key.split(",").map(Number);
      const btn = document.createElement("button");
      btn.title = `${hex(r, g, b)}${a < 255 ? ` alpha ${a}` : ""}`;
      const fill = document.createElement("span");
      fill.style.background = `rgba(${r},${g},${b},${a / 255})`;
      btn.appendChild(fill);
      btn.addEventListener("click", () => setColor([r, g, b], a));
      el.appendChild(btn);
    }
  }

  // ── base-layer opacity advisory ──────────────────────────────────────────

  function refreshOpacityNote() {
    let soft = 0;
    for (const face of Object.keys(FACE_UV)) {
      const [ox, oy] = faceOrigin(face, "base");
      const d = sctx.getImageData(ox, oy, FACE, FACE).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) soft++;
    }
    const el = $("opacity-note");
    if (soft === 0) {
      el.textContent = "All base pixels are opaque.";
      el.style.color = "";
    } else {
      el.textContent = `${soft} base pixel${soft === 1 ? " is" : "s are"} transparent. `
        + "The head will show through in game. Paint them solid or move them to the overlay.";
      el.style.color = "var(--warn)";
    }
  }

  // ── loading a texture value ──────────────────────────────────────────────

  /** A pasted value, skin URL, or bare hash -> a skin URL, or an error. */
  function resolveSkinUrl(input) {
    const t = String(input || "").trim();
    if (!t) return { error: "paste a texture value, skin URL, or hash" };
    if (/^https?:\/\//i.test(t)) return { url: t };
    if (/^[0-9a-f]{32,}$/i.test(t)) return { url: TEXTURE_HOST + t.toLowerCase() };
    try {
      const json = JSON.parse(atob(t.replace(/\s+/g, "")));
      const url = json && json.textures && json.textures.SKIN && json.textures.SKIN.url;
      if (url) return { url };
      return { error: "that value decodes, but carries no textures.SKIN.url" };
    } catch (e) {
      return { error: "not a texture value, skin URL, or texture hash" };
    }
  }

  /** Mojang publishes texture URLs as http; the tool may be served over https,
   *  where mixed content is blocked. Upgrade for fetching only - the value we
   *  hand back is whatever the API produced, untouched. */
  const forFetch = (url) => url.replace(/^http:\/\//i, "https://");

  function loadSkinImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // textures.minecraft.net answers with access-control-allow-origin: *, so
      // the pixels stay readable instead of tainting the canvas.
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("fetch failed"));
      img.src = forFetch(url);
    });
  }

  /**
   * Draws a loaded skin image over the whole 64x64 model: HD skins downsample
   * to 64 wide, and a legacy 64x32 skin fills only the rows it has, leaving the
   * lower half (and so the overlay faces) empty. Returns an error string, or
   * null once the drawing, history, and preview are up to date.
   */
  function applySkinImage(img) {
    if (img.width < 64) return `That image is ${img.width}x${img.height}. A skin must be at least 64 pixels wide.`;
    const scale = img.width / 64;
    sctx.clearRect(0, 0, 64, 64);
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, 64, img.height / scale);
    commit();
    repaint();
    persist();
    refreshOpacityNote();
    return null;
  }

  const sizeNote = (img) => (img.width > 64 ? ` (downsampled from ${img.width}x${img.height})` : "");

  async function loadFromValue() {
    const resolved = resolveSkinUrl($("in-value").value);
    if (resolved.error) { status(resolved.error, "bad"); return; }
    status("fetching the skin...", "working");
    let img;
    try {
      img = await loadSkinImage(resolved.url);
    } catch (e) {
      status("could not fetch the skin (offline, or the host blocked the request)", "bad");
      return;
    }
    const err = applySkinImage(img);
    if (err) { status(err, "bad"); return; }
    const host = (() => { try { return new URL(forFetch(resolved.url)).host; } catch (e) { return "the skin host"; } })();
    status(`loaded ${img.width}x${img.height} skin from ${host}${sizeNote(img)}`, "ok");
  }

  // ── the skin PNG itself, in and out ──────────────────────────────────────

  /** Reads a picked file onto the canvas. Blob URLs keep the decode off the
   *  base64 round trip a data URL would need, and are revoked either way. */
  function loadFromFile(file) {
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) {
      status(`${file.name} is not an image`, "bad");
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const err = applySkinImage(img);
      status(err || `loaded ${img.width}x${img.height} skin from ${file.name}${sizeNote(img)}`, err ? "bad" : "ok");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      status(`could not read ${file.name} as an image`, "bad");
    };
    img.src = url;
  }

  /** Download name from the skin-name field, or a stable default. Accents fold
   *  to their base letter rather than dropping out, so "Über" stays readable. */
  function skinFileName() {
    const slug = $("ms-name").value.trim().toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "");
    return `${slug || "c4-head"}.png`;
  }

  async function downloadSkin() {
    let blob;
    try {
      blob = await skinBlob();
    } catch (e) {
      status("could not encode the PNG", "bad");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = skinFileName();
    a.click();
    // Revoked a tick later: revoking while the download is still starting
    // cancels it in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`Saved ${a.download}`, "ok");
  }

  // ── generating a value through MineSkin ──────────────────────────────────

  function skinBlob() {
    return new Promise((resolve, reject) => {
      skin.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode the PNG"))), "image/png");
    });
  }

  function msHeaders() {
    const h = { "MineSkin-User-Agent": USER_AGENT };
    const key = $("ms-key").value.trim();
    if (key) h.Authorization = key.toLowerCase().startsWith("bearer ") ? key : `Bearer ${key}`;
    return h;
  }

  /** The API reports problems in an `errors: [{code, message}]` array. */
  function apiError(body, res) {
    const first = body && Array.isArray(body.errors) && body.errors[0];
    if (first) return first.message || first.code;
    if (body && body.rateLimit && body.rateLimit.next) {
      return `Rate limited. Try again in ${Math.ceil(body.rateLimit.next.relative / 1000)} seconds.`;
    }
    return `MineSkin returned HTTP ${res.status}`;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function generateValue() {
    const btn = $("btn-generate");
    btn.disabled = true;
    try {
      // Clear first: a stale value left over from an earlier success next to a
      // failure message is the one thing a reader would copy by mistake.
      $("out-value").value = "";
      $("out-sig").value = "";
      $("out-url").value = "";
      status("uploading to MineSkin...", "working");
      const form = new FormData();
      form.append("file", await skinBlob(), "head.png");
      form.append("variant", "classic");
      form.append("visibility", $("ms-visibility").value);
      const name = $("ms-name").value.trim();
      if (name) form.append("name", name);

      let res, body;
      try {
        res = await fetch(`${MINESKIN_API}/queue`, { method: "POST", headers: msHeaders(), body: form });
        body = await res.json().catch(() => null);
      } catch (e) {
        status("Could not reach MineSkin. You can keep painting, but generating a value needs the network.", "bad");
        return;
      }
      if (!res.ok) { status(apiError(body, res), "bad"); return; }

      let skinInfo = body && body.skin;
      if (!skinInfo) {
        const jobId = body && body.job && body.job.id;
        if (!jobId) { status("MineSkin accepted the upload but returned no job", "bad"); return; }
        skinInfo = await pollJob(jobId);
        if (!skinInfo) return;  // pollJob reported the reason
      }
      showResult(skinInfo);
    } finally {
      btn.disabled = false;
    }
  }

  /** Poll a queued job. The spec asks for at most one check per second. */
  async function pollJob(jobId) {
    for (let i = 0; i < 60; i++) {
      await sleep(1100);
      status(`waiting for MineSkin... (${i + 1}s)`, "working");
      let res, body;
      try {
        res = await fetch(`${MINESKIN_API}/queue/${encodeURIComponent(jobId)}`, { headers: msHeaders() });
        body = await res.json().catch(() => null);
      } catch (e) {
        status("lost contact with MineSkin while waiting", "bad");
        return null;
      }
      if (!res.ok) { status(apiError(body, res), "bad"); return null; }
      const job = body && body.job;
      if (job && job.status === "failed") { status(apiError(body, res), "bad"); return null; }
      if (body && body.skin) return body.skin;
    }
    status("MineSkin did not finish within a minute. Try again.", "bad");
    return null;
  }

  function showResult(skinInfo) {
    const tex = skinInfo.texture || {};
    const data = tex.data || {};
    $("out-value").value = data.value || "";
    $("out-sig").value = data.signature || "";
    $("out-url").value = (tex.url && tex.url.skin) || "";
    const dup = skinInfo.duplicate ? " (matched a skin MineSkin already had)" : "";
    status(data.value ? `Value ready${dup}` : "MineSkin returned no texture value.", data.value ? "ok" : "bad");
  }

  function status(text, kind) {
    const el = $("status");
    el.textContent = text;
    el.className = `hint ${kind || ""}`.trim();
  }

  // ── persistence ──────────────────────────────────────────────────────────

  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE.skin, skin.toDataURL("image/png"));
        localStorage.setItem(STORE.meta, JSON.stringify({
          name: $("ms-name").value, visibility: $("ms-visibility").value,
        }));
      } catch (e) { /* storage full or blocked - the drawing simply is not kept */ }
    }, 400);
  }

  function restore() {
    try {
      const key = localStorage.getItem(STORE.key);
      if (key) $("ms-key").value = key;
      const meta = JSON.parse(localStorage.getItem(STORE.meta) || "{}");
      if (meta.name) $("ms-name").value = meta.name;
      if (meta.visibility) $("ms-visibility").value = meta.visibility;
      const data = localStorage.getItem(STORE.skin);
      if (!data) return false;
      const img = new Image();
      img.onload = () => {
        sctx.clearRect(0, 0, 64, 64);
        sctx.drawImage(img, 0, 0);
        resetHistory();
        repaint();
        refreshOpacityNote();
      };
      img.src = data;
      return true;
    } catch (e) {
      return false;
    }
  }

  // ── a fresh head ─────────────────────────────────────────────────────────

  function resetSkin() {
    sctx.clearRect(0, 0, 64, 64);
    sctx.fillStyle = DEFAULT_COLOR;
    for (const face of Object.keys(FACE_UV)) {
      const [ox, oy] = faceOrigin(face, "base");
      sctx.fillRect(ox, oy, FACE, FACE);
    }
  }

  // ── wiring ───────────────────────────────────────────────────────────────

  $("tool-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tool]");
    if (!btn) return;
    state.tool = btn.dataset.tool;
    for (const b of $("tool-grid").children) b.classList.toggle("active", b === btn);
  });

  $("layer-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-layer]");
    if (!btn) return;
    state.layer = btn.dataset.layer;
    for (const b of $("layer-grid").children) b.classList.toggle("active", b === btn);
    drawNet();
  });

  $("color-swatch").addEventListener("input", (e) => {
    const v = e.target.value;
    setColor([parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)]);
  });

  $("color-hex").addEventListener("change", (e) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(e.target.value.trim());
    if (!m) { setColor(state.color); return; }
    const n = m[1];
    setColor([parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]);
  });

  $("alpha-slider").addEventListener("input", (e) => setColor(state.color, Number(e.target.value)));

  $("opt-mirror").addEventListener("change", (e) => { state.mirror = e.target.checked; });
  $("opt-grid").addEventListener("change", (e) => { state.grid = e.target.checked; drawNet(); });
  $("opt-hat-visible").addEventListener("change", (e) => { state.hatVisible = e.target.checked; drawPreview(); });
  $("zoom-slider").addEventListener("input", (e) => {
    state.zoom = Number(e.target.value);
    $("zoom-label").textContent = `${state.zoom}x`;
    drawNet();
  });

  $("btn-undo").addEventListener("click", doUndo);
  $("btn-redo").addEventListener("click", doRedo);
  $("btn-reset").addEventListener("click", () => {
    resetSkin();
    commit();
    repaint();
    persist();
    refreshOpacityNote();
    status("started over from a plain gray head", "");
  });

  $("btn-load").addEventListener("click", loadFromValue);
  $("btn-upload").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", (e) => {
    loadFromFile(e.target.files && e.target.files[0]);
    e.target.value = ""; // so picking the same file again still fires a change
  });
  $("btn-download").addEventListener("click", downloadSkin);
  $("btn-generate").addEventListener("click", generateValue);
  $("ms-key").addEventListener("change", (e) => {
    try { localStorage.setItem(STORE.key, e.target.value.trim()); } catch (err) { /* blocked */ }
  });
  $("ms-name").addEventListener("change", persist);
  $("ms-visibility").addEventListener("change", persist);

  $("btn-to-input").addEventListener("click", () => {
    const v = $("out-value").value;
    if (!v) return;
    $("in-value").value = v;
    status("Moved to the load field. Press load to edit it.", "");
  });

  for (const [btn, src] of [["btn-copy-value", "out-value"], ["btn-copy-url", "out-url"]]) {
    $(btn).addEventListener("click", async () => {
      const v = $(src).value;
      if (!v) return;
      try {
        await navigator.clipboard.writeText(v);
      } catch (e) {
        $(src).select();
        document.execCommand("copy");
      }
      const el = $(btn);
      el.classList.add("copied");
      const was = el.textContent;
      el.textContent = "copied";
      setTimeout(() => { el.classList.remove("copied"); el.textContent = was; }, 1200);
    });
  }

  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); }
    else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); doRedo(); }
  });

  // ── start ────────────────────────────────────────────────────────────────

  resetSkin();
  resetHistory();
  setColor(state.color, state.alpha);
  drawPalette();
  restore();
  repaint();
  refreshOpacityNote();
  status(" ", "");

  // Exposed for browser-side verification of the coordinate mapping.
  window.__headPainter = { skin, state, resolveSkinUrl, hitNet, netLayout, faceOrigin, FACE_UV,
    applySkinImage, loadFromFile, skinFileName };
})();
