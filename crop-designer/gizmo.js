/* gizmo.js - move / scale / rotate handles for the crop preview.
 *
 * Loaded after app.js. Classic scripts share one global lexical scope, so the
 * top-level bindings in app.js (state, project, draw, canvas, ctx, setStage,
 * changed, save, clamp, esc) are visible here, and the function declarations
 * draw/setStage can be wrapped.
 *
 * The preview projection is orthographic - project() is a linear view
 * transform plus a fixed screen offset - so a screen drag inverts to an axis
 * amount analytically: moving one world unit along axis A shifts the cursor by
 * a fixed screen vector, and the drag amount is the drag projected onto it.
 * No raycasting or matrix inversion needed.
 *
 * Pointer handlers run in the CAPTURE phase so a handle drag claims the event
 * before app.js's orbit listener; a drag that misses every handle falls
 * through and still orbits.
 *
 * Multi-select: click a chip to select, shift+click to extend a range,
 * ctrl/cmd+click to toggle one. A drag applies the SAME delta to every
 * selected element, with the handles anchored at their centroid.
 */
"use strict";

(() => {
  const AXES = [
    { k: 0, name: "X", vec: [1, 0, 0], color: "#e5534b" },
    { k: 1, name: "Y", vec: [0, 1, 0], color: "#57ab5a" },
    { k: 2, name: "Z", vec: [0, 0, 1], color: "#539bf5" },
  ];
  const HANDLE_LEN = 0.55;   // world units out from the origin
  const HIT_RADIUS = 13;     // px
  const DEG_PER_UNIT = 90;   // rotate sensitivity
  const PIXEL = 0.0625;      // 1/16 block - vanilla's pixel grid

  const TOOLS = ["orbit", "move", "scale", "rotate"];
  const FIELD = { move: "translation", scale: "scale", rotate: "rotation" };

  if (!state.view.tool || TOOLS.indexOf(state.view.tool) < 0) state.view.tool = "orbit";
  if (!Array.isArray(state.view.selEls)) {
    // migrate the old single-selection field if it is present
    state.view.selEls = typeof state.view.selEl === "number" ? [state.view.selEl] : [0];
  }
  let anchor = state.view.selEls[0] || 0;   // range anchor for shift+click

  const stageNow = () => state.crop
    ? state.crop.stages[clamp(state.view.stage, 0, state.crop.stages.length - 1)] : null;
  const elsNow = () => (stageNow() && stageNow().elements) || [];

  /** Indices that are both selected and still in range, always sorted. */
  function selIndices() {
    if (state.view.tool === "orbit") return [];
    const n = elsNow().length;
    return state.view.selEls.filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
  }
  const selElements = () => selIndices().map((i) => elsNow()[i]);

  // ── toolbar ───────────────────────────────────────────────────────────
  const bar = document.createElement("div");
  bar.id = "gizmo-bar";
  bar.innerHTML =
    `<div class="gizmo-row">
       <div class="gizmo-tools" role="group" aria-label="Transform tool">` +
    TOOLS.map((t) =>
      `<button type="button" data-tool="${t}" title="${
        t === "orbit" ? "Drag to orbit the camera" : "Drag an axis handle to " + t
      }">${UI.icon(t, "sm")}${t}</button>`
    ).join("") +
    `   </div>
       <label class="gizmo-snap check" title="Snap to the vanilla pixel grid (1/16), 0.05 scale, 5&deg;">
         <input type="checkbox" id="gizmo-snap" checked><span>snap</span>
       </label>
       <label class="check"><input type="checkbox" id="show-hitbox" ${state.view.showHitbox !== false ? "checked" : ""}> hitbox</label>
       <label class="check"><input type="checkbox" id="show-field" ${state.view.field ? "checked" : ""}> 5&times;5 field</label>
     </div>
     <div class="gizmo-row gizmo-els-row">
       <span class="gizmo-label">elements</span>
       <div id="gizmo-els" class="gizmo-els"></div>
     </div>`;
  // The preview owns the gizmos. Keeping them in its top-left corner leaves
  // the weighted growth controls as one uninterrupted strip below the scene.
  const previewPanel = document.getElementById("center-panel");
  if (previewPanel) previewPanel.appendChild(bar);
  else canvas.parentNode.insertBefore(bar, canvas.nextSibling);

  const q = (s) => bar.querySelector(s);
  const elsBox = q("#gizmo-els");
  // Exact transform values already live in the stage form. The canvas keeps
  // the spatial controls compact instead of echoing those values here.
  const readout = () => {};

  q("#show-hitbox").addEventListener("change", (e) => {
    state.view.showHitbox = e.target.checked;
    draw(); save();
  });
  q("#show-field").addEventListener("change", (e) => {
    state.view.field = e.target.checked;
    syncBar(); draw(); save();
  });

  function syncBar() {
    bar.querySelectorAll("[data-tool]").forEach((b) =>
      b.classList.toggle("active", b.dataset.tool === state.view.tool));
    const els = elsNow();
    const sel = new Set(selIndices());
    elsBox.innerHTML = els.length
      ? els.map((e, i) => {
          const what = e.type === "block" ? e.block
            : e.type === "head" ? "head" : e.model;
          const label = esc(String(what || "").replace("minecraft:", ""));
          return `<button type="button" class="gizmo-chip${sel.has(i) ? " active" : ""}"
                    data-ei="${i}" title="${esc(e.type)}: ${label}">${i + 1}. ${label}</button>`;
        }).join("")
      : `<span class="gizmo-empty">no elements in this stage</span>`;
    bar.classList.toggle("orbit-mode", state.view.tool === "orbit");
    bar.classList.toggle("field-mode", !!state.view.field);
  }

  bar.addEventListener("click", (e) => {
    const tool = e.target.closest("[data-tool]");
    if (tool) {
      state.view.tool = tool.dataset.tool;
      readout("");
      syncBar(); draw(); save();
      return;
    }
    const chip = e.target.closest("[data-ei]");
    if (!chip) return;
    const i = +chip.dataset.ei;
    const cur = new Set(state.view.selEls);
    if (e.shiftKey) {                       // extend a contiguous range
      const [lo, hi] = anchor <= i ? [anchor, i] : [i, anchor];
      for (let n = lo; n <= hi; n++) cur.add(n);
    } else if (e.ctrlKey || e.metaKey) {    // toggle just this one
      if (cur.has(i) && cur.size > 1) cur.delete(i); else cur.add(i);
      anchor = i;
    } else {                                // plain click replaces
      cur.clear(); cur.add(i); anchor = i;
    }
    state.view.selEls = [...cur].sort((a, b) => a - b);
    readout(state.view.selEls.length > 1 ? state.view.selEls.length + " selected" : "");
    syncBar(); draw(); save();
  });

  // ── projection helpers ────────────────────────────────────────────────
  /** Handles anchor at the centroid of the selection. */
  function originOf() {
    const els = selElements();
    if (!els.length) return null;
    const o = [0, 0, 0];
    for (const e of els) for (let i = 0; i < 3; i++) o[i] += e.translation[i];
    return o.map((v) => v / els.length);
  }

  function handlePos(o, axis) {
    return project([
      o[0] + axis[0] * HANDLE_LEN,
      o[1] + axis[1] * HANDLE_LEN,
      o[2] + axis[2] * HANDLE_LEN,
    ]);
  }

  /** Screen vector produced by moving one world unit along `axis`. */
  function axisScreen(origin, axis) {
    const a = project(origin);
    const b = project([origin[0] + axis[0], origin[1] + axis[1], origin[2] + axis[2]]);
    return [b.x - a.x, b.y - a.y];
  }

  /** A drag of (mx,my) px expressed as an amount along `axis`. */
  function dragAmount(origin, axis, mx, my) {
    const d = axisScreen(origin, axis);
    const len2 = d[0] * d[0] + d[1] * d[1];
    // Axis pointing near-straight at the camera: no reliable drag direction.
    return len2 < 4 ? 0 : (mx * d[0] + my * d[1]) / len2;
  }

  function pickAxis(o, px, py) {
    let best = null, bestD = HIT_RADIUS;
    for (const a of AXES) {
      const p = handlePos(o, a.vec);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d <= bestD) { bestD = d; best = a; }
    }
    return best;
  }

  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height),
      k: canvas.width / r.width,
    };
  }

  // ── draw the handles over the finished scene ──────────────────────────
  let drag = null;
  const baseDraw = draw;
  draw = function () {
    baseDraw.apply(this, arguments);
    if (state.view.mode !== "stages") return;
    const o = originOf();
    if (!o) return;
    const els = selElements();
    ctx.save();
    // Ring each selected element so a multi-selection is legible.
    if (els.length > 1) {
      ctx.strokeStyle = "rgba(255,255,255,.55)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      for (const e of els) {
        const p = project(e.translation);
        ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    const c = project(o);
    ctx.lineWidth = 2.5;
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const a of AXES) {
      const p = handlePos(o, a.vec);
      ctx.globalAlpha = drag && drag.axis.k !== a.k ? 0.25 : 1;
      ctx.strokeStyle = a.color;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.fillStyle = a.color;
      ctx.beginPath();
      if (state.view.tool === "scale") ctx.rect(p.x - 4.5, p.y - 4.5, 9, 9);
      else ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
      if (state.view.tool === "rotate") {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 1.5); ctx.stroke();
        ctx.lineWidth = 2.5;
      }
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(0,0,0,.65)";
      ctx.lineWidth = 3;
      ctx.strokeText(a.name, p.x, p.y - 13);
      ctx.fillText(a.name, p.x, p.y - 13);
      ctx.lineWidth = 2.5;
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(c.x, c.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };

  // ── drag ──────────────────────────────────────────────────────────────
  /** Round a DELTA to the field's snap increment (used for multi-selection). */
  function snapStep(field, d) {
    const step = field === "rotation" ? 5 : field === "scale" ? 0.05 : PIXEL;
    return Math.round(d / step) * step;
  }

  /** Snap + clamp one field value, matching the plugin's own limits. */
  function settle(field, raw, snap) {
    let v = raw;
    if (field === "rotation") {
      if (snap) v = Math.round(v / 5) * 5;
      v = ((v % 360) + 360) % 360;
      if (v > 180) v -= 360;                // read as -180..180
    } else if (field === "scale") {
      if (snap) v = Math.round(v / 0.05) * 0.05;
      v = clamp(v, 0.01, 10);               // FarmingConfig clamps to this
    } else {
      if (snap) v = Math.round(v / PIXEL) * PIXEL;
      v = clamp(v, -8, 8);
    }
    return Math.round(v * 1e4) / 1e4;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (state.view.mode !== "stages") return;
    if (state.view.tool === "orbit") return;
    const o = originOf();
    if (!o) return;
    const p = canvasPoint(e);
    const axis = pickAxis(o, p.x, p.y);
    if (!axis) return;                    // missed every handle - let it orbit
    e.stopImmediatePropagation();
    e.preventDefault();
    const field = FIELD[state.view.tool];
    drag = {
      axis, field, origin: o,
      els: selElements(),
      starts: selElements().map((el) => el[field].slice()),
      sx: e.clientX, sy: e.clientY, k: p.k,
    };
    canvas.setPointerCapture(e.pointerId);
    draw();
  }, true);

  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    e.stopImmediatePropagation();
    const t = dragAmount(
      drag.origin, drag.axis.vec,
      (e.clientX - drag.sx) * drag.k,
      (e.clientY - drag.sy) * drag.k
    );
    const snap = q("#gizmo-snap").checked;
    const k = drag.axis.k;
    const raw = t * (drag.field === "rotation" ? DEG_PER_UNIT : 1);
    // With ONE element, snap the absolute value so it lands on the grid.
    // With several, snap the DELTA instead and apply it uniformly - snapping
    // each absolute value independently would round elements that started off
    // the grid by different amounts and quietly destroy their relative spacing.
    if (drag.els.length === 1) {
      drag.els[0][drag.field][k] = settle(drag.field, drag.starts[0][k] + raw, snap);
    } else {
      const d = snap ? snapStep(drag.field, raw) : raw;
      drag.els.forEach((el, n) => {
        el[drag.field][k] = settle(drag.field, drag.starts[n][k] + d, false);
      });
    }
    const shown = drag.els[0][drag.field][k];
    readout(drag.field + " " + drag.axis.name + " = " + shown +
      (drag.els.length > 1 ? "  (×" + drag.els.length + ")" : ""));
    draw();
  }, true);

  function endDrag(e) {
    if (!drag) return;
    if (e) e.stopImmediatePropagation();
    drag = null;
    // changed(true) rebuilds the panels, which is what pushes the dragged
    // values back into the elements' numeric inputs - setStage alone only
    // redraws the preview and would leave those inputs stale.
    changed(true);
  }
  canvas.addEventListener("pointerup", endDrag, true);
  canvas.addEventListener("pointercancel", endDrag, true);

  // ── arrow-key nudge, for fine work the mouse cannot do ────────────────
  document.addEventListener("keydown", (e) => {
    if (state.view.tool === "orbit") return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const map = {
      ArrowRight: [0, 1], ArrowLeft: [0, -1],
      ArrowUp: [1, 1], ArrowDown: [1, -1],
      PageUp: [2, 1], PageDown: [2, -1],
    };
    const m = map[e.key];
    const els = selElements();
    if (!m || !els.length) return;
    e.preventDefault();
    const field = FIELD[state.view.tool];
    const step = (field === "rotation" ? 5 : PIXEL) * (e.shiftKey ? 4 : 1);
    const k = m[0];
    // A nudge is already an exact step, so never re-snap the absolute value -
    // that would drift elements that sit off the grid.
    els.forEach((el) => { el[field][k] = settle(field, el[field][k] + m[1] * step, false); });
    readout(field + " " + AXES[k].name + " = " + els[0][field][k] +
      (els.length > 1 ? "  (×" + els.length + ")" : ""));
    changed(true);
  });

  // Element list must follow stage switches and add/remove.
  const baseSetStage = setStage;
  setStage = function () {
    baseSetStage.apply(this, arguments);
    syncBar();
  };

  syncBar();
  draw();
})();
