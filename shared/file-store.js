/* Shared, cross-page persistent store for uploaded/created config file text,
 * backing the "config files" dock (shared/file-dock.js) in crop-designer,
 * consumable-designer and farmland-designer.
 *
 * Each tool used to keep its dock entries in its OWN localStorage draft, so
 * a file uploaded/created in one tool vanished from the dock the moment you
 * navigated to a different tool page. This stores them under one shared key
 * instead, so the dock is the same file list on every page.
 *
 * FileStore.all()                -> [{name, text}]
 * FileStore.remember(name, text) -> upserts by name and persists immediately
 * FileStore.clear()
 */
"use strict";

const FileStore = (() => {
  const KEY = "c4-tools-files-v1";

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function persist(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* full/blocked */ }
  }

  function all() { return load(); }

  function remember(name, text) {
    const list = load();
    const existing = list.find(f => f.name === name);
    if (existing) existing.text = text;
    else list.push({ name, text });
    persist(list);
  }

  function clear() { persist([]); }

  return { all, remember, clear };
})();
