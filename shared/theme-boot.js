/* theme-boot.js (shared) - resolves the light/dark theme onto <html> before
 * the first paint, so a light-mode visitor never sees the dark default flash
 * in. Load it as a blocking script in <head>, ahead of common.css. ui.js then
 * keeps the toggle in sync and saves changes under the same "c4-theme" key.
 */
"use strict";

(() => {
  let t = null;
  try { t = localStorage.getItem("c4-theme"); } catch (e) { /* file:// with storage off */ }
  if (t !== "light" && t !== "dark") {
    t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  document.documentElement.setAttribute("data-theme", t);
})();
