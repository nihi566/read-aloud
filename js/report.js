$(function() {
  var queryString = getQueryString();
  if (queryString.referer) {
    $("button.close").show()
      .click(function() {
        history.back();
      })
  }

  sendToPlayer({method: "getLastUrl"}).then(url => $("#txt-url").val(url))
  $("#txt-comment").focus();
  $("#btn-submit").click(submit);
});

function submit() {
  $("#btn-submit, #lbl-status, #lbl-error").hide();
  $("#img-spinner").show();
  bgPageInvoke("reportIssue", [$("#txt-url").val(), $("#txt-comment").val()])
    .then(function() {
      $("#img-spinner").hide();
      $("#lbl-status").text("報告を送信しました。ご協力ありがとうございます。").show();
    },
    function() {
      $("#img-spinner").hide();
      $("#lbl-error").text("サーバーに接続できませんでした。お手数ですが、hai.phan@gmail.com まで直接メールでお知らせください。").show();
      $("#btn-submit").show();
    })
}

async function sendToPlayer(message) {
  message.dest = "player"
  const result = await brapi.runtime.sendMessage(message)
  if (result && result.error) throw result.error
  else return result
}
