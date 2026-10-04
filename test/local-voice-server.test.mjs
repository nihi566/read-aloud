// このパソコンの音声サーバー（read-aloud-piper-ja）の声の一覧を、サーバーから自動で読むことを確かめる。
// js/local-voice-server.js を拡張機能のページと同じく素のスクリプトとして読み込み、fetch だけ偽物にする。
//
//   node --test "test/*.test.mjs"

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function load(fetchImpl) {
  const calls = [];
  const context = vm.createContext({
    console: { ...console, error() {} },
    URL,
    AbortSignal,
    fetch: async (url, opts) => {
      calls.push(String(url));
      return fetchImpl(String(url), opts);
    },
  });
  vm.runInContext(readFileSync(path.join(ROOT, "js/local-voice-server.js"), "utf8"), context);
  return { ctx: context, calls };
}

const SERVER_LIST = [
  { voice: "sbv2-amitaro", lang: "ja-JP", model: "sbv2" },
  { voice: "piper-male", lang: "ja-JP", model: "piper" },
];
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const plain = (list) => JSON.parse(JSON.stringify(list));

test("127.0.0.1 と localhost の http はこのパソコンのサーバー、ほかは違う", () => {
  const { ctx } = load(() => ok([]));
  assert.equal(ctx.isLocalVoiceServer("http://127.0.0.1:5123/v1"), true);
  assert.equal(ctx.isLocalVoiceServer("http://localhost:5123/v1"), true);
  assert.equal(ctx.isLocalVoiceServer("https://api.openai.com/v1"), false);
  assert.equal(ctx.isLocalVoiceServer("not a url"), false);
  assert.equal(ctx.isLocalVoiceServer(undefined), false);
});

test("このパソコンのサーバーなら、保存した Voice List ではなくサーバーの /voice-list を使う", async () => {
  const { ctx, calls } = load(() => ok(SERVER_LIST));
  const creds = { url: "http://127.0.0.1:5123/v1", voiceList: [{ voice: "sbv2-jvnv-F1-jp", lang: "ja-JP", model: "sbv2" }] };
  assert.deepEqual(plain(await ctx.getOpenaiVoiceList(creds, [])), SERVER_LIST);
  assert.deepEqual(calls, ["http://127.0.0.1:5123/voice-list"]);
});

test("OpenAI 枠を登録していなくても、このパソコンのサーバーの声を使う", async () => {
  const { ctx, calls } = load(() => ok(SERVER_LIST));
  assert.deepEqual(plain(await ctx.getOpenaiVoiceList(null, [])), SERVER_LIST);
  assert.deepEqual(calls, ["http://127.0.0.1:5123/voice-list"]);
  assert.deepEqual(plain(ctx.effectiveOpenaiCreds(null)), { url: "http://127.0.0.1:5123/v1", apiKey: "" });
});

test("サーバーが応答しない・壊れた応答なら、保存した Voice List（無ければ空）に戻る", async () => {
  const stored = [{ voice: "piper-male", lang: "ja-JP", model: "piper" }];
  const creds = { url: "http://127.0.0.1:5123/v1", voiceList: stored };
  for (const fetchImpl of [
    () => { throw new TypeError("Failed to fetch"); },
    () => ({ ok: false, status: 404, json: async () => ({}) }),
    () => ok({ not: "a list" }),
    () => ok([{ voice: "" }]),
  ]) {
    const { ctx } = load(fetchImpl);
    assert.deepEqual(plain(await ctx.getOpenaiVoiceList(creds, [])), stored);
    assert.deepEqual(plain(await ctx.getOpenaiVoiceList(null, [])), []);
  }
});

test("ほかのサーバーは今までどおり保存した Voice List（無ければ標準の一覧）を使い、問い合わせない", async () => {
  const { ctx, calls } = load(() => ok(SERVER_LIST));
  const defaults = [{ voice: "alloy", langs: ["en-US"], model: "tts-1" }];
  const stored = [{ voice: "nova", langs: ["en-US"], model: "tts-1" }];
  assert.deepEqual(plain(await ctx.getOpenaiVoiceList({ url: "https://api.openai.com/v1", voiceList: stored }, defaults)), stored);
  assert.deepEqual(plain(await ctx.getOpenaiVoiceList({ url: "https://api.openai.com/v1" }, defaults)), defaults);
  assert.deepEqual(calls, []);
});

test("合成するときの声の情報: 保存した Voice List に無くても、このパソコンのサーバーなら声の名前だけで頼む", () => {
  const { ctx } = load(() => ok([]));
  const stored = [{ voice: "piper-male", lang: "ja-JP", model: "piper" }];
  assert.deepEqual(plain(ctx.openaiVoiceInfo({ url: "http://127.0.0.1:5123/v1", voiceList: stored }, "piper-male")), stored[0]);
  assert.deepEqual(plain(ctx.openaiVoiceInfo({ url: "http://127.0.0.1:5123/v1", voiceList: stored }, "sbv2-amitaro")), { voice: "sbv2-amitaro" });
  assert.deepEqual(plain(ctx.openaiVoiceInfo(ctx.effectiveOpenaiCreds(null), "sbv2-amitaro")), { voice: "sbv2-amitaro" });
  assert.equal(ctx.openaiVoiceInfo({ url: "https://api.openai.com/v1", voiceList: stored }, "sbv2-amitaro"), undefined);
});
