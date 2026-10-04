// ページ上の強調表示で、読んでいる文をページの文字（テキストノードの並び）の中から見つけられることを確かめる。
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
vm.runInContext(readFileSync(path.join(ROOT, "js/page-highlight.js"), "utf8"), context);
const findSentence = (...args) => JSON.parse(JSON.stringify(context.findSentence(...args)));

test("1 つのテキストノードの中の文の位置を返す", () => {
  const nodes = ["今日は雨です。傘を持って出かけましょう。"];
  assert.deepEqual(findSentence(nodes, "傘を持って出かけましょう。", 0), {
    start: { node: 0, offset: 7 },
    end: { node: 0, offset: 20 },
    endIndex: 20,
  });
});

test("改行・空白の違いとノードの切れ目をまたいで見つける", () => {
  const nodes = ["プロセス起動方式と同じように、", "Web", "サーバと\n  Webアプリケーションは分離されています。"];
  const found = findSentence(nodes, "プロセス起動方式と同じように、Webサーバと Webアプリケーションは分離されています。", 0);
  assert.deepEqual(found.start, { node: 0, offset: 0 });
  assert.deepEqual(found.end, { node: 2, offset: nodes[2].length });
});

test("同じ文が 2 回あるときは、前に読んだ位置より後ろを選ぶ", () => {
  const nodes = ["はい。", "いいえ。", "はい。"];
  const first = findSentence(nodes, "はい。", 0);
  assert.equal(first.start.node, 0);
  const second = findSentence(nodes, "はい。", first.endIndex + 4);
  assert.equal(second.start.node, 2);
});

test("前に読んだ位置より後ろに無ければ先頭から探す（読み戻したとき）", () => {
  const nodes = ["一文目です。", "二文目です。"];
  assert.equal(findSentence(nodes, "一文目です。", 100).start.node, 0);
});

test("英語の文の末尾に読み上げ側が足した「.」を無視する", () => {
  const nodes = ["Chapter One"];
  assert.deepEqual(findSentence(nodes, "Chapter One.", 0).end, { node: 0, offset: 11 });
});

test("置き換えで文の後半が変わっていても、先頭 10 文字で位置を見つける", () => {
  const nodes = ["読み上げソフトでは東雲と書いてしののめと読みます。"];
  const found = findSentence(nodes, "読み上げソフトでは東雲と書いてシノノメと読みます。", 0);
  assert.deepEqual(found.start, { node: 0, offset: 0 });
});

test("見つからない文は null", () => {
  assert.equal(findSentence(["今日は雨です。"], "まったく別の短い文", 0), null);
  assert.equal(findSentence(["今日は雨です。"], "   ", 0), null);
});
