
$(function() {
  getSettings(["awsCreds", "gcpCreds", "ibmCreds", "azureCreds"])
    .then(function(items) {
      if (items.awsCreds) {
        $("#aws-access-key-id").val(obfuscate(items.awsCreds.accessKeyId));
        $("#aws-secret-access-key").val(obfuscate(items.awsCreds.secretAccessKey));
      }
      if (items.gcpCreds) {
        $("#gcp-api-key").val(obfuscate(items.gcpCreds.apiKey));
        $("#gcp-enable-studio").prop('checked', items.gcpCreds.enableStudio);
      }
      if (items.ibmCreds) {
        $("#ibm-api-key").val(obfuscate(items.ibmCreds.apiKey));
        $("#ibm-url").val(obfuscate(items.ibmCreds.url));
      }
      if (items.azureCreds) {
        $("#azure-region").val(items.azureCreds.region)
        $("#azure-key").val(obfuscate(items.azureCreds.key))
      }
    })
  $(".status").hide();
  $("#aws-save-button").click(awsSave);
  $("#gcp-save-button").click(gcpSave);
  $("#ibm-save-button").click(ibmSave);
  $("#azure-save-button").click(azureSave)
})

function obfuscate(key) {
  return key.replace(/./g, function(m, i) {
    return i < key.length-5 ? "*" : m;
  })
}


// エラーの表示（改造版）: 英語の生のエラー（Failed to fetch など）ではなく日本語で見せる。元のエラーは小さく下に残す（調べるとき用）
var MSG_NETWORK = "サーバーに接続できません。URL と、サーバーが起動しているかを確認してください。"
var MSG_REQUIRED = "必須の項目が入力されていません。"

function hasJapanese(text) {
  return /[\u3040-\u30ff\u4e00-\u9fff]/.test(text || "")
}

function errorText(err) {
  if (err == null) return ""
  if (typeof err == "string") return err
  return err.message || err.code || (function() { try { return JSON.stringify(err) } catch (e) { return String(err) } })()
}

function isNetworkError(err) {
  if (!err) return false
  if (err.name == "TypeError" && /fetch|network|load failed/i.test(err.message)) return true
  if (/^(NetworkingError|UnknownEndpoint|TimeoutError)$/.test(err.code || "")) return true
  return /failed to fetch|networkerror|err_connection|err_name_not_resolved/i.test(errorText(err))
}

// JSON.parse のエラーから「何行目の何文字目」を日本語で
function describeJsonError(err, text) {
  var msg = errorText(err)
  var m = /line (\d+) column (\d+)/.exec(msg)
  if (m) return m[1] + " 行目の " + m[2] + " 文字目あたり"
  m = /position (\d+)/.exec(msg)
  if (m && text != null) {
    var before = text.slice(0, Number(m[1])).split("\n")
    return before.length + " 行目の " + (before[before.length-1].length + 1) + " 文字目あたり"
  }
  if (/unexpected end/i.test(msg)) return "途中で終わっています（かっこや引用符の閉じ忘れ）"
  return "書き方に誤りがあります"
}

// 失敗した接続テストのエラーを {message, detail} に
function describeTestError(err) {
  var raw = errorText(err)
  if (isNetworkError(err)) return {message: MSG_NETWORK, detail: raw}
  if (err && err.name == "SyntaxError") return {message: "サーバーの応答を読み取れませんでした。URL が正しいかを確認してください。", detail: raw}
  if (hasJapanese(raw)) return {message: "接続テストに失敗しました: " + raw, detail: ""}
  return {message: "接続テストに失敗しました。入力した内容が正しいかを確認してください。", detail: raw}
}

function showError($el, error) {
  if (typeof error == "string") error = {message: error, detail: ""}
  $el.empty()
    .append($("<div>").addClass("error-msg").text(error.message))
    .append($("<div>").addClass("error-detail").text(error.detail ? "詳細: " + error.detail : ""))
    .attr("title", error.detail || "")
    .show()
}

function isHttpUrl(url) {
  try {
    var u = new URL(url)
    return u.protocol == "http:" || u.protocol == "https:"
  }
  catch (err) {
    return false
  }
}


function awsSave() {
  $(".status").hide();
  var accessKeyId = $("#aws-access-key-id").val().trim();
  var secretAccessKey = $("#aws-secret-access-key").val().trim();
  if (accessKeyId && secretAccessKey) {
    $("#aws-progress").show();
    testAws(accessKeyId, secretAccessKey)
      .then(function() {
        $("#aws-progress").hide();
        updateSettings({awsCreds: {accessKeyId: accessKeyId, secretAccessKey: secretAccessKey}});
        $("#aws-success").text("Amazon Polly の声を有効にしました。").show();
        $("#aws-access-key-id").val(obfuscate(accessKeyId));
        $("#aws-secret-access-key").val(obfuscate(secretAccessKey));
      },
      function(err) {
        $("#aws-progress").hide();
        showError($("#aws-error"), describeTestError(err));
      })
  }
  else if (!accessKeyId && !secretAccessKey) {
    clearSettings(["awsCreds"])
      .then(function() {
        $("#aws-success").text("Amazon Polly の声を無効にしました。").show();
      })
  }
  else {
    showError($("#aws-error"), MSG_REQUIRED + "アクセスキー ID とシークレットアクセスキーの両方を入力してください。");
  }
}

