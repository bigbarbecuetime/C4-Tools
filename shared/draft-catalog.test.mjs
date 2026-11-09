import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(fileURLToPath(import.meta.url));
const shared = readFileSync(join(root, "key-picker.js"), "utf8");
const consumables = readFileSync(join(root, "../consumable-designer/app.js"), "utf8");
const crops = readFileSync(join(root, "../crop-designer/app.js"), "utf8");

test("shared picker reads live drafts from all three designers", () => {
  assert.match(shared, /crop-designer-v4/);
  assert.match(shared, /farmland-designer-v1/);
  assert.match(shared, /consumable-designer-v1/);
  assert.match(shared, /globalThis\.DraftCatalog/);
  assert.match(shared, /farmlandKeys/);
  assert.match(shared, /consumableKeys/);
  assert.match(shared, /cropKeys/);
});

test("custom picker lists use the shared draft catalog", () => {
  assert.match(shared, /"crops"\s*:\s*\{/);
  assert.match(shared, /DraftCatalog\.cropKeys/);
  assert.match(shared, /DraftCatalog\.farmlandKeys/);
  assert.match(shared, /DraftCatalog\.consumableKeys/);
});

test("consumable ingredients autocomplete crop seeds and custom items", () => {
  assert.match(consumables, /function ingredientKeyList/);
  assert.match(consumables, /ingredientKeyList\(rule\.kind\)/);
  assert.match(consumables, /input\.dataset\.keys = ingredientKeyList\(draft\.kind\)/);
});

test("crop references treat standalone farmland and consumable drafts as valid", () => {
  assert.match(crops, /function knownFarmland/);
  assert.match(crops, /DraftCatalog\.farmland\(key\)/);
  assert.match(crops, /function knownConsumable/);
  assert.match(crops, /DraftCatalog\.consumable\(key\)/);
  assert.match(crops, /No farmland draft or upload/);
  assert.match(crops, /No consumable draft or upload/);
});
