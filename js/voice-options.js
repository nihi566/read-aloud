//voice choices（改造版）: the full voice list, grouped as in the options page. Shared by the options page
//and the popup's settings panel

//the "@..." items open the page that adds those voices; returns true when voiceName is a voice to select
function openVoiceSource(voiceName) {
  if (voiceName == "@custom") brapi.tabs.create({url: "custom-voices.html"});
  else if (voiceName == "@languages") brapi.tabs.create({url: "languages.html"});
  else if (voiceName == "@premium") brapi.tabs.create({url: "premium-voices.html"});
  else if (voiceName == "@piper") bgPageInvoke("managePiperVoices").catch(console.error)
  else if (voiceName == "@supertonic") bgPageInvoke("manageSupertonicVoices").catch(console.error)
  else if (voiceName == "@nghitts") bgPageInvoke("manageNghiTtsVoices").catch(console.error)
  else return true
  return false
}

function populateVoices($select, allVoices, settings, acceptLangs) {
  $select.empty()
  $("<option>")
    .val("")
    .text(brapi.i18n.getMessage("options_auto_select"))
    .appendTo($select)

  //get voices filtered by selected languages
  var selectedLangs = immediate(() => {
    if (settings.languages) return settings.languages.split(',')
    if (settings.languages == '') return null
    const accept = new Set(acceptLangs.map(x => x.split('-',1)[0]))
    const langs = Object.keys(groupVoicesByLang(allVoices)).filter(x => accept.has(x))
    return langs.length ? langs : null
  })
  var voices = !selectedLangs ? allVoices : allVoices.filter(
    function(voice) {
      const voiceLanguages = getVoiceLanguages(voice)
      return !voiceLanguages
        || voiceLanguages.map(parseLang).some(({ lang }) => selectedLangs.includes(lang))
        || isPiperVoice(voice)
        || isSupertonicVoice(voice)
        || isNghiTtsVoice(voice)
        || isOpenai(voice)
    });

  //group by standard/premium
  var groups = Object.assign({
      experimental: [],
      offline: [],
      premium: [],
      standard: [],
    },
    voices.groupBy(function(voice) {
      if (isPiperVoice(voice) || isSupertonicVoice(voice) || isNghiTtsVoice(voice)) return "experimental"
      if (isOfflineVoice(voice)) return "offline"
      if (isPremiumVoice(voice)) return "premium";
      return "standard"
    }))
  for (var name in groups) groups[name].sort(voiceSorter);

  //create the offline optgroup
  const offline = $("<optgroup>")
    .attr("label", brapi.i18n.getMessage("options_voicegroup_offline"))
    .appendTo($select)
  for (const voice of groups.offline) {
    $("<option>")
      .val(voice.voiceName)
      .text(voice.voiceName)
      .appendTo(offline)
  }

  //create experimental group
  $("<optgroup>").appendTo($select)
  const experimental = $("<optgroup>")
    .attr("label", brapi.i18n.getMessage("options_voicegroup_experimental"))
    .appendTo($select)
  for (const voice of groups.experimental) {
    $("<option>")
      .val(voice.voiceName)
      .text(voice.voiceName)
      .appendTo(experimental)
  }
  $("<option>")
    .val("@piper")
    .text(brapi.i18n.getMessage("options_enable_piper_voices"))
    .appendTo(experimental)
  $("<option>")
    .val("@supertonic")
    .text(brapi.i18n.getMessage("options_enable_supertonic_voices"))
    .appendTo(experimental)
  if (!selectedLangs || selectedLangs.includes('vi')) {
    $("<option>")
      .val("@nghitts")
      .text(brapi.i18n.getMessage("options_enable_nghitts_voices") || "Install NghiTTS voices...")
      .appendTo(experimental)
  }

  //create the standard optgroup
  $("<optgroup>").appendTo($select)
  var standard = $("<optgroup>")
    .attr("label", brapi.i18n.getMessage("options_voicegroup_standard"))
    .appendTo($select);
  groups.standard.forEach(function(voice) {
    $("<option>")
      .val(voice.voiceName)
      .text(localVoiceLabel(voice.voiceName))
      .appendTo(standard);
  });

  //create the premium optgroup
  $("<optgroup>").appendTo($select);
  var premium = $("<optgroup>")
    .attr("label", brapi.i18n.getMessage("options_voicegroup_premium"))
    .appendTo($select);
  groups.premium.forEach(function(voice) {
    $("<option>")
      .val(voice.voiceName)
      .text(voice.voiceName)
      .appendTo(premium);
  });

  //create the additional optgroup
  $("<optgroup>").appendTo($select);
  var additional = $("<optgroup>")
    .attr("label", brapi.i18n.getMessage("options_voicegroup_additional"))
    .appendTo($select);
  $("<option>")
    .val("@languages")
    .text(brapi.i18n.getMessage("options_add_more_languages"))
    .appendTo(additional)
  $("<option>")
    .val("@custom")
    .text(brapi.i18n.getMessage("options_enable_custom_voices"))
    .appendTo(additional)
}

function voiceSorter(a, b) {
  function getWeight(voice) {
    var weight = 0
    //native voices should appear before non-natives in Standard group
    if (!isNativeVoice(voice)) weight += 10
    //ReadAloud Generic Voice should appear first among the non-natives
    if (!isReadAloudCloud(voice)) weight += 1
    //UseMyPhone should appear last in Offline group
    if (isUseMyPhone(voice)) weight += 1
    return weight
  }
  return getWeight(a)-getWeight(b) || a.voiceName.localeCompare(b.voiceName)
}