function testAws(accessKeyId, secretAccessKey) {
      var polly = new AWS.Polly({
        region: "us-east-1",
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey
      })
      return polly.describeVoices().promise();
}


function gcpSave() {
  $(".status").hide();
  var apiKey = $("#gcp-api-key").val().trim();
  var enableStudio = $("#gcp-enable-studio").is(':checked');
  if (apiKey) {
    $("#gcp-progress").show();
    testGcp(apiKey)
      .then(function() {
        $("#gcp-progress").hide();
        updateSettings({gcpCreds: {apiKey: apiKey, enableStudio: enableStudio}});
        if (enableStudio) {
          $("#gcp-success").text("Google Wavenet と Google Studio の声を有効にしました。").show();
        } else {
          $("#gcp-success").text("Google Wavenet の声を有効にしました。").show();
        }
        $("#gcp-api-key").val(obfuscate(apiKey));
      },
      function(err) {
        $("#gcp-progress").hide();
        showError($("#gcp-error"), describeTestError(err));
      })
  }
  else {
    clearSettings(["gcpCreds"])
      .then(function() {
        $("#gcp-success").text("Google Wavenet の声を無効にしました。").show();
      })
  }
}

function testGcp(apiKey) {
      return ajaxGet("https://texttospeech.googleapis.com/v1beta1/voices?key=" + apiKey);
}


function ibmSave() {
  $(".status").hide();
  var apiKey = $("#ibm-api-key").val().trim();
  var url = $("#ibm-url").val().trim();
  if (apiKey && url && url.indexOf("*") == -1 && !isHttpUrl(url)) {
    showError($("#ibm-error"), "URL が正しくありません。https:// から始まるサービスの URL を入力してください。");
  }
  else if (apiKey && url) {
    $("#ibm-progress").show();
    testIbm(apiKey, url)
      .then(function() {
        $("#ibm-progress").hide();
        updateSettings({ibmCreds: {apiKey: apiKey, url: url}});
        $("#ibm-success").text("IBM Watson の声を有効にしました。").show();
        $("#ibm-api-key").val(obfuscate(apiKey));
        $("#ibm-url").val(obfuscate(url));
      },
      function(err) {
        $("#ibm-progress").hide();
        showError($("#ibm-error"), describeTestError(err));
      })
  }
  else if (!apiKey && !url) {
    clearSettings(["ibmCreds"])
      .then(function() {
        $("#ibm-success").text("IBM Watson の声を無効にしました。").show();
      })
  }
  else {
    showError($("#ibm-error"), MSG_REQUIRED + "API key と URL の両方を入力してください。");
  }
}

function testIbm(apiKey, url) {
  return brapi.permissions.request({origins: [url + "/*"]})
    .then(function(granted) {
      if (!granted) throw new Error("アクセス権限が許可されませんでした");
    })
    .then(function() {
      return ibmWatsonTtsEngine.fetchVoices(apiKey, url);
    })
}


async function azureSave() {
  $(".status").hide()
  const region = $("#azure-region").val().trim()
  const key = $("#azure-key").val().trim()
  if (region && key) {
    $("#azure-progress").show()
    try {
      await testAzure(region, key)
      await updateSettings({azureCreds: {region, key}})
      $("#azure-success").text("Microsoft Azure の声を有効にしました。").show()
      $("#azure-key").val(obfuscate(key))
    }
    catch (err) {
      showError($("#azure-error"), describeTestError(err))
    }
    finally {
      $("#azure-progress").hide()
    }
  }
  else if (!region && !key) {
    await clearSettings(["azureCreds"])
    $("#azure-success").text("Microsoft Azure の声を無効にしました。").show()
  }
  else {
    showError($("#azure-error"), MSG_REQUIRED + "リージョンとキーの両方を入力してください。")
  }
}

async function testAzure(region, key) {
  await azureTtsEngine.fetchVoices(region, key)
}



