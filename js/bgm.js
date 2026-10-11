
//BGM（改造版）: play a YouTube Music playlist while reading aloud. The playlist plays in a pinned
//background tab of music.youtube.com (the user's own sign-in, and no embedding restrictions), and is
//controlled through the page's own player (#movie_player). Used by the popup and the player.

const BGM_ORIGIN = "https://music.youtube.com/*"
const BGM_DEFAULT_VOLUME = 30
const BGM_HOSTS = ["music.youtube.com", "www.youtube.com", "youtube.com", "m.youtube.com"]

var bgmTiming = {
  readyTimeoutMs: 15000,  //how long to wait for the player of a newly opened tab
  pollMs: 500,
  settleMs: 5000,         //how long to wait for the sound to start after playVideo()
}

//"https://music.youtube.com/playlist?list=XXX" → "XXX"; null unless it is a YouTube URL with a playlist
function parseBgmPlaylistId(url) {
  let parsed
  try {
    parsed = new URL(String(url || "").trim())
  }
  catch (err) {
    return null
  }
  if (parsed.protocol != "https:" || !BGM_HOSTS.includes(parsed.hostname)) return null
  const id = parsed.searchParams.get("list")
  return id && /^[\w-]{2,64}$/.test(id) ? id : null
}

function bgmWatchUrl(playlistId) {
  return "https://music.youtube.com/watch?list=" + encodeURIComponent(playlistId)
}

function isBgmReadingState(state) {
  return state == "PLAYING" || state == "LOADING"
}

//what the BGM does when the reading goes from prevState to state: "play", "pause" or null (leave it)
function bgmActionFor(prevState, state) {
  if (isBgmReadingState(state) && !isBgmReadingState(prevState)) return "play"
  if (!isBgmReadingState(state) && isBgmReadingState(prevState)) return "pause"
  return null
}

//keeps the BGM following the reading (used by the player); call the returned function every second.
//getReadingState() returns the reading's state ("PLAYING", "LOADING", "PAUSED" or "STOPPED")
function makeBgmSync(getReadingState) {
  let lastState = "STOPPED"
  let busy = false
  const shouldContinue = async () => isBgmReadingState(await getReadingState()) && !!await getSetting("bgmEnabled")
  async function tick() {
    if (busy) return
    busy = true
    try {
      const state = await getReadingState()
      const action = bgmActionFor(lastState, state)
      let cancelled = false
      if (action && await getSetting("bgmEnabled")) {
        if (action == "play") cancelled = !!(await bgm.play({shouldContinue})).cancelled
        else await bgm.pause()
      }
      //only once done, so that a failed or cancelled start is tried again on the next tick
      if (!cancelled) lastState = state
    }
    catch (err) {
      console.error("BGM", err)
    }
    finally {
      busy = false
    }
  }
  tick.isReading = () => isBgmReadingState(lastState)
  return tick
}

var bgm = {
  //returns {playing}: false when the browser blocked the autoplay (the user has to press play in the tab).
  //{cancelled: true} when the BGM was paused, or shouldContinue() turned false, before it started
  async play({shouldContinue} = {}) {
    const startedAt = Date.now()
    const settings = await getSettings(["bgmPlaylistUrl", "bgmVolume"])
    const playlistId = parseBgmPlaylistId(settings.bgmPlaylistUrl)
    if (!playlistId) throw new Error("BGM の再生リストの URL が設定されていません")
    //without it the tab's address can't be read, and every start would open another tab
    if (!await brapi.permissions.contains({origins: [BGM_ORIGIN]}))
      throw new Error("music.youtube.com を操作する許可がありません。BGM のボタンを押して許可してください")
    const isCancelled = async () =>
      (await getSetting("bgmPausedAt") || 0) > startedAt || (shouldContinue != null && !await shouldContinue())

    //the popup and the player may both start the BGM at once; only one of them opens the tab
    const tab = await withBgmLock(async () => await findBgmTab() || await openBgmTab(playlistId))
    if (tab.discarded) await brapi.tabs.reload(tab.id)
    const volume = settings.bgmVolume != null ? settings.bgmVolume : BGM_DEFAULT_VOLUME
    let cancelled = false
    const started = await pollBgmTab(bgmTiming.readyTimeoutMs, async () => {
      if (await isCancelled()) return cancelled = true
      return runInBgmTab(tab.id, bgmPagePlay, [volume])
    })
    if (!started) throw new Error("YouTube Music のプレーヤーが開けませんでした。BGM のタブを確かめてください")
    const playing = !cancelled && await pollBgmTab(bgmTiming.settleMs, () => runInBgmTab(tab.id, bgmPageIsPlaying))
    if (cancelled || await isCancelled()) {
      //paused while it was starting: pause again, as playVideo() may have run after that
      await runInBgmTab(tab.id, bgmPagePause).catch(console.error)
      return {playing: false, cancelled: true}
    }
    await updateSettings({bgmBlocked: !playing})
    return {playing}
  },

  async pause() {
    await updateSettings({bgmPausedAt: Date.now(), bgmBlocked: false})
    const tab = await findBgmTab()
    if (tab) await runInBgmTab(tab.id, bgmPagePause)
  },

  async setVolume(value) {
    const volume = Math.min(100, Math.max(0, Math.round(Number(value) || 0)))
    await updateSettings({bgmVolume: volume})
    const tab = await findBgmTab()
    if (tab) await runInBgmTab(tab.id, bgmPageSetVolume, [volume])
  },

  async setPlaylistUrl(url) {
    const playlistId = parseBgmPlaylistId(url)
    if (!playlistId) throw new Error("YouTube Music の再生リストの URL（list= を含むもの）を貼ってください")
    await updateSettings({bgmPlaylistUrl: url.trim()})
    const tab = await findBgmTab()
    if (tab) await brapi.tabs.update(tab.id, {url: bgmWatchUrl(playlistId)})
  },

  async showTab() {
    await updateSettings({bgmBlocked: false})
    const tab = await findBgmTab()
    if (!tab) return
    await brapi.tabs.update(tab.id, {active: true})
    await brapi.windows.update(tab.windowId, {focused: true})
  },
}

