//highlights the sentence being read on the page itself, using the CSS Custom Highlight API
//so that the page's DOM is left untouched (works on readers like Google Play Books)

var pageHighlighter = new function() {
  var highlightName = "read-aloud-sentence";
  var cursor = 0;
  var reading = false;
  var clickListening = false;
  var clickedAt = null; //where the page was Alt+clicked: the next sentence is the one at that point
  var self = this;

  //set by content.js: called with the text around an Alt+clicked point while reading
  this.onSeek = null;

  this.highlight = function(text) {
    if (typeof CSS == "undefined" || !CSS.highlights || typeof Highlight == "undefined") return false;
    var nodes = getTextNodes(document.body);
    var found = findSentence(nodes.map(function(node) {return node.nodeValue}), text, cursor, clickedAt);
    clickedAt = null;
    if (!found) {
      this.clear();
      return false;
    }
    cursor = found.endIndex;
    reading = true;
    listenForClicks();
    var range = document.createRange();
    range.setStart(nodes[found.start.node], found.start.offset);
    range.setEnd(nodes[found.end.node], found.end.offset);
    ensureStyle();
    CSS.highlights.set(highlightName, new Highlight(range));
    scrollIntoViewIfNeeded(range);
    return true;
  }

  this.clear = function() {
    if (typeof CSS != "undefined" && CSS.highlights) CSS.highlights.delete(highlightName);
  }

  this.reset = function() {
    this.clear();
    cursor = 0;
    reading = false;
  }

  //Alt+click on a sentence of the page while reading: read again from that sentence
  //(a plain click is left to the page: links, page turning of readers)
  function listenForClicks() {
    if (clickListening) return;
    clickListening = true;
    document.addEventListener("click", function(event) {
      //only the user's own clicks (not ones the page dispatches)
      if (!event.isTrusted || !reading || !event.altKey || event.button != 0 || !self.onSeek) return;
      var point = caretAt(event.clientX, event.clientY);
      var nodes = getTextNodes(document.body);
      var node = point ? nodes.indexOf(point.node) : -1;
      if (node < 0) return;
      //Alt+click on a link downloads it
      event.preventDefault();
      event.stopPropagation();
      var around = textAroundPoint(nodes.map(function(n) {return n.nodeValue}), node, point.offset);
      clickedAt = around.index;
      self.onSeek({before: around.before, after: around.after});
    }, true);
  }

  function caretAt(x, y) {
    if (document.caretPositionFromPoint) {
      var position = document.caretPositionFromPoint(x, y);
      return position && {node: position.offsetNode, offset: position.offset};
    }
    if (document.caretRangeFromPoint) {
      var range = document.caretRangeFromPoint(x, y);
      return range && {node: range.startContainer, offset: range.startOffset};
    }
    return null;
  }

  function getTextNodes(root) {
    var result = [];
    if (!root) return result;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        var parent = node.parentElement;
        if (!parent || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (parent.closest("script, style, noscript, textarea, select, sup")) return NodeFilter.FILTER_REJECT;
        if (parent.checkVisibility && !parent.checkVisibility()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) result.push(walker.currentNode);
    return result;
  }

  function ensureStyle() {
    if (document.getElementById("read-aloud-highlight-style")) return;
    var style = document.createElement("style");
    style.id = "read-aloud-highlight-style";
    style.textContent = "::highlight(" + highlightName + ") {background-color: #ffe066; color: #000;}";
    (document.head || document.documentElement).appendChild(style);
  }

  function scrollIntoViewIfNeeded(range) {
    var rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    //on another column of a paginated reader; turning pages is the reader's job
    if (rect.right < 0 || rect.left > window.innerWidth) return;
    if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;
    //center the sentence itself, not its (possibly very tall) parent element
    window.scrollBy({top: rect.top - (window.innerHeight - rect.height) / 2, behavior: "smooth"});
  }
}

//nodeTexts: the text of each text node, in document order
//returns the node index and offset where the sentence starts and ends (end offset is exclusive),
//comparing without whitespace; searches from fromIndex first, then from the beginning
//near（optional）: an index in the text without whitespace; the occurrence that contains it wins
//(after an Alt+click, a sentence repeated earlier on the page must not be colored instead)
function findSentence(nodeTexts, sentence, fromIndex, near) {
  var target = normalizeForMatch(sentence);
  if (!target) return null;
  var chars = [];
  var positions = [];
  nodeTexts.forEach(function(text, node) {
    for (var offset=0; offset<text.length; offset++) {
      if (/\s/.test(text[offset])) continue;
      chars.push(text[offset]);
      positions.push({node: node, offset: offset});
    }
  });
  var haystack = chars.join("");
  var length = target.length;
  var index = -1;
  if (near != null) {
    var containing = haystack.indexOf(target, Math.max(0, near - length + 1));
    if (containing >= 0 && containing <= near) index = containing;
  }
  if (index < 0) index = haystack.indexOf(target, fromIndex || 0);
  if (index < 0) index = haystack.indexOf(target);
  if (index < 0) {
    //word replacements or preprocessing may have changed the text; locate it by its beginning
    var prefix = target.slice(0, 10);
    if (prefix.length < 10) return null;
    index = haystack.indexOf(prefix, fromIndex || 0);
    if (index < 0) index = haystack.indexOf(prefix);
    if (index < 0) return null;
    length = Math.min(length, haystack.length - index);
  }
  var last = positions[index + length - 1];
  return {
    start: positions[index],
    end: {node: last.node, offset: last.offset + 1},
    endIndex: index + length
  };
}

var CLICK_CONTEXT_LENGTH = 20;

//the text before and after the clicked point (node index, offset in it), without whitespace,
//and the index of the point in the whole text without whitespace
function textAroundPoint(nodeTexts, node, offset) {
  var squash = function(text) {return text.replace(/\s+/g, "")};
  var before = squash(nodeTexts.slice(0, node).join("") + nodeTexts[node].slice(0, offset));
  var after = squash(nodeTexts[node].slice(offset) + nodeTexts.slice(node + 1).join(""));
  return {
    before: before.slice(-CLICK_CONTEXT_LENGTH),
    after: after.slice(0, CLICK_CONTEXT_LENGTH),
    index: before.length
  };
}

//texts: the sentences being read; around: textAroundPoint of the click
//returns the index of the sentence that contains the clicked point, or -1.
//Tries the whole context first (to tell repeated sentences apart), then shorter pieces near the point
//(word replacements may have changed the text being read)
function findClickedSentence(texts, around) {
  var normalized = texts.map(normalizeForMatch);
  var starts = [];
  var joined = "";
  normalized.forEach(function(text) {
    starts.push(joined.length);
    joined += text;
  });
  var before = around.before, after = around.after;
  var candidates = [
    {needle: before + after, at: before.length},
    {needle: before.slice(-6) + after.slice(0, 6), at: Math.min(6, before.length)},
    {needle: after.slice(0, 8), at: 0},
    {needle: before.slice(-8), at: Math.min(8, before.length)}
  ];
  for (var i=0; i<candidates.length; i++) {
    var candidate = candidates[i];
    if (candidate.needle.length < 4) continue;
    var pos = joined.indexOf(candidate.needle);
    if (pos < 0) continue;
    var point = Math.min(pos + candidate.at, joined.length - 1);
    for (var index=starts.length-1; index>=0; index--) {
      if (starts[index] <= point && normalized[index]) return index;
    }
  }
  return -1;
}

function normalizeForMatch(text) {
  //Speech appends a period to sentences ending in a word character
  return (text || "").replace(/\s+/g, "").replace(/(\w)\.$/, "$1");
}
