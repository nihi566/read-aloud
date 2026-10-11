
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

//what the BGM does when the reading goes from prevState to state: "play", "pause" or null (leave it)
function bgmActionFor(prevState, state) {
  const reading = s => s == "PLAYING" || s == "LOADING"
  if (reading(state) && !reading(prevState)) return "play"
  if (!reading(state) && reading(prevState)) return "pause"
  return null
}

var bgm = {
  //returns {playing}: false when the browser blocked the autoplay (the user has to press play in the tab)
  async play() {
    const settings = await getSettings(["bgmPlaylistUrl", "bgmVolume"])
    const playlistId = parseBgmPlaylistId(settings.bgmPlaylistUrl)
    if (!playlistId) throw new Error("BGM の再生リストの URL が設定されていません")
    //the popup and the player may both start the BGM at once; only one of them opens the tab
    const tab = await withBgmLock(async () => await findBgmTab() || await openBgmTab(playlistId))
    const volume = settings.bgmVolume != null ? settings.bgmVolume : BGM_DEFAULT_VOLUME
    if (!await pollBgmTab(bgmTiming.readyTimeoutMs, () => runInBgmTab(tab.id, bgmPagePlay, [volume])))
      throw new Error("YouTube Music のプレーヤーが開けませんでした。BGM のタブを確かめてください")
    const playing = await pollBgmTab(bgmTiming.settleMs, () => runInBgmTab(tab.id, bgmPageIsPlaying))
    return {playing}
  },

  async pause() {
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
    const tab = await findBgmTab()
    if (!tab) return
    await brapi.tabs.update(tab.id, {active: true})
    await brapi.windows.update(tab.windowId, {focused: true})
  },
}

//the tab opened earlier, unless it was closed or went to another site
async function findBgmTab() {
  const tabId = await getSetting("bgmTabId")
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
  await updateSettings({bgmTabId: tab.id})
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
