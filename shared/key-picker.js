/* Shared autocomplete dropdown with texture previews for Minecraft key inputs.
 *
 * Replaces the native <datalist> on block/item key fields so each suggestion
 * shows a small texture thumbnail (via MCAssets) before it is selected, and so
 * each field only offers keys of the right kind (blocks for block fields,
 * items for item fields - wrong-kind keys fail to parse in the plugin).
 *
 * Usage: give any <input> a data-keys attribute naming a list below, e.g.
 *   <input data-keys="blocks">          - single key
 *   <input data-keys="blocks" data-multi> - comma separated; completes the
 *                                           segment under the caret's end
 * Works with inputs created at any time (event delegation - one document
 * listener set, no per-input wiring). Selecting a suggestion dispatches a
 * bubbling "input" event so existing handlers run unchanged. Free text is
 * still allowed; the dropdown is suggestions only.
 *
 * Requires mc-keys.js (key lists) and mc-assets.js (textures) loaded first.
 */
"use strict";

const KeyPicker = (() => {
  // list name -> { keys, icon } - icon decides which texture loader is used.
  const LISTS = {
    "blocks":      { keys: () => MCKeys.BLOCKS,       icon: "block" },
    "items":       { keys: () => MCKeys.ITEMS,        icon: "item"  },
    "item-models": { keys: () => MCKeys.ITEM_MODELS,  icon: "item"  },
    "blockstates": { keys: () => MCKeys.BLOCK_STATES, icon: "block" },
    "fertilizers": { keys: () => MCKeys.FERTILIZERS,  icon: "item"  },
    "hoes":        { keys: () => MCKeys.HOES,         icon: "item"  },
    "hydration":   { keys: () => MCKeys.HYDRATION,    icon: "block" },
  };

  let drop = null;      // the singleton dropdown element
  let input = null;     // input the dropdown is currently attached to
  let rows = [];        // [{key, el, canvas, visible, painted}]
  let active = -1;      // keyboard-highlighted row index
  let observer = null;  // lazy-paints rows as they scroll into view

  function ensureDrop() {
    if (drop) return drop;
    drop = document.createElement("div");
    drop.className = "kp-drop";
    drop.hidden = true;
    document.body.appendChild(drop);
    // mousedown (not click) so the pick lands before the input's blur
    drop.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const row = e.target.closest(".kp-row");
      if (row) pick(rows[+row.dataset.i].key);
    });
    // Lists are unbounded, so textures are only requested for rows actually
    // scrolled into view; without this an empty query would fetch every
    // texture in the game at once.
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const r = rows[+entry.target.dataset.i];
        if (r && entry.isIntersecting) { r.visible = true; paintRow(r); }
      }
    }, { root: drop, rootMargin: "100px" });
    MCAssets.onReady(() => { if (!drop.hidden) paintRows(); });
    return drop;
  }

  /** The text being completed and its replace-range within the value. */
  function segment(inp) {
    const v = inp.value;
    if (inp.dataset.multi === undefined) return { text: v, start: 0, end: v.length };
    const start = v.lastIndexOf(",") + 1;
    return { text: v.slice(start), start, end: v.length };
  }

  function matchesFor(listDef, query) {
    const q = query.trim().toLowerCase();
    const keys = listDef.keys();
    if (!q) return keys;
    const starts = [], contains = [];
    for (const k of keys) {
      const lk = k.toLowerCase();
      const i = lk.indexOf(q);
      if (i === 0 || lk.startsWith("minecraft:" + q)) starts.push(k);
      else if (i > 0) contains.push(k);
    }
    return starts.concat(contains);
  }

  function texFor(listDef, key) {
    return listDef.icon === "block"
      ? MCAssets.blockSprite(key)
      : MCAssets.item(key.replace(/^minecraft:/, ""));
  }

  function paintRow(r) {
    const listDef = input && LISTS[input.dataset.keys];
    if (!listDef || r.painted) return;
    const tex = texFor(listDef, r.key);
    const g = r.canvas.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 16, 16);
    if (tex) { g.drawImage(tex, 0, 0, 16, 16); r.painted = true; }
    else { g.fillStyle = MCAssets.colorFor(r.key); g.fillRect(2, 2, 12, 12); }
  }

  /** Repaints the rows already scrolled into view (texture arrivals). */
  function paintRows() {
    for (const r of rows) if (r.visible) paintRow(r);
  }

  function open(inp) {
    const listDef = LISTS[inp.dataset.keys];
    if (!listDef) return;
    input = inp;
    const matches = matchesFor(listDef, segment(inp).text);
    if (!matches.length) { close(); return; }
    const d = ensureDrop();
    observer.disconnect();
    d.innerHTML = "";
    rows = matches.map((key, i) => {
      const el = document.createElement("div");
      el.className = "kp-row";
      el.dataset.i = i;
      const canvas = document.createElement("canvas");
      canvas.width = 16; canvas.height = 16;
      el.appendChild(canvas);
      el.appendChild(document.createTextNode(key));
      d.appendChild(el);
      observer.observe(el);
      return { key, el, canvas, visible: false, painted: false };
    });
    active = -1;
    d.scrollTop = 0;
    const r = inp.getBoundingClientRect();
    d.style.left = `${r.left + window.scrollX}px`;
    d.style.top = `${r.bottom + window.scrollY + 2}px`;
    d.style.minWidth = `${Math.max(r.width, 200)}px`;
    d.hidden = false;
  }

  function close() {
    if (drop) drop.hidden = true;
    if (observer) observer.disconnect();
    rows = [];
    active = -1;
    input = null;
  }

  function pick(key) {
    if (!input) return;
    const seg = segment(input);
    const lead = seg.start > 0 ? input.value.slice(0, seg.start) + " " : "";
    input.value = lead + key;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const inp = input;
    close();
    inp.focus();
  }

  function setActive(i) {
    if (!rows.length) return;
    if (active >= 0) rows[active].el.classList.remove("active");
    active = (i + rows.length) % rows.length;
    rows[active].el.classList.add("active");
    rows[active].el.scrollIntoView({ block: "nearest" });
  }

  document.addEventListener("focusin", (e) => {
    if (e.target.matches?.("input[data-keys]")) open(e.target);
    else if (input) close();
  });
  document.addEventListener("input", (e) => {
    if (e.target === input || e.target.matches?.("input[data-keys]")) open(e.target);
  });
  document.addEventListener("focusout", (e) => {
    if (e.target === input) close();
  });
  document.addEventListener("keydown", (e) => {
    if (!input || drop.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(rows[active].key); }
    else if (e.key === "Escape") close();
  });

  return { LISTS };
})();
