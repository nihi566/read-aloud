// ページ上に浮かべた操作ボックスを、ドラッグしても画面の外へ出さないことを確かめる。
//
//   node --test "test/*.test.mjs"

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({});
vm.runInContext(readFileSync(path.join(ROOT, "js/fab.js"), "utf8"), context);
const clamp = (...args) => JSON.parse(JSON.stringify(context.clampFabPosition(...args)));

const box = { width: 300, height: 80 };
const viewport = { width: 1280, height: 720 };

test("画面の中に収まる位置はそのまま使う", () => {
  assert.deepEqual(clamp({ right: 100, top: 200 }, box, viewport), { right: 100, top: 200 });
});

test("左・下へはみ出す位置は、ボックスが画面の端に接する位置まで戻す", () => {
  assert.deepEqual(clamp({ right: 5000, top: 5000 }, box, viewport), { right: 980, top: 640 });
});

test("右・上へはみ出す位置は 0 に戻す", () => {
  assert.deepEqual(clamp({ right: -40, top: -10 }, box, viewport), { right: 0, top: 0 });
});

test("画面より大きいボックスは右上の角に付ける", () => {
  assert.deepEqual(clamp({ right: 50, top: 50 }, { width: 2000, height: 900 }, viewport), { right: 0, top: 0 });
});

test("保存した位置が壊れていても右上の角に置く", () => {
  assert.deepEqual(clamp({ right: "x", top: undefined }, box, viewport), { right: 0, top: 0 });
});
