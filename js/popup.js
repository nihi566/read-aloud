
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

  $("#btnPlay").click(onPlay);
  $("#btnPause").click(onPause);
  $("#btnStop").click(onStop);
  $("#btnSettings").click(onSettings);
  $("#btnForward").click(onForward);
  $("#btnRewind").click(onRewind);
  $("#decrease-font-size").click(changeFontSize.bind(null, -1));
  $("#increase-font-size").click(changeFontSize.bind(null, +1));
  $("#decrease-window-size").click(changeWindowSize.bind(null, -1));
  $("#increase-window-size").click(changeWindowSize.bind(null, +1));
  $("#toggle-dark-mode").click(toggleDarkMode);
  initQuickControls();
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
                else $("#btnPlay").click()
              }
            })
          break;
        case "#sign-in":
          getAuthToken({interactive: true})
            .then(function(token) {
              if (token) $("#btnPlay").click();
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
        playerCheckIn$.pipe(rxjs.take(1)).subscribe(() => $("#btnPlay").click())
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

  $("#imgLoading").toggle(state == "LOADING");
  $("#btnPlay").toggle(state == "PAUSED" || state == "STOPPED");
  $("#btnPause").toggle(state == "PLAYING");
  $("#btnStop").toggle(state == "PAUSED" || state == "PLAYING" || state == "LOADING");
  $("#btnForward, #btnRewind").toggle(state == "PLAYING" || state == "PAUSED");
  $("#play-hint").toggle(state == "STOPPED");

  if ((showHighlighting == 1 || showHighlighting == 2) && (state == "LOADING" || state == "PAUSED" || state == "PLAYING") && speech) {
    $("#highlight-wrap, #toolbar").show()
    updateHighlighting(speech)
    fitPanel()
  }
  else {
    $("#highlight-wrap, #toolbar").hide()
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

function onSettings() {
  location.href = "options.html?referer=popup.html";
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
  return getSettings(["highlightFontSize", "highlightWindowSize"])
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
        //keep the popup as wide in every state, so it doesn't jump when reading starts
        if (!isMobileOS()) $("body").css("min-width", windowSize[0] + 28)
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
  if (ann.disableIfClick)
    $("#footer a").click(function() {
      ann.disabled = true;
      updateSettings({announcement: ann});
    })
}

function toggleDarkMode() {
  const darkMode = document.body.classList.toggle("dark-mode")
  updateSettings({darkMode})
}



//quick controls（改造版）: change the rate and the voice from the popup; while reading, the current
//sentence is read again with the new setting (Doc.restartCurrent)
const QUICK_RATE_STEP = 0.1
const QUICK_RATE_MIN = 0.5
const QUICK_RATE_MAX = 3

function initQuickControls() {
  $("#decrease-rate").click(() => changeRate(-QUICK_RATE_STEP).catch(handleError))
  $("#increase-rate").click(() => changeRate(+QUICK_RATE_STEP).catch(handleError))
  $("#quick-voice").change(function() {
    changeVoice($(this).val()).catch(handleError)
  })

  observeSetting("voiceName")
    .pipe(rxjs.switchMap(voiceName => observeSetting("rate" + (voiceName || ""))))
    .subscribe(rate => $("#rate-value").text((rate || defaults.rate).toFixed(1) + "x"))

  rxjs.combineLatest([observeSetting("voiceName"), rxjs.defer(getQuickVoices)])
    .subscribe(([voiceName, voices]) => {
      const names = voices.includes(voiceName) || !voiceName ? voices : [voiceName, ...voices]
      const select = $("#quick-voice").empty()
      if (!voiceName) $("<option>").val("").text("自動で選ぶ").appendTo(select)
      for (const name of names) {
        $("<option>").val(name).text(localVoiceLabel(name).replace(/^OpenAI /, "")).attr("title", name).appendTo(select)
      }
      select.val(voiceName || "").attr("title", voiceName ? localVoiceLabel(voiceName) : "自動で選ぶ")
    })
}

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
  if (!voiceName) return
  await updateSettings({voiceName})
  await restartIfReading()
}

async function restartIfReading() {
  const {state} = await bgPageInvoke("getPlaybackState")
  if (state != "STOPPED") await bgPageInvoke("restartCurrent")
}



//keyboard（改造版）: Space = play/pause, ←/→ = previous/next sentence, ↑/↓ = faster/slower.
//Keys typed into a select or an input keep their usual meaning
function initKeyboardShortcuts() {
  $(document).on("keydown", function(e) {
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return
    if ($(e.target).is("input, select, textarea, [contenteditable]")) return
    const visible = sel => $(sel).is(":visible")
    switch (e.key) {
      case " ":
        if ($(e.target).is("button")) return
        if (visible("#btnPause")) $("#btnPause").click()
        else if (visible("#btnPlay")) $("#btnPlay").click()
        break
      case "ArrowLeft":
        if (visible("#btnRewind")) $("#btnRewind").click()
        break
      case "ArrowRight":
        if (visible("#btnForward")) $("#btnForward").click()
        break
      case "ArrowUp":
        $("#increase-rate").click()
        break
      case "ArrowDown":
        $("#decrease-rate").click()
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
    .on("wheel touchmove mousedown", () => lastUserScroll = Date.now())
    .on("scroll", throttle(updateJumpButton))
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
