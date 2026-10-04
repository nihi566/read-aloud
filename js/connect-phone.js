
$(onDomReady)

function onDomReady() {
  //ポップアップの中で開いたときは、ポップアップの幅を広げない（css/pages.css の body.in-popup）
  if (getQueryString().referer == "popup.html" || /\/popup\.html([?#]|$)/.test(document.referrer)) {
    $("body").addClass("in-popup")
  }

  startPairing()

  //event handlers
  $("button.close").click(function() {
    history.back()
  })
  //もう一度試す: 最初からやり直す（新しいコードをもらってから、接続を待つ）
  $("#try-again-button").click(function() {
    startPairing()
  })
}

var pairingRun = 0

function startPairing() {
  const run = ++pairingRun
  $("#pairing-code").text("")
  setState("loading")
  sendToPlayer({method: "startPairing"})
    .then(pairingCode => {
      if (run != pairingRun) return
      const code = pairingCode == null ? "" : String(pairingCode).trim()
      if (!code) throw new Error("No pairing code")
      $("#pairing-code").text(code.length > 3 ? code.slice(0,3) + "-" + code.slice(3) : code)
      setState("pairing")
      return waitPairing(run)
    })
    .catch(err => {
      console.error(err)
      if (run == pairingRun) setState("fail")
    })
}

function waitPairing(run) {
  return repeat({
    action: () => sendToPlayer({method: "isPaired"}),
    until: x => x || run != pairingRun,
    delay: 1000,
    max: 120
  })
  .then(isPaired => {
    if (run != pairingRun) return
    if (isPaired) setState("success")
    else setState("fail")
  })
}



function setState(newState) {
  //コードがまだ無いうちは、空のコード欄を見せない（読み込み中のまま）
  if (newState == "pairing" && !$("#pairing-code").text()) newState = "loading"
  for (const state of ["loading", "pairing", "success", "fail"]) {
    if (state == newState) $("#state-" + state).show()
    else $("#state-" + state).hide()
  }
}

async function sendToPlayer(message) {
  message.dest = "player"
  const result = await brapi.runtime.sendMessage(message)
  if (result && result.error) throw result.error
  else return result
}
