// このパソコンの音声サーバー（read-aloud-piper-ja。http://127.0.0.1:5123/v1）を OpenAI 枠の声として使う。
// - API URL がこのパソコン（127.0.0.1 / localhost）なら、声の一覧はサーバーの /voice-list から読む
//   （声を足したり消したりしても、Voice List を貼り直さなくてよい）
// - OpenAI 枠を登録していなければ、このパソコンのサーバーを登録したものとして扱う
// サーバーが応答しないときは、保存した Voice List に戻る。

const LOCAL_VOICE_SERVER_URL = "http://127.0.0.1:5123/v1"
const LOCAL_VOICE_LIST_TIMEOUT_MS = 3000

function isLocalVoiceServer(url) {
  try {
    const u = new URL(url)
    return u.protocol == "http:" && (u.hostname == "127.0.0.1" || u.hostname == "localhost")
  }
  catch (err) {
    return false
  }
}

function effectiveOpenaiCreds(openaiCreds) {
  return openaiCreds || {url: LOCAL_VOICE_SERVER_URL, apiKey: ""}
}

async function fetchLocalVoiceList(url) {
  const res = await fetch(new URL("/voice-list", url).href, {signal: AbortSignal.timeout(LOCAL_VOICE_LIST_TIMEOUT_MS)})
  if (!res.ok) throw new Error("Local voice server returned " + res.status)
  const list = await res.json()
  const isName = x => typeof x == "string" && x.length > 0
  if (!Array.isArray(list) || !list.every(x => x && isName(x.voice) && isName(x.lang))) {
    throw new Error("Local voice server returned an invalid voice list")
  }
  return list
}

async function getOpenaiVoiceList(openaiCreds, defaultVoiceList) {
  const creds = effectiveOpenaiCreds(openaiCreds)
  if (isLocalVoiceServer(creds.url)) {
    try {
      return await fetchLocalVoiceList(creds.url)
    }
    catch (err) {
      console.error(err)
      if (!openaiCreds) return []
    }
  }
  return creds.voiceList || defaultVoiceList
}

// 読み込み待ちの表示: このパソコンのサーバーの Style-Bert-VITS2 の声（OpenAI sbv2-<名前>[:<話し方>]）が、まだ読み込まれていないか。
// 使わない時間が続くとサーバーが GPU から外すので、次の最初の読み上げで 5〜10 秒待つ。分からないときは false
async function isLocalVoiceLoading(openaiCreds, voiceName) {
  const creds = effectiveOpenaiCreds(openaiCreds)
  const m = /^OpenAI (sbv2-[^:]+)/.exec(voiceName || "")
  if (!m || !isLocalVoiceServer(creds.url)) return false
  try {
    const res = await fetch(new URL("/health", creds.url).href, {signal: AbortSignal.timeout(LOCAL_VOICE_LIST_TIMEOUT_MS)})
    if (!res.ok) return false
    const health = await res.json()
    return Boolean(health && health.sbv2) && !(health.sbv2.loaded || []).includes(m[1])
  }
  catch (err) {
    return false
  }
}

// 合成に使う声の情報。このパソコンのサーバーは声の名前だけで声を決めるので、保存した Voice List に無くてもよい
function openaiVoiceInfo(openaiCreds, voiceId) {
  const voiceInfo = (openaiCreds.voiceList || []).find(x => x.voice == voiceId)
  if (voiceInfo) return voiceInfo
  if (isLocalVoiceServer(openaiCreds.url)) return {voice: voiceId}
  return undefined
}

// 声の表示名: このパソコンのサーバーの声は、ID（OpenAI sbv2-amitaro など）ではなく分かりやすい名前で見せる
const LOCAL_VOICE_LABELS = {
  "sbv2-amitaro": "あみたろ",
  "sbv2-koharune-ami": "小春音アミ",
  "piper-female": "Piper 女性",
  "piper-male": "Piper 男性",
}

function localVoiceLabel(voiceName) {
  return LOCAL_VOICE_LABELS[(voiceName || "").replace(/^OpenAI /, "")] || voiceName
}
