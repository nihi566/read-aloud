//highlights the sentence being read on the page itself, using the CSS Custom Highlight API
//so that the page's DOM is left untouched (works on readers like Google Play Books)

var pageHighlighter = new function() {
  var highlightName = "read-aloud-sentence";
  var cursor = 0;

  this.highlight = function(text) {
    if (typeof CSS == "undefined" || !CSS.highlights || typeof Highlight == "undefined") return false;
    var nodes = getTextNodes(document.body);
    var found = findSentence(nodes.map(function(node) {return node.nodeValue}), text, cursor);
    if (!found) {
      this.clear();
      return false;
    }
    cursor = found.endIndex;
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
function findSentence(nodeTexts, sentence, fromIndex) {
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
  var index = haystack.indexOf(target, fromIndex || 0);
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

function normalizeForMatch(text) {
  //Speech appends a period to sentences ending in a word character
  return (text || "").replace(/\s+/g, "").replace(/(\w)\.$/, "$1");
}
