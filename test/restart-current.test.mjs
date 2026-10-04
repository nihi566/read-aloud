// 読み上げ中に声や速さを変えたとき、今読んでいる部分を新しい設定で同じ位置から読み直すことを確かめる
// （js/document.js の Doc.restartCurrent）。音声と設定の読み書きは偽物にする。
//
//   node --test "test/*.test.mjs"

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");

function setup() {
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
  const context = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval, chrome: noop,
    navigator: { userAgent: "Chrome" },
  });
  vm.runInContext(read("js/rxjs.umd.min.js"), context);
  vm.runInContext(read("js/defaults.js"), context);
  vm.runInContext(read("js/document.js"), context);

  const settings = { voiceName: "OpenAI piper-male", "rateOpenAI piper-male": 1 };
  const speeches = [];
  context.getSettings = async () => ({ ...settings });
  context.getSetting = async (name) => settings[name];
  context.getSpeechVoice = async (voiceName) => ({ voiceName });
  context.Speech = function (texts, options) {
    this.texts = texts;
    this.options = options;
    this.calls = [];
    this.index = 0;
    this.onEnd = null;
    this.getInfo = () => ({ texts: ["一文目。", "二文目。", "三文目。"], position: { index: this.index } });
    this.play = () => { this.calls.push("play"); };
    this.seek = (n) => { this.calls.push(`seek ${n}`); };
    this.stop = () => {
      this.calls.push("stop");
      if (this.onEnd) this.onEnd({ name: "CancellationException" });
    };
    speeches.push(this);
  };
  const ended = [];
  const source = {
    ready: Promise.resolve({ lang: "ja-JP", detectedLang: "ja" }),
    getCurrentIndex: async () => 0,
    getTexts: async (i) => (i === 0 ? ["一文目。二文目。三文目。"] : null),
    close() {},
  };
  const doc = new context.Doc(source, (err) => ended.push(err));
  return { doc, settings, speeches, ended };
}

test("読み上げ中に速さを変えると、今の文から新しい速さで読み直す", async () => {
  const { doc, settings, speeches, ended } = setup();
  await doc.play();
  assert.equal(speeches.length, 1);
  speeches[0].index = 1;

  settings["rateOpenAI piper-male"] = 1.5;
  await doc.restartCurrent();

  assert.equal(speeches.length, 2);
  assert.deepEqual(speeches[0].calls, ["play", "stop"]);
  assert.equal(speeches[1].options.rate, 1.5);
  assert.deepEqual(speeches[1].calls, ["seek 1"]);
  assert.deepEqual(Array.from(speeches[1].texts), Array.from(speeches[0].texts));
  // 止めた方の読み上げの終わりを、読み上げ全体の終わり（エラー）として扱わない
  assert.deepEqual(ended, []);
});

test("読み上げ中に声を変えると、新しい声で読み直す", async () => {
  const { doc, settings, speeches } = setup();
  await doc.play();
  settings.voiceName = "OpenAI sbv2-amitaro";
  await doc.restartCurrent();
  assert.equal(speeches[1].options.voice.voiceName, "OpenAI sbv2-amitaro");
  assert.deepEqual(speeches[1].calls, ["play"]);
});

test("新しい読み上げの文の数が減っても、範囲の中の位置から読み直す", async () => {
  const { doc, speeches } = setup();
  await doc.play();
  speeches[0].index = 7;
  await doc.restartCurrent();
  assert.deepEqual(speeches[1].calls, ["seek 2"]);
});

test("読み上げていないときは何もしない", async () => {
  const { doc, speeches } = setup();
  await doc.restartCurrent();
  assert.equal(speeches.length, 0);
});
