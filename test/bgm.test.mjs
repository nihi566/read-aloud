// 読み上げ中に YouTube Music の再生リストを BGM として流す仕組み（js/bgm.js）を確かめる。
// 拡張機能のページと同じく素のスクリプトとして読み込み、タブ・スクリプト実行・設定の読み書きを偽物にする。
//
//   node --test "test/*.test.mjs"

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAYLIST = "https://music.youtube.com/playlist?list=RDCLAK5uy_kIo7ENcKugr9X4-Csjb7vaqkNlbR7s_WU";
const LIST_ID = "RDCLAK5uy_kIo7ENcKugr9X4-Csjb7vaqkNlbR7s_WU";
// vm の中で作られた値は別の Object を持つので、比べる前に素のデータへ直す
const plain = (x) => JSON.parse(JSON.stringify(x));

// playerState: YouTube のプレーヤーの状態（1 = 再生中、2 = 一時停止、-1 = 未開始）
// session: ブラウザを閉じると消える保存場所（BGM のタブの番号を置く）
// onPlayCall: ページで playVideo を呼ぶたびに呼ばれる（途中で止める操作を割り込ませる）
function load({ settings = {}, session = {}, tabs = {}, playerState = 1, playerReady = true, permitted = true, onPlayCall } = {}) {
  const store = { ...settings };
  const sessionStore = { ...session };
  const tabsById = { ...tabs };
  const calls = [];
  let nextTabId = 100;
  const brapi = {
    permissions: { async contains() { return permitted; } },
    storage: {
      session: {
        async get(name) { return { [name]: sessionStore[name] }; },
        async set(items) { Object.assign(sessionStore, items); },
      },
    },
    tabs: {
      async reload(id) {
        tabsById[id].discarded = false;
        calls.push(["reload", id]);
      },
      async get(id) {
        if (!tabsById[id]) throw new Error("No tab with id: " + id);
        return tabsById[id];
      },
      async create(props) {
        const tab = { id: nextTabId++, url: props.url, active: props.active, windowId: 1 };
        tabsById[tab.id] = tab;
        calls.push(["create", props]);
        return tab;
      },
      async update(id, props) {
        Object.assign(tabsById[id], props);
        calls.push(["update", id, props]);
        return tabsById[id];
      },
    },
    windows: { async update(id, props) { calls.push(["window", id, props]); } },
    scripting: {
      async executeScript({ target, func, args, world }) {
        calls.push(["script", target.tabId, func.name, args || [], world]);
        if (func.name == "bgmPagePlay") {
          if (onPlayCall) onPlayCall(store);
          return [{ result: playerReady }];
        }
        if (func.name == "bgmPageIsPlaying") return [{ result: playerState == 1 }];
        return [{ result: true }];
      },
    },
  };
  const context = vm.createContext({
    console: { ...console, error() {} },
    URL,
    setTimeout,
    brapi,
    getSettings: async (names) => Object.fromEntries((names || Object.keys(store)).map((n) => [n, store[n]])),
    getSetting: async (name) => store[name],
    updateSettings: async (items) => { Object.assign(store, items); },
  });
  vm.runInContext(readFileSync(path.join(ROOT, "js/bgm.js"), "utf8"), context);
  vm.runInContext("bgmTiming.pollMs = 1; bgmTiming.settleMs = 1; bgmTiming.readyTimeoutMs = 20", context);
  return { ctx: context, store, session: sessionStore, calls, tabsById };
}

test("再生リストの URL から再生リストの ID を取り出す", () => {
  const { ctx } = load();
  assert.equal(ctx.parseBgmPlaylistId(PLAYLIST), LIST_ID);
  assert.equal(ctx.parseBgmPlaylistId("https://music.youtube.com/watch?v=Ax57J2xaZ_w&list=PLabc_DEF-123"), "PLabc_DEF-123");
  assert.equal(ctx.parseBgmPlaylistId("https://www.youtube.com/playlist?list=PLabc_DEF-123"), "PLabc_DEF-123");
  assert.equal(ctx.parseBgmPlaylistId("  https://youtube.com/playlist?list=PLabc_DEF-123  "), "PLabc_DEF-123");
});

test("YouTube 以外・list の無い URL・おかしな ID は受け付けない", () => {
  const { ctx } = load();
  for (const url of [
    undefined,
    "",
    "再生リスト",
    "https://music.youtube.com/watch?v=Ax57J2xaZ_w",
    "https://example.com/playlist?list=PLabc_DEF-123",
    "https://music.youtube.com.example.com/playlist?list=PLabc_DEF-123",
    "http://music.youtube.com/playlist?list=PLabc_DEF-123",
    "javascript:alert(1)//?list=PLabc_DEF-123",
    "https://music.youtube.com/playlist?list=PL<script>",
  ]) {
    assert.equal(ctx.parseBgmPlaylistId(url), null, String(url));
  }
});

