// OpenAI 互換の声で日本語を読むとき、1 回に送る文章が 1 文になることを確かめる。
// 拡張機能のページと同じく rxjs・defaults.js・speech.js を読み込み、音声の部分だけ偽物にして
// Speech が作る読み上げ単位（getInfo().texts）を見る。
//
//   node --test "test/*.test.mjs"

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 分岐元の本家のコミット。OpenAI 互換以外の声の区切りがこれと同じであることを確かめる
const BASE_SHA = "b590ee60a6fb80c0446597dac924d755823bca95";

const ENGINES = [
  "browserTtsEngine", "googleTranslateTtsEngine", "phoneTtsEngine", "piperTtsEngine", "supertonicTtsEngine",
  "nghiTtsEngine", "openaiTtsEngine", "amazonPollyTtsEngine", "googleWavenetTtsEngine", "ibmWatsonTtsEngine",
  "azureTtsEngine", "premiumTtsEngine",
];

function read(file) {
  return readFileSync(path.join(ROOT, file), "utf8");
}

// speechSource を読み込んだ環境で Speech を作り、読み上げ単位を返す関数
function loadSpeech(speechSource) {
  // chrome.* は読み込み時に触られないので、何を呼んでも何もしない物で足りる
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
  const context = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval, chrome: noop,
    navigator: { userAgent: "Chrome" },
  });
  vm.runInContext(read("js/rxjs.umd.min.js"), context);
  vm.runInContext(read("js/defaults.js"), context);
  for (const name of ENGINES) {
    context[name] = { speak: () => context.rxjs.NEVER, prepare() {}, getVoices: () => [] };
  }
  // TimeoutTtsEngine は tts-engines.js にあるので、Google の標準音声向けに素通しの物を置く
  vm.runInContext("function TimeoutTtsEngine(engine) { return engine }", context);
  vm.runInContext(speechSource, context);
  return (texts, voiceName, lang) => {
    const speech = new context.Speech([...texts], { voice: { voiceName }, lang });
    const chunks = Array.from(speech.getInfo().texts);
    speech.stop();
    return chunks;
  };
}

const chunksOf = loadSpeech(read("js/speech.js"));
const baseChunksOf = loadSpeech(execFileSync("git", ["show", `${BASE_SHA}:js/speech.js`], { cwd: ROOT, encoding: "utf8" }));

const OPENAI = "OpenAI sbv2-amitaro";

test("日本語の 3 文は 3 つに分かれる", () => {
  assert.deepEqual(chunksOf(["今日は晴れです。明日は雨です。明後日は曇りです。"], OPENAI, "ja"), [
    "今日は晴れです。",
    "明日は雨です。",
    "明後日は曇りです。",
  ]);
});

test("「！」と全角の「？」でも分かれる", () => {
  assert.deepEqual(chunksOf(["元気ですか？はい！それは良かった。"], OPENAI, "ja-JP"), [
    "元気ですか？",
    "はい！",
    "それは良かった。",
  ]);
});

test("段落の区切り（改行 2 つ以上）でも分かれ、短い段落どうしをまとめない", () => {
  assert.deepEqual(chunksOf(["見出し", "本文の一文目。本文の二文目。"], OPENAI, "ja"), [
    "見出し\n\n",
    "本文の一文目。",
    "本文の二文目。",
  ]);
});

test("空白だけの単位を作らない（句点で終わる段落の後の改行は前の文に付ける）", () => {
  assert.deepEqual(chunksOf(["一段落目の文。", "二段落目の文。 ", "三段落目？"], OPENAI, "ja"), [
    "一段落目の文。\n\n",
    "二段落目の文。 \n\n",
    "三段落目？",
  ]);
});

test("文の終わりの後の閉じかっこは、その文に付ける（閉じかっこだけの単位を作らない）", () => {
  assert.deepEqual(chunksOf(["「行く。」と言った。「元気？」と聞いた。", "「わかった！」"], OPENAI, "ja"), [
    "「行く。」",
    "と言った。",
    "「元気？」",
    "と聞いた。\n\n",
    "「わかった！」",
  ]);
});

test("「？？」は 1 つの文の終わりとして扱う", () => {
  assert.deepEqual(chunksOf(["本当に？？うそでしょう。"], OPENAI, "ja"), ["本当に？？", "うそでしょう。"]);
});

test("CRLF の段落の区切りでも、空白だけの単位を作らない", () => {
  assert.deepEqual(chunksOf(["一つ目。\r\n\r\n二つ目。"], OPENAI, "ja"), ["一つ目。\r\n\r\n", "二つ目。"]);
});

test("750 字を超える 1 文は 750 字以内に分かれ、文字が欠けない", () => {
  const phrase = "とても長い文が続きます、";
  const sentence = phrase.repeat(100) + "終わり。";
  const chunks = chunksOf([`前の文。${sentence}後の文。`], OPENAI, "ja");
  assert.equal(chunks[0], "前の文。");
  assert.equal(chunks[chunks.length - 1], "後の文。");
  const middle = chunks.slice(1, -1);
  assert.ok(middle.length >= 2, `長い文が分かれていない: ${middle.length} 個`);
  assert.ok(middle.every((c) => c.length <= 750), `750 字を超える単位がある: ${middle.map((c) => c.length)}`);
  // 本家の規則（読点で区切ってから 750 字までまとめる）と同じ分け方になる
  assert.deepEqual(middle, baseChunksOf([sentence], "Microsoft Haruka", "ja"));
  assert.equal(middle.join(""), sentence);
});

test("OpenAI 互換以外の声の区切りは本家と同じ", () => {
  const long = "とても長い文が続きます、".repeat(100) + "終わり。";
  const samples = [
    ["今日は晴れです。明日は雨です。元気ですか？明後日は曇りです。"],
    ["見出し", "本文の一文目。本文の二文目。"],
    [`前の文。${long}後の文。元気ですか？はい！`],
    ["This is English. It has sentences! Does it work? Yes."],
  ];
  const voices = [
    ["Microsoft Haruka", "ja"],
    ["Google 日本語", "ja"],
    ["Piper hi_fi_captain-medium female (日本語)", "ja"],
    ["GoogleWavenet ja-JP-Wavenet-A", "ja"],
    ["AmazonPolly Mizuki", "ja"],
    ["Azure ja-JP-NanamiNeural", "ja"],
    [OPENAI, "en"],
    [OPENAI, "zh-CN"],
  ];
  for (const [voiceName, lang] of voices) {
    for (const texts of samples) {
      assert.deepEqual(chunksOf(texts, voiceName, lang), baseChunksOf(texts, voiceName, lang), `${voiceName} / ${lang}`);
    }
  }
});
