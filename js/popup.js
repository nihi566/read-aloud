
var queryString = getQueryString()
const playerCheckIn$ = new rxjs.Subject()

registerMessageListener("popup", {
  playerCheckIn() {
    playerCheckIn$.next()
  }
})

const engineInitializingSubject = new rxjs.Subject()
engineInitializingSubject
  .pipe(
    rxjs.distinctUntilChanged()
  )
  .subscribe(engine => {
    if (engine) $("#status").text(`${engine} の音声を準備しています…`).addClass("is-info").show()
    else $("#status.is-info").removeClass("is-info").hide()
  })

$(function() {
  if (queryString.isPopup) $("body").addClass("is-popup")
  else getCurrentTab().then(function(currentTab) {return updateSettings({readAloudTab: currentTab.id})})
})



getSettings(["showHighlighting", "readAloudTab"]).then(async settings => {
  if (settings.showHighlighting == 2 && queryString.isPopup) {
    await popout(settings.readAloudTab)
  } else {
    await init()
  }
}).catch(handleError)

async function popout(tabId) {
  const activeTab = await getActiveTab()
  const url = brapi.runtime.getURL("popup.html?tab=" + activeTab.id)
  try {
    if (!tabId) throw "Create"
    const tab = await updateTab(tabId, {url, active: true})
    await updateWindow(tab.windowId, {focused: true}).catch(console.error)
    window.close()
  }
  catch (err) {
    await createWindow({
      url,
      focused: true,
      type: "popup",
      width: 500,
      height: 600,
    })
    window.close()
  }
}

async function init() {
  await domReady()

  $("#btnMain").click(onMain);
  $("#btnPause").click(onPauseToggle);
  $("#decrease-font-size").click(changeFontSize.bind(null, -1));
  $("#increase-font-size").click(changeFontSize.bind(null, +1));
  $("#decrease-window-size").click(changeWindowSize.bind(null, -1));
  $("#increase-window-size").click(changeWindowSize.bind(null, +1));
  initPanel();
  initBgmControls();
  initKeyboardShortcuts();
  initFollowCurrent();

  refreshSize();
  checkAnnouncements();

  const {state} = await bgPageInvoke("getPlaybackState")
  if (state == "PAUSED" || state == "STOPPED") onPlay()
}