test("読み上げが始まると BGM を流し、一時停止・停止・読み終わりで止める", () => {
  const { ctx } = load();
  assert.equal(ctx.bgmActionFor("STOPPED", "LOADING"), "play");
  assert.equal(ctx.bgmActionFor("STOPPED", "PLAYING"), "play");
  assert.equal(ctx.bgmActionFor("PAUSED", "PLAYING"), "play");
  assert.equal(ctx.bgmActionFor("PLAYING", "PAUSED"), "pause");
  assert.equal(ctx.bgmActionFor("PLAYING", "STOPPED"), "pause");
  assert.equal(ctx.bgmActionFor("LOADING", "STOPPED"), "pause");
  // 変わっていない・文の切り替わり（読み込み ⇔ 再生）では何もしない
  assert.equal(ctx.bgmActionFor("PLAYING", "PLAYING"), null);
  assert.equal(ctx.bgmActionFor("PLAYING", "LOADING"), null);
  assert.equal(ctx.bgmActionFor("LOADING", "PLAYING"), null);
  assert.equal(ctx.bgmActionFor("STOPPED", "PAUSED"), null);
});

test("BGM のタブが無ければ裏で開き、保存した音量で再生する", async () => {
  const { ctx, store, session, calls } = load({ settings: { bgmPlaylistUrl: PLAYLIST, bgmVolume: 25 } });
  const result = await ctx.bgm.play();
  assert.equal(result.playing, true);
  const create = calls.find((c) => c[0] == "create");
  assert.equal(create[1].url, `https://music.youtube.com/watch?list=${LIST_ID}`);
  assert.equal(create[1].active, false);
  assert.ok(calls.some((c) => c[0] == "update" && c[2].pinned === true), "固定タブにする");
  // タブの番号はブラウザを再起動すると振り直されるので、閉じると消える場所に置く
  assert.equal(session.bgmTabId, 100);
  assert.equal(store.bgmTabId, undefined);
  const play = calls.find((c) => c[0] == "script" && c[2] == "bgmPagePlay");
  assert.deepEqual(plain([play[1], play[3], play[4]]), [100, [25], "MAIN"]);
});

test("ポップアップと再生画面が同時に流そうとしても、BGM のタブは 1 つしか開かない", async () => {
  const { ctx, calls } = load({ settings: { bgmPlaylistUrl: PLAYLIST } });
  await Promise.all([ctx.bgm.play(), ctx.bgm.play(), ctx.bgm.play()]);
  assert.equal(calls.filter((c) => c[0] == "create").length, 1);
});

test("広告などでプレーヤーの状態が未開始のままでも、音が出ていれば流れているとみなす", () => {
  const { ctx } = load();
  const page = (state, videoPaused) => {
    ctx.document = {
      getElementById: () => ({ getPlayerState: () => state }),
      querySelector: () => (videoPaused == null ? null : { paused: videoPaused }),
    };
    return ctx.bgmPageIsPlaying();
  };
  assert.equal(page(1, null), true);
  assert.equal(page(3, true), true, "読み込み中");
  assert.equal(page(-1, false), true, "広告などで video だけ動いている");
  assert.equal(page(-1, true), false, "自動再生を止められた");
  assert.equal(page(2, true), false, "一時停止");
});

test("BGM の音量が未設定なら 30 で流す", async () => {
  const { ctx, calls } = load({ settings: { bgmPlaylistUrl: PLAYLIST } });
  await ctx.bgm.play();
  assert.deepEqual(plain(calls.find((c) => c[2] == "bgmPagePlay")[3]), [30]);
});

test("開いてある BGM のタブがあれば、新しく開かずにそれを使う", async () => {
  const { ctx, calls } = load({
    settings: { bgmPlaylistUrl: PLAYLIST }, session: { bgmTabId: 7 },
    tabs: { 7: { id: 7, url: `https://music.youtube.com/watch?v=x&list=${LIST_ID}`, windowId: 1 } },
  });
  await ctx.bgm.play();
  assert.ok(!calls.some((c) => c[0] == "create"));
  assert.equal(calls.find((c) => c[2] == "bgmPagePlay")[1], 7);
});

test("開いたばかりで読み込み中の BGM のタブも、新しく開かずにそれを使う", async () => {
  const { ctx, calls } = load({
    settings: { bgmPlaylistUrl: PLAYLIST }, session: { bgmTabId: 7 },
    tabs: { 7: { id: 7, url: "", pendingUrl: `https://music.youtube.com/watch?list=${LIST_ID}`, windowId: 1 } },
  });
  await ctx.bgm.play();
  assert.ok(!calls.some((c) => c[0] == "create"));
});