//OpenAI
$(function() {
  const creds$ = observeSetting("openaiCreds")
  const editMode$ = new rxjs.BehaviorSubject(false)
  const status$ = new rxjs.BehaviorSubject({type: "IDLE"})

  rxjs.combineLatest(creds$, editMode$).subscribe(([creds, editMode]) => {
    $(".openai .view-new").toggle(creds == null && !editMode)
    $(".openai .view-exist").toggle(creds != null && !editMode)
    $(".openai .view-edit").toggle(editMode)
  })

  creds$.subscribe(creds => {
    const endpointUrl = creds && creds.url || openaiTtsEngine.defaultEndpointUrl
    const apiKey = creds && creds.apiKey || ""
    const voiceList = creds && creds.voiceList || openaiTtsEngine.defaultVoiceList
    $(".openai .endpoint-url").text(endpointUrl)
    $(".openai .api-key").text(apiKey && (apiKey.slice(0,13) + "*****" + apiKey.slice(-5)))
    $(".openai .voice-list").text(voiceList.map(x => x.voice).join(", "))
    if (creds && isLocalVoiceServer(creds.url)) {
      // このパソコンの音声サーバーは、保存した Voice List ではなくサーバーの一覧を使う（js/local-voice-server.js）
      getOpenaiVoiceList(creds, voiceList).then(list => {
        $(".openai .voice-list").text(list.map(x => x.voice).join(", ") + "（このパソコンの音声サーバーから自動で読み込み）")
      })
    }
    $(".openai .txt-endpoint-url").val(endpointUrl)
    $(".openai .txt-api-key").val(apiKey)
    $(".openai .txt-voice-list").val(JSON.stringify(voiceList, null, 2))
  })

  status$.subscribe(status => {
    $(".openai .status.progress").toggle(status.type == "PROGRESS")
    $(".openai .status.success").toggle(status.type == "SUCCESS")
    if (status.type == "ERROR") showError($(".openai .status.error"), status.error)
    else $(".openai .status.error").hide().empty()
  })

  //actions
  $(".openai .btn-add").click(() => {
    status$.next({type: "IDLE"})
    editMode$.next(true)
  })
  $(".openai .btn-edit").click(() => {
    status$.next({type: "IDLE"})
    editMode$.next(true)
  })
  $(".openai .btn-delete").click(() => {
    clearSettings(["openaiCreds"])
    editMode$.next(false)
  })
  $(".openai .btn-save").click(async () => {
    const url = $(".openai .txt-endpoint-url").val().trim().replace(/\/+$/, "")
    const apiKey = $(".openai .txt-api-key").val().trim()
    const voiceListText = $(".openai .txt-voice-list").val().trim()
    //ネットワークに出る前に、入力を確かめる
    if (!url) return status$.next({type: "ERROR", error: MSG_REQUIRED + "API URL を入力してください。"})
    if (!isHttpUrl(url)) return status$.next({type: "ERROR", error: "API URL が正しくありません。http:// または https:// から始まる URL を入力してください（例: " + LOCAL_VOICE_SERVER_URL + "）。"})
    let voiceList
    if (!voiceListText) {
      if (!isLocalVoiceServer(url)) return status$.next({type: "ERROR", error: MSG_REQUIRED + "声の一覧（Voice List）を JSON で入力してください。"})
      voiceList = []   //このパソコンの音声サーバーは、声の一覧をサーバーから読む
    }
    else {
      try {
        voiceList = JSON.parse(voiceListText)
      }
      catch (err) {
        return status$.next({type: "ERROR", error: {
          message: "声の一覧（Voice List）の JSON が正しくありません: " + describeJsonError(err, voiceListText),
          detail: errorText(err)
        }})
      }
      const listError = validateVoiceList(voiceList)
      if (listError) return status$.next({type: "ERROR", error: "声の一覧（Voice List）の JSON が正しくありません: " + listError})
    }
    const openaiCreds = {url, apiKey, voiceList}
    try {
      status$.next({type: "PROGRESS"})
      //このパソコンの音声サーバーは、実際に使う声の一覧（/voice-list）を読めるかで確かめる
      if (isLocalVoiceServer(url)) await fetchLocalVoiceList(url)
      else await openaiTtsEngine.test(openaiCreds)
    }
    catch (err) {
      return status$.next({type: "ERROR", error: err ? describeTestError(err) : {message: "接続テストに失敗しました。API URL と API key を確認してください。", detail: ""}})
    }
    try {
      await updateSettings({openaiCreds})
      editMode$.next(false)
      status$.next({type: "IDLE"})
    }
    catch (err) {
      status$.next({type: "ERROR", error: {message: "設定を保存できませんでした。", detail: errorText(err)}})
    }
  })
  $(".openai .btn-cancel").click(() => {
    editMode$.next(false)
  })
})


// 声の一覧の形を確かめる。問題があれば日本語の説明を返す
function validateVoiceList(list) {
  if (!Array.isArray(list)) return "全体を [ ] で囲んだ配列にしてください"
  if (!list.length) return "声が 1 つもありません"
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    const where = (i + 1) + " 番目の声"
    if (!item || typeof item != "object" || Array.isArray(item)) return where + "が { } で囲んだオブジェクトになっていません"
    if (typeof item.voice != "string" || !item.voice) return where + "に \"voice\"（声の ID）がありません"
    const hasLang = typeof item.lang == "string" && item.lang
    const hasLangs = Array.isArray(item.langs) && item.langs.length && item.langs.every(x => typeof x == "string" && x)
    if (!hasLang && !hasLangs) return where + "（" + item.voice + "）に \"lang\"（例: \"ja-JP\"）または \"langs\" がありません"
  }
  return null
}
