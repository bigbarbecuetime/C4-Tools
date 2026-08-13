/* ui.js - the shell every C4 tool page shares.
 *
 * Owns the chrome and the input controls that are not specific to one tool:
 * the mark, the light/dark theme, the outline that swaps one pane at a time,
 * capped range meters, name fields that show '&' codes as the game renders
 * them, drag-to-reorder, and the growth bar.
 *
 * Tools keep their own state. This file never touches it: controls it
 * upgrades keep their original <input> element and their id, and every edit
 * still fires a normal bubbling "input" event, so existing page code binds to
 * them exactly as before. Reordering is reported as a "ui:sort" CustomEvent
 * on the sortable container and the page decides what it means.
 *
 * No build step, no dependencies, works from file://.
 */
"use strict";

const UI = (() => {

  const THEME_KEY = "c4-theme";
  const MARK_URL = document.currentScript
    ? new URL("c4-mark.png?v=4", document.currentScript.src).href
    : "shared/c4-mark.png?v=4";
  const escHtml = (s) => String(s).replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ── icons ────────────────────────────────────────────────────────────
     Control glyphs only, drawn in the Material Symbols idiom. An icon
     appears when it IS the control; categories and headings stay words.  */
  const PATHS = {
    move: "M12 2 8.5 5.5l1.4 1.4L11 5.8V11H5.8l1.1-1.1L5.5 8.5 2 12l3.5 3.5 1.4-1.4L5.8 13H11v5.2l-1.1-1.1-1.4 1.4L12 22l3.5-3.5-1.4-1.4-1.1 1.1V13h5.2l-1.1 1.1 1.4 1.4L22 12l-3.5-3.5-1.4 1.4 1.1 1.1H13V5.8l1.1 1.1 1.4-1.4z",
    rotate: "M14 3.2V1l4.5 4.2L14 9.4V6.2a5.8 5.8 0 1 0 5.8 5.8H22A8 8 0 1 1 14 3.2z",
    scale: "M3 3h8v2.2H5.2V11H3zm18 0v8h-2.2V5.2H13V3zM3 13h2.2v5.8H11V21H3zm15.8 0H21v8h-8v-2.2h5.8z",
    orbit: "M12 4a8 8 0 1 0 8 8h-2.2A5.8 5.8 0 1 1 12 6.2zM12 9.4A2.6 2.6 0 1 0 14.6 12 2.6 2.6 0 0 0 12 9.4z",
    snap: "M3 3h6.2v6.2H3zm11.8 0H21v6.2h-6.2zM3 14.8h6.2V21H3zm11.8 0H21V21h-6.2z",
    eye: "M12 5C6.5 5 2.7 9.6 2 12c.7 2.4 4.5 7 10 7s9.3-4.6 10-7c-.7-2.4-4.5-7-10-7zm0 11.5A4.5 4.5 0 1 1 16.5 12 4.5 4.5 0 0 1 12 16.5zm0-7A2.5 2.5 0 1 0 14.5 12 2.5 2.5 0 0 0 12 9.5z",
    copy: "M16 1H4a2 2 0 0 0-2 2v14h2V3h12zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11z",
    trash: "M6 21a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z",
    add: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z",
    drag: "M9 4h2.2v2.2H9zm3.8 0H15v2.2h-2.2zM9 8.9h2.2v2.2H9zm3.8 0H15v2.2h-2.2zM9 13.8h2.2V16H9zm3.8 0H15V16h-2.2zM9 18.7h2.2v2.2H9zm3.8 0H15v2.2h-2.2z",
    play: "M7 4l13 8-13 8z",
    stop: "M6 6h12v12H6z",
    upload: "M11 16V7.8l-3 3-1.4-1.4L12 4l5.4 5.4L16 10.8l-3-3V16zM5 18h14v2H5z",
    clear: "M17.6 6.4A8 8 0 1 0 19.7 14h-2.1A6 6 0 1 1 12 6a5.9 5.9 0 0 1 4 1.6L13 11h7V4z",
    sun: "M12 6.5A5.5 5.5 0 1 0 17.5 12 5.5 5.5 0 0 0 12 6.5zM11 1h2v3.2h-2zm0 18.8h2V23h-2zM1 11h3.2v2H1zm18.8 0H23v2h-3.2zM4 5.4 5.4 4l2.3 2.3-1.4 1.4zm12.3 12.3 1.4-1.4L20 18.6 18.6 20zM18.6 4 20 5.4l-2.3 2.3-1.4-1.4zM4 18.6l2.3-2.3 1.4 1.4L5.4 20z",
    moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z",
    back: "M15.4 4 7.4 12l8 8 1.4-1.4L10.2 12l6.6-6.6z",
  };
  const icon = (name, cls) =>
    `<svg class="i${cls ? " " + cls : ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;

  function logo(title) {
    return `<img class="c4-mark" src="${MARK_URL}" alt="${escHtml(title || "C4")}">`;
  }

  /* ── theme ────────────────────────────────────────────────────────── */
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || "dark";
  }
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* file:// with storage off */ }
    document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
      b.innerHTML = icon(t === "dark" ? "sun" : "moon");
      b.title = t === "dark" ? "Switch to light" : "Switch to dark";
    });
    document.dispatchEvent(new CustomEvent("ui:theme", { detail: { theme: t } }));
  }
  function initTheme() {
    let t = null;
    try { t = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
    if (!t) t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    setTheme(t);
  }

  /* ── outline: one pane open at a time ─────────────────────────────── */
  function selectPane(name) {
    const panes = document.querySelectorAll("[data-pane]");
    if (!panes.length) return;
    let found = false;
    panes.forEach((p) => {
      const on = p.dataset.pane === name;
      p.hidden = !on;
      if (on) found = true;
    });
    if (!found) return;
    document.querySelectorAll("[data-pane-target]").forEach((b) =>
      b.classList.toggle("on", b.dataset.paneTarget === name));
    const head = document.getElementById("pane-title");
    const btn = document.querySelector(`[data-pane-target="${name}"]`);
    if (head && btn) head.textContent = btn.dataset.paneTitle || btn.textContent.trim();
    if (matchMedia("(max-width: 900px)").matches) screen("detail");
    document.dispatchEvent(new CustomEvent("ui:pane", { detail: { pane: name } }));
  }

  /** Which view the main column shows: the render window, or the files this
   *  tool generates. Both occupy the same cell, so one is always off. */
  function mainView(name) {
    document.body.dataset.main = name;
    document.querySelectorAll("[data-main]").forEach((b) => {
      if (b === document.body) return;
      b.classList.toggle("on", b.dataset.main === name);
    });
    if (matchMedia("(max-width: 900px)").matches) screen("view");
  }

  /* ── mobile screens: outline, render, edit ────────────────────────── */
  function screen(name) {
    document.body.dataset.screen = name;
    document.querySelectorAll("[data-screen]").forEach((b) =>
      b.classList.toggle("on", b.dataset.screen === name));
    scrollTo({ top: 0 });
  }

  /* Binary settings keep their native checkbox behavior while presenting as
     on/off switches. Native focus and Space handling remain intact. */
  function upgradeSwitches(root) {
    (root || document).querySelectorAll("label.check input[type=checkbox]").forEach((input) => {
      input.setAttribute("role", "switch");
    });
  }

  /* ── capped meters ────────────────────────────────────────────────────
     Upgrades <input type="number" data-range> in place. Discrete ranges
     (step 1 over a small span, e.g. light 0-15) get one cell per level, so
     the filled count IS the value. Continuous ranges get a fill.         */
  function upgradeMeters(root) {
    (root || document).querySelectorAll("input[data-range]:not([data-range-ready])").forEach((input) => {
      input.setAttribute("data-range-ready", "");
      const min = parseFloat(input.min || 0);
      const max = parseFloat(input.max || 1);
      const step = parseFloat(input.step || 1);
      const cells = input.dataset.cells ? parseInt(input.dataset.cells, 10) : 0;
      const meterKind = input.dataset.meter || "";
      const wrap = document.createElement("div");
      wrap.className = "meter" + (meterKind ? " " + meterKind : "");
      wrap.dataset.meter = meterKind;
      if (input.hasAttribute("data-reverse")) wrap.dataset.reverse = "";
      input.parentNode.insertBefore(wrap, input);
      const track = document.createElement("div");
      track.className = "meter-track";
      track.title = meterKind === "light" ? "Block light levels 15 to 0" : "Drag to set the value";
      const cellMarkup = meterKind === "light"
        ? Array.from({ length: cells }, (_, i) => `<span data-level="${max - i}" title="${i} block${i === 1 ? "" : "s"} from lantern · light ${max - i}"></span>`).join("")
        : '<span></span>'.repeat(cells);
      track.innerHTML = cells
        ? `<div class="meter-cells">${cellMarkup}</div>`
        : '<div class="meter-fill"></div>';
      const suffix = document.createElement("span");
      suffix.className = "meter-max";
      suffix.textContent = "/ " + max;
      wrap.appendChild(track);
      wrap.appendChild(input);
      wrap.appendChild(suffix);
      input.classList.add("meter-num");

      const clampTo = (v) => {
        if (isNaN(v)) v = min;
        v = Math.min(max, Math.max(min, Math.round(v / step) * step));
        return parseFloat(v.toFixed(6));
      };
      const commit = (v, fromTrack) => {
        const c = clampTo(v);
        if (String(c) !== input.value) {
          input.value = c;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        } else if (fromTrack) {
          paintMeter(input);
        }
        paintMeter(input);
      };
      let dragging = false;
      const fromEvent = (e) => {
        const r = track.getBoundingClientRect();
        if (!r.width) return;
        const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        const logical = input.hasAttribute("data-reverse") ? 1 - t : t;
        commit(min + logical * (max - min), true);
      };
      track.addEventListener("pointerdown", (e) => {
        dragging = true;
        try { track.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
        fromEvent(e);
      });
      track.addEventListener("pointermove", (e) => { if (dragging) fromEvent(e); });
      track.addEventListener("pointerup", () => { dragging = false; });
      track.addEventListener("pointercancel", () => { dragging = false; });
      /* typing is clamped on the way in, so the value cannot leave the range */
      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        if (!isNaN(v) && (v > max || v < min)) {
          input.value = clampTo(v);
        }
        paintMeter(input);
      });
      input.addEventListener("blur", () => commit(parseFloat(input.value)));
      paintMeter(input);
    });
  }
  function paintMeter(input) {
    const wrap = input.closest(".meter");
    if (!wrap) return;
    const min = parseFloat(input.min || 0);
    const max = parseFloat(input.max || 1);
    const v = Math.min(max, Math.max(min, parseFloat(input.value) || 0));
    const cells = wrap.querySelectorAll(".meter-cells span");
    if (cells.length) {
      if (input.dataset.meter === "light") {
        const selected = Math.round(max - v);
        cells.forEach((c, i) => c.classList.toggle("selected", i === selected));
      } else {
        const lit = Math.round((v - min) / (max - min) * cells.length);
        cells.forEach((c, i) => c.classList.toggle("on", i < lit));
      }
    } else {
      const fill = wrap.querySelector(".meter-fill");
      if (fill) fill.style.width = ((v - min) / (max - min) * 100) + "%";
    }
  }

  /* ── name fields: rendered by default, raw codes on click ───────────── */
  function upgradeNameFields(root) {
    (root || document).querySelectorAll("input[data-fmt]:not([data-fmt-ready])").forEach((input) => {
      input.setAttribute("data-fmt-ready", "");
      const wrap = document.createElement("div");
      wrap.className = "fmt";
      input.parentNode.insertBefore(wrap, input);
      const view = document.createElement("span");
      view.className = "fmt-view";
      view.tabIndex = 0;
      view.title = "Click to edit the & codes";
      wrap.appendChild(view);
      wrap.appendChild(input);
      const render = () => {
        view.innerHTML = typeof LegacyText !== "undefined"
          ? LegacyText.toHtml(input.value || "", escHtml)
          : escHtml(input.value || "");
      };
      const edit = () => {
        wrap.classList.add("editing");
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      };
      const done = () => { wrap.classList.remove("editing"); render(); };
      view.addEventListener("click", edit);
      view.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); edit(); }
      });
      input.addEventListener("blur", done);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") input.blur();
      });
      input.addEventListener("input", render);
      render();
    });
  }

  /* ── drag to reorder ──────────────────────────────────────────────────
     Any element with data-sort="kind:a[:b]" inside a [data-sortable] root
     can be dragged by its .grip. On drop the root gets a "ui:sort" event
     with { from, to, before } and the page performs the move.           */
  let drag = null;
  const line = document.createElement("div");
  line.className = "drop-line";

  /** Nearest scrollable ancestor, so a drag can reach a row that is off
   *  screen without the user letting go. */
  function scrollParent(node) {
    for (let n = node; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n).overflowY;
      if ((s === "auto" || s === "scroll") && n.scrollHeight > n.clientHeight) return n;
    }
    return document.scrollingElement;
  }
  function autoScroll(y) {
    if (!drag) return;
    const box = drag.scroller;
    if (!box) return;
    const r = box === document.scrollingElement
      ? { top: 0, bottom: innerHeight }
      : box.getBoundingClientRect();
    const edge = 56;
    if (y < r.top + edge) box.scrollTop -= Math.max(6, (r.top + edge - y) / 2);
    else if (y > r.bottom - edge) box.scrollTop += Math.max(6, (y - (r.bottom - edge)) / 2);
  }

  function initSorting() {
    document.addEventListener("pointerdown", (e) => {
      const grip = e.target.closest(".grip");
      if (!grip) return;
      const item = grip.closest("[data-sort]");
      const root = item && item.closest("[data-sortable]");
      if (!item || !root) return;
      e.preventDefault();
      drag = {
        root, item, to: null, before: true,
        from: item.dataset.sort, kind: item.dataset.sort.split(":")[0],
        scroller: scrollParent(item),
      };
      item.classList.add("dragging");
      document.body.classList.add("ui-dragging");
      document.body.appendChild(line);
      line.style.display = "none";
    });
    document.addEventListener("pointermove", (e) => {
      if (!drag) return;
      autoScroll(e.clientY);
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const target = under && under.closest("[data-sort]");
      if (!target || !drag.root.contains(target)) { line.style.display = "none"; drag.to = null; return; }
      const spec = target.dataset.sort;
      const tKind = spec.split(":")[0];
      /* a row only drops among its own kind, except that a child may be
         dropped onto a parent row to move into it */
      const childOntoParent = drag.kind !== tKind && spec.split(":").length < drag.from.split(":").length;
      if (tKind !== drag.kind && !childOntoParent) { line.style.display = "none"; drag.to = null; return; }
      /* An expanded card can be several hundred pixels tall, which would put
         its own midpoint off screen. Aim at the card's head instead: the row
         you are actually looking at is the row you drop against. */
      const r = target.getBoundingClientRect();
      const head = target.querySelector(".card-head, .row-head");
      const hr = head ? head.getBoundingClientRect() : r;
      const before = e.clientY < hr.top + hr.height / 2;
      line.style.display = "block";
      line.style.left = r.left + "px";
      line.style.width = r.width + "px";
      line.style.top = (before ? r.top - 1 : r.bottom - 2) + "px";
      drag.to = spec;
      drag.before = before;
    });
    const end = () => {
      if (!drag) return;
      const { root, from, to, before, item } = drag;
      item.classList.remove("dragging");
      document.body.classList.remove("ui-dragging");
      line.remove();
      drag = null;
      if (!to || to === from) return;
      root.dispatchEvent(new CustomEvent("ui:sort", { detail: { from, to, before } }));
    };
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
  }

  /* ── growth bar ───────────────────────────────────────────────────────
     The bar is the control: the page's own range input sits transparent on
     top of it, so existing listeners and the keyboard still work. */
  function growthPaint() {
    const wrap = document.querySelector(".growth");
    if (!wrap) return;
    const input = wrap.querySelector("input[type=range]");
    if (!input) return;
    const fraction = (input.value - input.min) / ((input.max - input.min) || 1);
    const pct = fraction * 100;
    const fill = wrap.querySelector(".growth-fill");
    if (fill) fill.style.width = pct + "%";
    wrap.querySelectorAll(".growth-stage").forEach((segment) => {
      const start = +segment.dataset.start;
      const end = +segment.dataset.end;
      const local = Math.max(0, Math.min(1, (fraction - start) / ((end - start) || 1)));
      segment.style.setProperty("--segment-fill", (local * 100) + "%");
    });
    wrap.querySelector(".growth-head").style.left = pct + "%";
  }
  /** Stage boundaries as fractions of the whole, set by growthSegments. */
  let growthStops = [];

  /**
   * Draw the stage boundaries on the growth bar and make the bar snap to
   * them. Takes the boundaries as fractions of the whole (0..1), because
   * only the page knows how its stages map onto elapsed time: the crop
   * designer, for one, spreads growth over every stage but the last, which
   * is the ripe one and lands on 1.
   */
  function growthSegments(stops) {
    const wrap = document.querySelector(".growth");
    if (!wrap || !Array.isArray(stops)) return;
    growthStops = stops.filter((f) => f > 0 && f < 1);
    const edges = [0, ...growthStops, 1];
    wrap.querySelector(".growth-seps").innerHTML = edges.slice(0, -1).map((start, i) => {
      const end = edges[i + 1];
      return `<span class="growth-stage" data-start="${start}" data-end="${end}" `
        + `style="left:${(start * 100).toFixed(3)}%;width:${((end - start) * 100).toFixed(3)}%">`
        + `<i aria-hidden="true"></i></span>`;
    }).join("");
    growthPaint();
  }

  /** Nearest stage boundary within reach, or null to leave the value alone.
   *  Only the last stretch before a boundary pulls, so the rest of a segment
   *  is still free to scrub. */
  function snapGrowth(fraction) {
    const reach = 0.02;
    let best = null, bestD = reach;
    for (const f of growthStops.concat([0, 1])) {
      const d = Math.abs(fraction - f);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  function initGrowth() {
    const wrap = document.querySelector(".growth");
    if (!wrap) return;
    const input = wrap.querySelector("input[type=range]");
    if (!input) return;
    /* Capture phase, so the snap lands before the page's own listener reads
       the value: dragging clicks into each stage, while playback (which sets
       the value directly, without an input event) stays smooth. */
    wrap.addEventListener("input", (e) => {
      if (e.target !== input) return;
      const min = +input.min || 0, max = +input.max || 100;
      const snapped = snapGrowth((input.value - min) / ((max - min) || 1));
      if (snapped !== null) input.value = Math.round(min + snapped * (max - min));
    }, true);
    input.addEventListener("input", growthPaint);
    growthPaint();
  }

  /* ── shell ────────────────────────────────────────────────────────── */
  function initShell(opts) {
    const o = opts || {};
    document.querySelectorAll("[data-logo]").forEach((n) => {
      n.innerHTML = logo(n.matches("a") ? "C4 home" : "C4");
    });
    document.querySelectorAll("[data-theme-toggle]").forEach((b) =>
      b.addEventListener("click", () => setTheme(currentTheme() === "dark" ? "light" : "dark")));
    initTheme();
    document.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-pane-target]");
      if (nav) { selectPane(nav.dataset.paneTarget); return; }
      const view = e.target.closest("button[data-main]");
      if (view) { mainView(view.dataset.main); return; }
      const scr = e.target.closest("[data-screen]");
      if (scr) { screen(scr.dataset.screen); return; }
      const back = e.target.closest("[data-back]");
      if (back) screen("outline");
    });
    initSorting();
    initGrowth();
    refresh();
    if (o.pane) selectPane(o.pane);
    if (!document.body.dataset.main) mainView("preview");
    if (!document.body.dataset.screen) document.body.dataset.screen = "outline";
  }

  /** Re-run the control upgrades and repaints after a page rebuilds markup. */
  function refresh(root) {
    upgradeSwitches(root);
    upgradeMeters(root);
    upgradeNameFields(root);
    document.querySelectorAll("input[data-range-ready]").forEach(paintMeter);
    document.querySelectorAll("input[data-fmt-ready]").forEach((i) =>
      i.dispatchEvent(new Event("ui:render")));
    document.querySelectorAll(".fmt").forEach((wrap) => {
      const input = wrap.querySelector("input");
      const view = wrap.querySelector(".fmt-view");
      if (input && view && !wrap.classList.contains("editing")) {
        view.innerHTML = typeof LegacyText !== "undefined"
          ? LegacyText.toHtml(input.value || "", escHtml)
          : escHtml(input.value || "");
      }
    });
    growthPaint();
  }

  return {
    icon, logo, initShell, refresh, selectPane, screen, mainView,
    setTheme, currentTheme, growthSegments, growthPaint, escHtml,
  };
})();