test("覚えているタブが閉じられていたり別のページになっていたら、新しく開く", async () => {
  for (const tabs of [{}, { 7: { id: 7, url: "https://example.com/", windowId: 1 } }]) {
    const { ctx, calls } = load({ settings: { bgmPlaylistUrl: PLAYLIST }, session: { bgmTabId: 7 }, tabs });
    await ctx.bgm.play();
    assert.ok(calls.some((c) => c[0] == "create"));
    assert.ok(!calls.some((c) => c[0] == "script" && c[1] == 7), "別のページを操作しない");
  }
});

test("ブラウザに自動再生を止められたら playing: false を返し、ポップアップが案内を出せるよう覚えておく", async () => {
  const { ctx, store } = load({ settings: { bgmPlaylistUrl: PLAYLIST }, playerState: -1 });
  const result = await ctx.bgm.play();
  assert.equal(result.playing, false);
  assert.equal(store.bgmBlocked, true);
});

test("流れれば自動再生を止められた印を消す。止めたり BGM のタブを開いたりしても消す", async () => {
  const tabs = { 7: { id: 7, url: "https://music.youtube.com/watch?list=x", windowId: 1 } };
  const played = load({ settings: { bgmPlaylistUrl: PLAYLIST, bgmBlocked: true }, session: { bgmTabId: 7 }, tabs });
  await played.ctx.bgm.play();
  assert.equal(played.store.bgmBlocked, false);
  const paused = load({ settings: { bgmBlocked: true }, session: { bgmTabId: 7 }, tabs });
  await paused.ctx.bgm.pause();
  assert.equal(paused.store.bgmBlocked, false);
  const shown = load({ settings: { bgmBlocked: true }, session: { bgmTabId: 7 }, tabs });
  await shown.ctx.bgm.showTab();
  assert.equal(shown.store.bgmBlocked, false);
});

test("流し始めるのを待っている間に止められたら、後から鳴らさない", async () => {
  // playVideo を呼んだ直後に「止める」が押された
  const { ctx, calls } = load({
    settings: { bgmPlaylistUrl: PLAYLIST },
    onPlayCall: (store) => { store.bgmPausedAt = Date.now() + 1000; },
  });
  const result = await ctx.bgm.play();
  assert.equal(result.playing, false);
  assert.equal(result.cancelled, true);
  const names = calls.filter((c) => c[0] == "script").map((c) => c[2]);
  assert.equal(names.at(-1), "bgmPagePause", "最後に止め直す");
});

test("読み上げが止まっていたり BGM がオフになっていたら、流し始めない", async () => {
  const { ctx, calls } = load({ settings: { bgmPlaylistUrl: PLAYLIST } });
  const result = await ctx.bgm.play({ shouldContinue: async () => false });
  assert.equal(result.cancelled, true);
  assert.ok(!calls.some((c) => c[2] == "bgmPagePlay"));
});

test("music.youtube.com の許可が無ければ、タブを開かずに分かる言葉で失敗する", async () => {
  const { ctx, calls } = load({ settings: { bgmPlaylistUrl: PLAYLIST }, permitted: false });
  await assert.rejects(ctx.bgm.play(), /許可/);
  assert.equal(calls.length, 0);
});

test("ブラウザがメモリ節約のため BGM のタブを破棄していたら、読み込み直してから流す", async () => {
  const { ctx, calls } = load({
    settings: { bgmPlaylistUrl: PLAYLIST }, session: { bgmTabId: 7 },
    tabs: { 7: { id: 7, url: "https://music.youtube.com/watch?list=x", windowId: 1, discarded: true } },
  });
  await ctx.bgm.play();
  assert.deepEqual(plain(calls[0]), ["reload", 7]);
  assert.ok(!calls.some((c) => c[0] == "create"));
});

test("読み上げに BGM を追従させる: 始まれば流し、止まれば止める。BGM がオフなら何もしない", async () => {
  const tabs = { 7: { id: 7, url: "https://music.youtube.com/watch?list=x", windowId: 1 } };
  const { ctx, store, calls } = load({ settings: { bgmPlaylistUrl: PLAYLIST, bgmEnabled: true }, session: { bgmTabId: 7 }, tabs });
  let reading = "STOPPED";
  const tick = ctx.makeBgmSync(async () => reading);
  const scripts = () => calls.filter((c) => c[0] == "script").map((c) => c[2]);
  reading = "PLAYING";
  await tick();
  assert.ok(scripts().includes("bgmPagePlay"));
  assert.equal(tick.isReading(), true);
  calls.length = 0;
  reading = "PAUSED";
  await tick();
  assert.deepEqual(plain(scripts()), ["bgmPagePause"]);
  calls.length = 0;
  store.bgmEnabled = false;
  reading = "PLAYING";
  await tick();
  assert.equal(calls.length, 0);
});

