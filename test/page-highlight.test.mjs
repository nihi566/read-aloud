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

// ページ上の文を Alt+クリックすると、その文から読み直す（クリックした位置の前後の文字で、読んでいる文の並びから探す）
const textAroundPoint = (...args) => JSON.parse(JSON.stringify(context.textAroundPoint(...args)));
const clicked = (texts, nodes, node, offset) => context.findClickedSentence(texts, textAroundPoint(nodes, node, offset));
const SENTENCES = ["今日は雨です。", "傘を持って出かけましょう。", "明日は晴れます。"];

test("クリックした位置の前後の文字を、空白を除いて取る", () => {
  assert.deepEqual(textAroundPoint(["今日は 雨です。", "傘を"], 1, 1), { before: "今日は雨です。傘", after: "を", index: 8 });
  // 空白の上を押したら、その後ろの文字から
  assert.deepEqual(textAroundPoint(["今日は 雨"], 0, 3), { before: "今日は", after: "雨", index: 3 });
});

test("Alt+クリックで前の同じ文へ戻ったときは、クリックした所の文に色を付ける", () => {
  const nodes = ["はい。", "いいえ。", "はい。"];
  // 3 文目まで読んだ後（cursor は末尾）に 1 文目をクリックした
  assert.equal(findSentence(nodes, "はい。", 10, 1).start.node, 0);
  // クリックした所に無い文なら、今までどおり cursor から探す
  assert.equal(findSentence(nodes, "はい。", 3, 4).start.node, 2);
});

test("クリックした文の番号を返す（テキストノードの切れ目・改行をまたいでも）", () => {
  const nodes = ["今日は雨です。傘を持って", "出かけ\n  ましょう。明日は晴れます。"];
  assert.equal(clicked(SENTENCES, nodes, 0, 0), 0);
  assert.equal(clicked(SENTENCES, nodes, 1, 2), 1);
  assert.equal(clicked(SENTENCES, nodes, 1, nodes[1].indexOf("明")), 2);
  assert.equal(clicked(SENTENCES, nodes, 1, nodes[1].length - 1), 2);
});

test("同じ文が 2 回あるときは、前の文字で見分ける", () => {
  const texts = ["はい。", "いいえ。", "はい。"];
  const nodes = ["はい。いいえ。はい。"];
  assert.equal(clicked(texts, nodes, 0, 0), 0);
  assert.equal(clicked(texts, nodes, 0, 7), 2);
});

test("置き換えで読む文が少し変わっていても、近くの文字で見つける", () => {
  const texts = ["読み上げソフトでは東雲と書いて", "シノノメと読みます。", "次の文です。"];
  const nodes = ["読み上げソフトでは東雲と書いてしののめと読みます。次の文です。"];
  assert.equal(clicked(texts, nodes, 0, nodes[0].indexOf("と読み")), 1);
  assert.equal(clicked(texts, nodes, 0, nodes[0].indexOf("次")), 2);
});

test("読んでいる文の並びに無い所を押したら -1", () => {
  assert.equal(clicked(SENTENCES, ["まったく関係のない段落の文章です。"], 0, 3), -1);
  assert.equal(clicked(SENTENCES, ["   "], 0, 1), -1);
});