function handleError(err) {
  if (!err) return;
  if (err.name == "CancellationException") return;
  $("#status").removeClass("is-info");
  setTimeout(fitPanel);

  if (/^{/.test(err.message)) {
    var errInfo = JSON.parse(err.message);

    $("#status").html(formatError(errInfo)).show();
    $("#status a").click(function() {
      switch ($(this).attr("href")) {
        case "#open-extension-settings":
          brapi.tabs.create({url: "chrome://extensions/?id=" + brapi.runtime.id});
          break;
        case "#request-permissions":
          brapi.permissions.request(errInfo.perms)
            .then(function(granted) {
              if (granted) {
                if (errInfo.reload) return reloadAndPlay()
                else onPlay()
              }
            })
          break;
        case "#sign-in":
          getAuthToken({interactive: true})
            .then(function(token) {
              if (token) onPlay();
            })
            .catch(function(err) {
              $("#status").text(err.message).show();
            })
          break;
        case "#auth-wavenet":
          brapi.permissions.request(config.wavenetPerms)
            .then(function(granted) {
              if (granted) bgPageInvoke("authWavenet");
            })
          break;
        case "#open-pdf-viewer":
          brapi.tabs.create({url: config.pdfViewerUrl})
          break
        case "#connect-phone":
          location.href = "connect-phone.html"
          break
      }
    })
  }
  else if (config.browserId == "opera" && /locked fullscreen/.test(err.message)) {
    $("#status").html("Click <a href='#open-player-tab'>here</a> to start read aloud.").show()
    $("#status a").click(async function() {
      try {
        playerCheckIn$.pipe(rxjs.take(1)).subscribe(() => onPlay())
        const tab = await brapi.tabs.create({
          url: "player.html?opener=popup&autoclose=long",
          index: 0,
          active: false,
        })
        brapi.tabs.update(tab.id, {pinned: true})
          .catch(console.error)
      } catch (err) {
        handleError(err)
      }
    })
  }
  else {
    $("#status").text(err.message).show();
  }
}



rxjs.concat(domReady(), rxjs.interval(500)).subscribe(updateButtons)

async function updateButtons() {
  const [settings, stateInfo] = await Promise.all([
    getSettings(),
    bgPageInvoke("getPlaybackState"),
  ])
  const showHighlighting = settings.showHighlighting != null ? Number(settings.showHighlighting) : defaults.showHighlighting
  var state = stateInfo.state
  const speech = stateInfo.speechInfo
  var playbackErr = stateInfo.playbackError

  if (playbackErr) handleError(playbackErr)
  engineInitializingSubject.next(state == "LOADING" && speech?.engine)
  updateLocalVoiceLoading(state == "LOADING" && speech)

  playbackState = state
  const reading = isReading()
  const mainLabel = reading ? "読み上げを止める" : "このページを読み上げる"
  $("#btnMain").toggleClass("active", reading).toggleClass("loading", state == "LOADING")
    .attr({title: mainLabel, "aria-label": mainLabel})
  const pauseLabel = state == "PLAYING" ? "一時停止（Space）" : state == "PAUSED" ? "続きから読む（Space）" : "読み上げる（Space）"
  $("#btnPause").attr({title: pauseLabel, "aria-label": pauseLabel})
    .find(".material-icons").text(state == "PLAYING" ? "pause" : "play_arrow")

  if ((showHighlighting == 1 || showHighlighting == 2) && (state == "LOADING" || state == "PAUSED" || state == "PLAYING") && speech) {
    $("#highlight-wrap, #toolbar").show()
    $("body").addClass("has-text")
    updateHighlighting(speech)
    fitPanel()
  }
  else {
    $("#highlight-wrap, #toolbar").hide()
    $("body").removeClass("has-text")
  }
}

//改造版: while the local voice server loads a Style-Bert-VITS2 voice (5-10 seconds after it was idle),
//say so instead of showing only the spinner. Asks the server once per loading spell
var localVoiceLoadingCheck = null
function updateLocalVoiceLoading(loadingSpeech) {
  if (!loadingSpeech) {
    localVoiceLoadingCheck = null
    $("#local-voice-loading").hide()
    $("body").removeClass("voice-loading")
    return
  }
  if (localVoiceLoadingCheck) return
  const check = localVoiceLoadingCheck = getSetting("openaiCreds")
    .then(openaiCreds => isLocalVoiceLoading(openaiCreds, loadingSpeech.voiceName))
  check.then(loading => {
    if (localVoiceLoadingCheck == check) {
      $("#local-voice-loading").toggle(loading)
      $("body").toggleClass("voice-loading", loading)
      fitPanel()
    }
  }, console.error)
}

function updateHighlighting(speech) {
  var elem = $("#highlight");
  if (!elem.data("texts")
    || elem.data("texts").length != speech.texts.length
    || elem.data("texts").some((text,i) => text != speech.texts[i])
  ) {
    elem.css("direction", speech.isRTL ? "rtl" : "")
      .data({texts: speech.texts, position: null})
      .empty()
    for (let i=0; i<speech.texts.length; i++) {
      makeSpan(speech.texts[i])
        .css("cursor", "pointer")
        .click(onSeek.bind(null, i))
        .appendTo(elem)
    }
  }

  const pos = speech.position
  $("#progress").text(`${pos.index + 1} / ${speech.texts.length}`)
  if (!elem.data("position") || positionDiffers(elem.data("position"), pos)) {
    elem.data("position", pos);
    elem.find(".active").removeClass("active");
    const child = elem.children().eq(pos.index)
    const section = pos.word
    if (section) {
      child.empty()
      const text = speech.texts[pos.index]
      let span
      if (section.startIndex > 0) {
        makeSpan(text.slice(0, section.startIndex))
          .appendTo(child)
      }
      if (section.endIndex > section.startIndex) {
        span = makeSpan(text.slice(section.startIndex, section.endIndex))
          .addClass("active")
          .appendTo(child)
      }
      if (text.length > section.endIndex) {
        makeSpan(text.slice(section.endIndex))
          .appendTo(child)
      }
      if (span) scrollIntoView(span, elem)
    }
    else {
      child.addClass("active")
      scrollIntoView(child, elem)
    }
  }
}

function makeSpan(text) {
  const html = escapeHtml(text).replace(/\r?\n/g, "<br/>")
  return $("<span>").html(html)
}

function positionDiffers(left, right) {
  function rangeDiffers(a, b) {
    if (a == null && b == null) return false
    if (a != null && b != null) return a.startIndex != b.startIndex || a.endIndex != b.endIndex
    return true
  }
  return left.index != right.index ||
    rangeDiffers(left.paragraph, right.paragraph) ||
    rangeDiffers(left.sentence, right.sentence) ||
    rangeDiffers(left.word, right.word)
}

function scrollIntoView(child, scrollParent, force) {
  //改造版: don't pull the text away while the user is scrolling it; offer a button to come back instead
  if (!force && isUserScrolling()) {
    updateJumpButton()
    return
  }
  const childTop = child.offset().top - scrollParent.offset().top
  const childBottom = childTop + child.outerHeight()
  if (force || childTop < 0 || childBottom >= scrollParent.height())
    scrollParent.stop().animate({scrollTop: scrollParent[0].scrollTop + childTop - 10}, updateJumpButton)
}



var currentPlayRequestId
var playbackState = "STOPPED"

function isReading() {
  return playbackState == "PLAYING" || playbackState == "PAUSED" || playbackState == "LOADING"
}

//the buttons act on the state at the time of the click; the shown state is refreshed only every 500ms
function onMain() {
  bgPageInvoke("getPlaybackState")
    .then(({state}) => state == "STOPPED" ? onPlay() : onStop())
    .catch(handleError)
}

function onPauseToggle() {
  bgPageInvoke("getPlaybackState")
    .then(({state}) => {
      if (state == "PLAYING") onPause()
      else if (state != "LOADING") onPlay()
    })
    .catch(handleError)
}

function onPlay() {
  $("#status").hide();
  const requestId = currentPlayRequestId = Math.random()
  bgPageInvoke("getPlaybackState")
    .then(function(stateInfo) {
      if (stateInfo.state == "PAUSED") return bgPageInvoke("resume")
      else return bgPageInvoke("playTab", queryString.tab ? [Number(queryString.tab)] : [])
    })
    .then(updateButtons)
    .catch(err => {
      if (requestId == currentPlayRequestId) handleError(err)
      else console.debug("Ignoring error from an earlier request", err)
    })
}

function reloadAndPlay() {
  $("#status").hide();
  bgPageInvoke("reloadAndPlayTab", queryString.tab ? [Number(queryString.tab)] : [])
    .then(updateButtons)
    .catch(handleError)
}

function onPause() {
  bgPageInvoke("pause")
    .then(updateButtons)
    .catch(handleError)
}

function onStop() {
  bgPageInvoke("stop")
    .then(updateButtons)
    .catch(handleError)
}

function onForward() {
  bgPageInvoke("forward")
    .then(updateButtons)
    .catch(handleError)
}

function onRewind() {
  bgPageInvoke("rewind")
    .then(updateButtons)
    .catch(handleError)
}

function onSeek(n) {
  bgPageInvoke("seek", [n])
    .catch(handleError)
}

function changeFontSize(delta) {
  getSettings(["highlightFontSize"])
    .then(function(settings) {
      var newSize = (settings.highlightFontSize || defaults.highlightFontSize) + delta;
      if (newSize >= 1 && newSize <= 8) return updateSettings({highlightFontSize: newSize}).then(refreshSize);
    })
    .catch(handleError)
}

function changeWindowSize(delta) {
  getSettings(["highlightWindowSize"])
    .then(function(settings) {
      var newSize = (settings.highlightWindowSize || defaults.highlightWindowSize) + delta;
      if (newSize >= 1 && newSize <= 3) return updateSettings({highlightWindowSize: newSize}).then(refreshSize);
    })
    .catch(handleError)
}

function refreshSize() {
  return getSettings(["highlightFontSize", "highlightWindowSize", "showHighlighting"])
    .then(function(settings) {
      var fontSize = getFontSize(settings);
      var windowSize = getWindowSize(settings);
      $("#highlight").css({
        "font-size": fontSize,
      })
      if (queryString.isPopup) {
        $("#highlight").css({
          width: isMobileOS() ? "100%" : windowSize[0],
        }).data("targetHeight", windowSize[1])
        //when the text is shown in the popup, keep the popup as wide in every state, so it doesn't jump when
        //reading starts; otherwise the popup is just the compact toolbar
        const showHighlighting = settings.showHighlighting != null ? Number(settings.showHighlighting) : defaults.showHighlighting
        if (!isMobileOS()) $("body").css("min-width", showHighlighting == 1 ? windowSize[0] : "")
        fitPanel()
      }
      scrollToCurrent(true)
    })
  function getFontSize(settings) {
    switch (settings.highlightFontSize || defaults.highlightFontSize) {
      case 1: return ".9em";
      case 2: return "1em";
      case 3: return "1.1em";
      case 4: return "1.2em";
      case 5: return "1.3em";
      case 6: return "1.4em";
      case 7: return "1.5em";
      default: return "1.6em";
    }
  }
  function getWindowSize(settings) {
    switch (settings.highlightWindowSize || defaults.highlightWindowSize) {
      case 1: return [430, 330];
      case 2: return [550, 420];
      default: return [750, 450];
    }
  }
}

function checkAnnouncements() {
  var now = new Date().getTime();
  getSettings(["announcement"])
    .then(function(settings) {
      var ann = settings.announcement;
      if (ann && ann.expire > now)
        return ann;
      else
        return ajaxGet(config.serviceUrl + "/read-aloud/announcement")
          .then(JSON.parse)
          .then(function(result) {
            result.expire = now + 6*3600*1000;
            if (ann && result.id == ann.id) {
              result.lastShown = ann.lastShown;
              result.disabled = ann.disabled;
            }
            updateSettings({announcement: result});
            return result;
          })
    })
    .then(function(ann) {
      if (ann.text && !ann.disabled) {
        if (!ann.lastShown || now-ann.lastShown > ann.period*60*1000) {
          showAnnouncement(ann);
          ann.lastShown = now;
          updateSettings({announcement: ann});
        }
      }
    })
    .catch(console.debug)
}

function showAnnouncement(ann) {
  var html = escapeHtml(ann.text).replace(/\[(.*?)\]/g, "<a target='_blank' href='" + ann.link + "'>$1</a>").replace(/\n/g, "<br/>");
  $("#footer").html(html).addClass("announcement");
  fitPanel();
  if (ann.disableIfClick)
    $("#footer a").click(function() {
      ann.disabled = true;
      updateSettings({announcement: ann});
    })
}

//panel（改造版）: the voice and the speed open under the toolbar (the chevron or the speed), and the gear adds
//the rest of the options page, so nothing needs another page. While reading, the current sentence is read
//again with the new setting (Doc.restartCurrent)
const QUICK_RATE_STEP = 0.1
const QUICK_RATE_MIN = 0.5
const QUICK_RATE_MAX = 3

function initPanel() {
  $("#btnExpand").click(() => togglePanel(isPanelOpen() ? null : "quick"))
  $("#btnSettings").click(() => togglePanel(isPanelOpen() && !$("#more-settings").prop("hidden") ? null : "settings"))
  $("#rate-btn").click(() => {
    if (isPanelOpen()) return togglePanel(null)
    togglePanel("quick")
    $("#rate-range").focus()
  })
  $(document).on("keydown", e => {
    if (e.key == "Escape" && isPanelOpen()) {
      togglePanel(null)
      e.preventDefault()
    }
  })
  initVoiceChoices()
  initSliders()
  initOtherSettings()
}

function isPanelOpen() {
  return !$("#panel").prop("hidden")
}

//mode: "quick" = voice and speed, "settings" = everything, null = closed
function togglePanel(mode) {
  $("#panel").prop("hidden", !mode)
  $("#more-settings").prop("hidden", mode != "settings")
  $("#btnExpand, #rate-btn").attr("aria-expanded", String(!!mode))
  $("#btnSettings").attr("aria-expanded", String(mode == "settings")).toggleClass("active", mode == "settings")
  $("#btnExpand .material-icons").text(mode ? "expand_less" : "expand_more")
  fitPanel()
}

function initVoiceChoices() {
  rxjs.combineLatest([observeSetting("voiceName"), rxjs.defer(getQuickVoices)])
    .subscribe(([voiceName, voices]) => {
      const names = voices.includes(voiceName) || !voiceName ? voices : [voiceName, ...voices]
      const list = $("#voice-list").empty()
      const choices = voiceName ? names : ["", ...names]
      for (const name of choices) {
        const label = name ? localVoiceLabel(name).replace(/^OpenAI /, "") : "自動で選ぶ"
        const input = $("<input type='radio' name='voice'>").val(name).prop("checked", name == (voiceName || ""))
        $("<label class='voice-choice'>").attr("title", name || label).append(input, $("<span>").text(label)).appendTo(list)
      }
      fitPanel()
    })
  $("#voice-list").on("change", "input", function() {
    changeVoice($(this).val()).catch(handleError)
  })

  //every voice, as in the options page (browser voices, other languages, adding custom voices)
  rxjs.combineLatest([
    voices$,
    observeSetting("languages"),
    brapi.i18n.getAcceptLanguages().catch(err => {console.error(err); return []}),
  ]).pipe(
    rxjs.tap(([voices, languages, acceptLangs]) => populateVoices($("#all-voices"), voices, {languages}, acceptLangs)),
    rxjs.switchMap(() => observeSetting("voiceName"))
  ).subscribe(voiceName => $("#all-voices").val(voiceName || ""))
  $("#all-voices").change(function() {
    const voiceName = $(this).val()
    if (openVoiceSource(voiceName)) changeVoice(voiceName).catch(handleError)
    else getSetting("voiceName").then(current => $(this).val(current || ""))
  })
  $("#languages-edit-button").click(() => brapi.tabs.create({url: "languages.html"}))
}

function initSliders() {
  observeSetting("voiceName")
    .pipe(rxjs.switchMap(voiceName => observeSetting("rate" + (voiceName || ""))))
    .subscribe(rate => {
      $("#rate-value").text(formatRate(rate || defaults.rate))
      setSlider("#rate-range", rate || defaults.rate, formatRate)
    })
  observeSetting("pitch").subscribe(pitch => setSlider("#pitch-range", pitch || defaults.pitch, formatPitch))
  observeSetting("volume").subscribe(volume => setSlider("#volume-range", volume || defaults.volume, formatVolume))

  bindSlider("#rate-range", formatRate, async value => {
    await updateSetting("rate" + ((await getSetting("voiceName")) || ""), value)
  })
  bindSlider("#pitch-range", formatPitch, value => updateSettings({pitch: value}))
  bindSlider("#volume-range", formatVolume, value => updateSettings({volume: value}))
}

//the value shows while dragging; the setting is saved when it is let go, and the sentence is read again
//once the arrow keys stop (each key press is a change)
const SLIDER_RESTART_DELAY_MS = 400

function bindSlider(sel, format, save) {
  let restartTimer = null
  $(sel)
    .on("input", function() {
      showSliderValue(sel, Number(this.value), format)
    })
    .on("change", function() {
      Promise.resolve(save(Number(this.value)))
        .then(() => {
          clearTimeout(restartTimer)
          restartTimer = setTimeout(() => restartIfReading().catch(handleError), SLIDER_RESTART_DELAY_MS)
        })
        .catch(handleError)
    })
}

function setSlider(sel, value, format) {
  $(sel).val(value)
  showSliderValue(sel, value, format)
}

function showSliderValue(sel, value, format) {
  const input = $(sel)
  const min = Number(input.attr("min")), max = Number(input.attr("max"))
  const percent = 100 * (Math.min(max, Math.max(min, value)) - min) / (max - min)
  input.css("--fill", percent + "%").attr("aria-valuetext", format(value))
  $(sel + "-value").text(format(value))
}

function initOtherSettings() {
  observeSetting("showHighlighting")
    .subscribe(value => $("#show-highlighting").val(String(value != null ? value : defaults.showHighlighting)))
  $("#show-highlighting").change(function() {
    updateSettings({showHighlighting: $(this).val()}).then(refreshSize).catch(handleError)
  })

  //shown only to those who have used the embedded player, as in the options page
  brapi.storage.local.get(["useEmbeddedPlayer"])
    .then(settings => $(".audio-playback-visible").toggle(settings.useEmbeddedPlayer ? true : false))
  observeSetting("useEmbeddedPlayer")
    .subscribe(value => $("#audio-playback").val(value ? "true" : "false"))
  $("#audio-playback").change(function() {
    updateSettings({useEmbeddedPlayer: JSON.parse($(this).val())})
    brapi.runtime.sendMessage({dest: "player", method: "close"})
      .catch(err => "OK")
  })

  observeSetting("darkMode").subscribe(darkMode => {
    $("#dark-mode-switch").prop("checked", !!darkMode)
    document.body.classList.toggle("dark-mode", !!darkMode)
  })
  $("#dark-mode-switch").change(function() {
    document.body.classList.toggle("dark-mode", this.checked)
    updateSettings({darkMode: this.checked})
  })

  $("#hotkeys-link").click(() => brapi.tabs.create({url: getHotkeySettingsUrl()}))
  //this also clears the word replacements, so a first click only asks for a second one
  let resetArmed = null
  $("#reset").click(function() {
    if (!resetArmed) {
      $(this).addClass("armed").contents().last().replaceWith(RESET_CONFIRM_TEXT)
      resetArmed = setTimeout(disarmReset, RESET_CONFIRM_MS)
      return
    }
    disarmReset()
    clearSettings()
      .then(restartIfReading)
      .then(refreshSize)
      .catch(handleError)
  })
  function disarmReset() {
    clearTimeout(resetArmed)
    resetArmed = null
    $("#reset").removeClass("armed").contents().last().replaceWith(RESET_TEXT)
  }
}

const RESET_TEXT = "設定を元に戻す"
const RESET_CONFIRM_TEXT = "もう一度押すと、読み方の置き換えも含めて元に戻します"
const RESET_CONFIRM_MS = 4000

async function getQuickVoices() {
  try {
    const openaiCreds = await getSetting("openaiCreds")
    const list = await getOpenaiVoiceList(openaiCreds, [])
    return list.map(x => "OpenAI " + x.voice)
  }
  catch (err) {
    console.error(err)
    return []
  }
}

async function changeRate(delta) {
  const key = "rate" + ((await getSetting("voiceName")) || "")
  const current = (await getSetting(key)) || defaults.rate
  const next = Math.min(QUICK_RATE_MAX, Math.max(QUICK_RATE_MIN, Math.round((current + delta) * 10) / 10))
  if (next == current) return
  await updateSetting(key, next)
  await restartIfReading()
}

async function changeVoice(voiceName) {
  await updateSettings({voiceName})
  await restartIfReading()
}

async function restartIfReading() {
  const {state} = await bgPageInvoke("getPlaybackState")
  if (state != "STOPPED") await bgPageInvoke("restartCurrent")
}



//BGM（改造版）: turn a YouTube Music playlist on/off and set the BGM volume (the voice volume is in the panel). While it is on,
//the player starts and stops the BGM with the reading (js/player.js)
function initBgmControls() {
  $("#bgm-toggle").click(onBgmToggle)
  $("#bgm-edit").click(() => showBgmSetup(true))
  $("#bgm-setup").submit(function(e) {
    e.preventDefault()
    saveBgmPlaylist().catch(handleError)
  })
  $("#bgm-show-tab").click(() => bgm.showTab().catch(handleError))
  $("#bgm-next").click(onBgmNext)
  $("#bgm-volume").on("input", () => showSliderValue("#bgm-volume", Number($("#bgm-volume").val()), v => v + "%"))
  $("#bgm-volume").on("input", throttle(() => bgm.setVolume($("#bgm-volume").val()).catch(handleError)))
  $("#bgm-volume").on("change", () => bgm.setVolume($("#bgm-volume").val()).catch(handleError))

  observeSetting("bgmEnabled").subscribe(enabled => $("#bgm-toggle").attr("aria-pressed", String(!!enabled)))
  observeSetting("bgmVolume").subscribe(volume => setSlider("#bgm-volume", volume != null ? volume : BGM_DEFAULT_VOLUME, v => v + "%"))
  //set by js/bgm.js when the browser blocked the autoplay, whether the popup or the player started it
  rxjs.combineLatest([observeSetting("bgmEnabled"), observeSetting("bgmBlocked")])
    .subscribe(([enabled, blocked]) => {
      $("#bgm-notice").toggleClass("visible", !!(enabled && blocked))
      fitPanel()
    })
  refreshBgmNowPlaying()
  setInterval(refreshBgmNowPlaying, BGM_TITLE_POLL_MS)
}

//the song title, and the next button, while the BGM is playing (the BGM tab is asked every few seconds)
const BGM_TITLE_POLL_MS = 2000
var bgmTitleBusy = false

async function refreshBgmNowPlaying() {
  if (bgmTitleBusy) return
  bgmTitleBusy = true
  try {
    const title = await getSetting("bgmEnabled") ? await bgm.nowPlaying() : null
    showBgmNowPlaying(title)
  }
  catch (err) {
    console.error("BGM", err)
  }
  finally {
    bgmTitleBusy = false
  }
}

function showBgmNowPlaying(title) {
  const visible = title != null
  if ($("#bgm-now").hasClass("visible") != visible || $("#bgm-title").text() != (title || "")) {
    $("#bgm-title").text(title || "")
    $("#bgm-now").attr("title", title || "").toggleClass("visible", visible)
    fitPanel()
  }
  $("#bgm-next").prop("disabled", !visible)
}

function onBgmNext() {
  $("#status").hide()
  $("#bgm-next").prop("disabled", true)
  bgm.next()
    .then(refreshBgmNowPlaying)
    .catch(err => {
      $("#bgm-next").prop("disabled", !$("#bgm-now").hasClass("visible"))
      handleError(err)
    })
}

function onBgmToggle() {
  $("#status").hide()
  if ($("#bgm-toggle").attr("aria-pressed") == "true") {
    setBgmEnabled(false).catch(handleError)
    return
  }
  //ask for the permission right in the click: the browser only asks while handling the user's click
  brapi.permissions.request({origins: [BGM_ORIGIN]})
    .then(async granted => {
      if (!granted) throw new Error("music.youtube.com を操作する許可が無いため、BGM を流せません")
      if (parseBgmPlaylistId(await getSetting("bgmPlaylistUrl"))) await setBgmEnabled(true)
      else showBgmSetup(true)
    })
    .catch(handleError)
}

async function saveBgmPlaylist() {
  $("#status").hide()
  await bgm.setPlaylistUrl($("#bgm-url").val())
  showBgmSetup(false)
  //turn it on too, unless the permission is still missing (asked for when the BGM button is pressed)
  if ($("#bgm-toggle").attr("aria-pressed") != "true" && await brapi.permissions.contains({origins: [BGM_ORIGIN]}))
    await setBgmEnabled(true)
}

async function setBgmEnabled(enabled) {
  await updateSettings({bgmEnabled: enabled})
  if (!enabled) return bgm.pause()
  const {state} = await bgPageInvoke("getPlaybackState")
  if (isBgmReadingState(state)) await bgm.play({shouldContinue: () => getSetting("bgmEnabled")})
}

function showBgmSetup(visible) {
  $("#bgm-setup").toggleClass("visible", visible)
  if (visible) {
    getSetting("bgmPlaylistUrl")
      .then(url => $("#bgm-url").val(url || "").focus())
      .catch(console.error)
  }
  fitPanel()
}



//keyboard（改造版）: Space = play/pause, ←/→ = previous/next sentence, ↑/↓ = faster/slower.
//Keys typed into a select or an input keep their usual meaning
function initKeyboardShortcuts() {
  $(document).on("keydown", function(e) {
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return
    if ($(e.target).is("input, select, textarea, [contenteditable]")) return
    const canMove = playbackState == "PLAYING" || playbackState == "PAUSED"
    switch (e.key) {
      case " ":
        if ($(e.target).is("button, a")) return
        $("#btnPause").click()
        break
      case "ArrowLeft":
        if (canMove) onRewind()
        break
      case "ArrowRight":
        if (canMove) onForward()
        break
      case "ArrowUp":
      case "ArrowDown":
        //arrow keys scroll the reading panel when it has the focus
        if ($(e.target).closest("#highlight").length) return
        changeRate(e.key == "ArrowUp" ? +QUICK_RATE_STEP : -QUICK_RATE_STEP).catch(handleError)
        break
      default:
        return
    }
    e.preventDefault()
  })
}



//panel size（改造版）: Chrome's popup is at most 600px tall, so the reading panel gives up height
//when notices or a large window size would push the toolbar out of view
const POPUP_MAX_HEIGHT = 600
const PANEL_MIN_HEIGHT = 140

function fitPanel() {
  if (!queryString.isPopup) return
  const panel = $("#highlight")
  if (!panel.is(":visible")) return
  const target = panel.data("targetHeight") || 420
  const others = document.body.scrollHeight - panel.outerHeight()
  const height = Math.max(PANEL_MIN_HEIGHT, Math.min(target, POPUP_MAX_HEIGHT - others))
  if (Math.abs(panel.outerHeight() - height) > 1) panel.css("height", height)
}


//follow the current sentence（改造版）
const USER_SCROLL_GRACE_MS = 4000
var lastUserScroll = 0

function initFollowCurrent() {
  $("#highlight")
    .on("wheel touchmove mousedown keydown", () => lastUserScroll = Date.now())
    .on("scroll", throttle(updateJumpButton))
  //text reflows (fonts loading, size changes): keep the current sentence in view
  if (window.ResizeObserver) new ResizeObserver(throttle(() => scrollToCurrent())).observe($("#highlight").get(0))
  if (document.fonts) document.fonts.ready.then(() => scrollToCurrent())
  $("#jump-current").click(function() {
    lastUserScroll = 0
    scrollToCurrent(true)
  })
}

function isUserScrolling() {
  return Date.now() - lastUserScroll < USER_SCROLL_GRACE_MS
}

function scrollToCurrent(force) {
  const panel = $("#highlight")
  const active = panel.find(".active").first()
  if (panel.is(":visible") && active.length) scrollIntoView(active, panel, force)
}

function updateJumpButton() {
  const panel = $("#highlight")
  const active = panel.find(".active").first()
  let away = false
  if (panel.is(":visible") && active.length) {
    const top = active.offset().top - panel.offset().top
    away = top + active.outerHeight() < 0 || top > panel.innerHeight()
    $("#jump-current .material-icons").text(top < 0 ? "arrow_upward" : "arrow_downward")
  }
  $("#jump-current").toggleClass("visible", away)
}

function throttle(fn) {
  let timer = null
  return function() {
    if (timer) return
    timer = setTimeout(() => { timer = null; fn() }, 100)
  }
}

//1 → "1.0x", 1.1 → "1.1x", 1.12 → "1.12x"
function formatRate(rate) {
  const text = String(Number(rate.toFixed(2)))
  return (text.includes(".") ? text : text + ".0") + "x"
}

//1 → "1.0", 1.25 → "1.25" (as in the options page)
function formatPitch(pitch) {
  return pitch.toFixed(2).replace(/0$/, "")
}

//0.8 → "80%"
function formatVolume(volume) {
  return Math.round(volume * 100) + "%"
}