test("読み上げに BGM を追従させる: 流し始める途中で一時停止され、すぐ再開されたら、もう一度流す", async () => {
  const tabs = { 7: { id: 7, url: "https://music.youtube.com/watch?list=x", windowId: 1 } };
  let reading = "PLAYING";
  let paused = false;
  const { ctx, calls } = load({
    settings: { bgmPlaylistUrl: PLAYLIST, bgmEnabled: true }, session: { bgmTabId: 7 }, tabs,
    // 1 回目の playVideo の直後だけ一時停止されていた
    onPlayCall: () => { if (!paused) { paused = true; reading = "PAUSED"; } },
  });
  const tick = ctx.makeBgmSync(async () => reading);
  await tick();
  reading = "PLAYING";
  calls.length = 0;
  await tick();
  assert.ok(calls.some((c) => c[2] == "bgmPagePlay"), "再開したので流し直す");
});

test("読み上げに BGM を追従させる: 流し始めに失敗したら、次の確認でやり直す", async () => {
  const tabs = { 7: { id: 7, url: "https://music.youtube.com/watch?list=x", windowId: 1 } };
  const { ctx, calls } = load({ settings: { bgmPlaylistUrl: PLAYLIST, bgmEnabled: true }, session: { bgmTabId: 7 }, tabs, playerReady: false });
  const tick = ctx.makeBgmSync(async () => "PLAYING");
  await tick();
  const first = calls.filter((c) => c[2] == "bgmPagePlay").length;
  assert.ok(first > 0);
  await tick();
  assert.ok(calls.filter((c) => c[2] == "bgmPagePlay").length > first, "やり直している");
});

test("再生リストの URL が無いと、分かる言葉で失敗する", async () => {
  const { ctx, calls } = load();
  await assert.rejects(ctx.bgm.play(), /再生リスト/);
  assert.equal(calls.length, 0);
});

test("プレーヤーが出てこないと、分かる言葉で失敗する", async () => {
  const { ctx } = load({ settings: { bgmPlaylistUrl: PLAYLIST }, playerReady: false });
  await assert.rejects(ctx.bgm.play(), /YouTube Music/);
});

test("止める: BGM のタブが無ければ何もせず、あれば一時停止する", async () => {
  const none = load();
  await none.ctx.bgm.pause();
  assert.equal(none.calls.length, 0);

  const { ctx, calls } = load({
    session: { bgmTabId: 7 },
    tabs: { 7: { id: 7, url: "https://music.youtube.com/watch?list=x", windowId: 1 } },
  });
  await ctx.bgm.pause();
  assert.deepEqual(plain(calls.map((c) => [c[0], c[1], c[2]])), [["script", 7, "bgmPagePause"]]);
});

test("BGM の音量を変えると保存し、流れている曲にすぐ効かせる（0〜100 に収める）", async () => {
  const { ctx, store, calls } = load({
    session: { bgmTabId: 7 },
    tabs: { 7: { id: 7, url: "https://music.youtube.com/watch?list=x", windowId: 1 } },
  });
  await ctx.bgm.setVolume(140);
  assert.equal(store.bgmVolume, 100);
  await ctx.bgm.setVolume("12");
  assert.equal(store.bgmVolume, 12);
  assert.deepEqual(plain(calls.filter((c) => c[2] == "bgmPageSetVolume").map((c) => c[3])), [[100], [12]]);
});

test("再生リストを変えると、開いてある BGM のタブも新しい再生リストへ移る", async () => {
  const { ctx, store, calls } = load({
    settings: { bgmPlaylistUrl: PLAYLIST }, session: { bgmTabId: 7 },
    tabs: { 7: { id: 7, url: `https://music.youtube.com/watch?list=${LIST_ID}`, windowId: 1 } },
  });
  await ctx.bgm.setPlaylistUrl("https://music.youtube.com/playlist?list=PLnew_list-1");
  assert.equal(store.bgmPlaylistUrl, "https://music.youtube.com/playlist?list=PLnew_list-1");
  assert.deepEqual(plain(calls.find((c) => c[0] == "update")[2]), { url: "https://music.youtube.com/watch?list=PLnew_list-1" });
  await assert.rejects(ctx.bgm.setPlaylistUrl("https://example.com/"), /再生リスト/);
  assert.equal(store.bgmPlaylistUrl, "https://music.youtube.com/playlist?list=PLnew_list-1");
});

test("BGM のタブを前に出す", async () => {
  const { ctx, calls } = load({
    session: { bgmTabId: 7 },
    tabs: { 7: { id: 7, url: "https://music.youtube.com/watch?list=x", windowId: 3 } },
  });
  await ctx.bgm.showTab();
  assert.deepEqual(plain(calls), [["update", 7, { active: true }], ["window", 3, { focused: true }]]);
});