//tab ids are given again after the browser restarts, so the id is kept only until it closes
async function getBgmTabId() {
  if (!brapi.storage.session) return null
  return (await brapi.storage.session.get("bgmTabId")).bgmTabId
}

function setBgmTabId(tabId) {
  if (brapi.storage.session) return brapi.storage.session.set({bgmTabId: tabId})
}

//the tab opened earlier, unless it was closed or went to another site
async function findBgmTab() {
  const tabId = await getBgmTabId()
  if (tabId == null) return null
  try {
    const tab = await brapi.tabs.get(tabId)
    //a tab still loading has its address in pendingUrl
    const url = tab.pendingUrl || tab.url || ""
    return url.startsWith("https://music.youtube.com/") ? tab : null
  }
  catch (err) {
    return null
  }
}

async function openBgmTab(playlistId) {
  const tab = await brapi.tabs.create({url: bgmWatchUrl(playlistId), active: false})
  await setBgmTabId(tab.id)
  await brapi.tabs.update(tab.id, {pinned: true})
  return tab
}

//calls fn until it returns true, at most timeoutMs
async function pollBgmTab(timeoutMs, fn) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const done = await fn().catch(err => {
      console.debug("BGM tab not ready", err)
      return false
    })
    if (done || Date.now() > deadline) return !!done
    await sleep(bgmTiming.pollMs)
  }
}

//runs fn in one extension page at a time (the popup and the player are separate pages)
var bgmLocalLock = Promise.resolve()
function withBgmLock(fn) {
  if (typeof navigator != "undefined" && navigator.locks) return navigator.locks.request("read-aloud-bgm", fn)
  const result = bgmLocalLock.then(fn)
  bgmLocalLock = result.catch(() => {})
  return result
}

async function runInBgmTab(tabId, func, args) {
  const [injection] = await brapi.scripting.executeScript({target: {tabId}, func, args: args || [], world: "MAIN"})
  return injection && injection.result
}

function sleep(ms) {
  return new Promise(fulfill => setTimeout(fulfill, ms))
}


//run inside the music.youtube.com page (MAIN world, so they can use the page's player)
function bgmPagePlay(volume) {
  const player = document.getElementById("movie_player")
  if (!player || typeof player.playVideo != "function") return false
  player.setVolume(volume)
  player.playVideo()
  return true
}

function bgmPagePause() {
  const player = document.getElementById("movie_player")
  if (player && typeof player.pauseVideo == "function") player.pauseVideo()
}

function bgmPageSetVolume(volume) {
  const player = document.getElementById("movie_player")
  if (player && typeof player.setVolume == "function") player.setVolume(volume)
}

//playing (1) or buffering (3); while an ad plays the player says "unstarted", but its video runs
function bgmPageIsPlaying() {
  const player = document.getElementById("movie_player")
  const state = player && typeof player.getPlayerState == "function" ? player.getPlayerState() : null
  const video = document.querySelector("#movie_player video")
  return state == 1 || state == 3 || !!(video && !video.paused)
}
