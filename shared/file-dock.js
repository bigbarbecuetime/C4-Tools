/* Shared bottom "config files" list for the designers.
 *
 * Renders every config file the tool created or uploaded this session as a
 * collapsible dropdown (<details>) with copy / download buttons. Entries the
 * tool created or changed carry a "new" badge; raw uploaded copies don't.
 *
 * FileDock.render(root, entries)
 *   root    - container element
 *   entries - [{ name, text, badge?, open? }]
 *     name  - display path, e.g. "farming/Tomato.yml" (download strips dirs)
 *     text  - file contents
 *     badge - optional badge label, e.g. "new"
 *     open  - expanded on first render (user toggles are preserved after)
 */
"use strict";

const FileDock = (() => {
  function render(root, entries) {
    // preserve the user's expand/collapse choices across re-renders
    const openState = {};
    for (const d of root.querySelectorAll("details[data-name]")) {
      openState[d.dataset.name] = d.open;
    }
    root.innerHTML = "";
    if (!entries.length) {
      root.innerHTML = `<p class="hint">No config files yet.</p>`;
      return;
    }
    for (const entry of entries) {
      const d = document.createElement("details");
      d.dataset.name = entry.name;
      d.open = openState[entry.name] ?? !!entry.open;
      d.className = "dock-file";
      d.innerHTML = `
        <summary>
          <span class="dock-name">${escapeHtml(entry.name)}</span>
          ${entry.badge ? `<span class="badge-new">${escapeHtml(entry.badge)}</span>` : ""}
          <span class="grow"></span>
          <button class="ghost copy" data-copy>copy</button>
          <button class="ghost" data-dl>download</button>
        </summary>
        <pre></pre>`;
      d.querySelector("pre").textContent = entry.text;
      // buttons live inside <summary>; stop them from toggling the details
      d.querySelector("[data-copy]").addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        const btn = e.currentTarget;
        navigator.clipboard.writeText(entry.text).then(() => {
          btn.classList.add("copied"); btn.textContent = "copied!";
          setTimeout(() => { btn.classList.remove("copied"); btn.textContent = "copy"; }, 1200);
        });
      });
      d.querySelector("[data-dl]").addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        const blob = new Blob([entry.text], { type: "text/yaml" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = entry.name.split("/").pop();
        a.click();
        URL.revokeObjectURL(a.href);
      });
      root.appendChild(d);
    }
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  return { render };
})();
