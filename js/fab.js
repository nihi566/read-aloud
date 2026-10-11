//floating toolbar（改造版）: the toolbar button puts the popup on the page as a box the user can drag anywhere,
//since the browser always opens the real popup under the toolbar button. Injected by events.js on every click;
//a second click takes the box away again. The box keeps its distance from the top right corner in storage.

var FAB_HOST_ID = "read-aloud-fab-host"
var FAB_POSITION_KEY = "fabPosition"
var FAB_DEFAULT_POSITION = {right: 16, top: 16}
var FAB_MESSAGE_PREFIX = "read-aloud-fab:"
//kept in the extension's own world of the page, out of the page's reach, so the page can neither fake nor hide the box
var closeOpenFab

//keep the whole box inside the viewport; a box larger than the viewport sticks to the top right corner
function clampFabPosition(pos, box, viewport) {
  const clamp = (value, max) => Math.min(Math.max(0, Number(value) || 0), Math.max(0, max))
  return {
    right: clamp(pos.right, viewport.width - box.width),
    top: clamp(pos.top, viewport.height - box.height),
  }
}

if (typeof document != "undefined") toggleFab()

function toggleFab() {
  if (closeOpenFab) {
    closeOpenFab()
    return
  }

  const host = document.createElement("div")
  host.id = FAB_HOST_ID
  //important inline styles win over the page's stylesheets, so the page can't make the box see-through to trick clicks
  const setStyle = (name, value) => host.style.setProperty(name, value, "important")
  host.style.cssText = "all: initial !important; position: fixed !important; z-index: 2147483647 !important;"
  setStyle("opacity", "0")
  setStyle("pointer-events", "none")
  const root = host.attachShadow({mode: "closed"})
  root.innerHTML = `
    <style>
      .fab {
        display: flex;
        align-items: flex-start;
        border-radius: 28px;
        background: #ffffff;
        box-shadow: 0 6px 20px rgba(15, 23, 42, .22);
        overflow: hidden;
      }
      .handle {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 14px 0 8px 6px;
      }
      .handle button {
        all: unset;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 22px;
        border-radius: 6px;
        color: #8a93a0;
      }
      .handle button:hover { background: rgba(127, 127, 127, .15); }
      .handle button:focus-visible { box-shadow: 0 0 0 3px rgba(47, 111, 228, .35); }
      .grip { cursor: grab; touch-action: none; }
      .dragging .grip { cursor: grabbing; }
      .dragging iframe { pointer-events: none; }
      iframe { border: 0; display: block; color-scheme: normal; }
      svg { width: 16px; height: 16px; fill: currentColor; }
    </style>
    <div class="fab">
      <div class="handle">
        <button class="grip" type="button" title="ドラッグで動かす" aria-label="ドラッグで動かす">
          <svg viewBox="0 0 24 24"><path d="M9 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm-6 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>
        </button>
        <button class="close" type="button" title="閉じる（読み上げは続きます）" aria-label="閉じる">
          <svg viewBox="0 0 24 24"><path d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 1 0-1.4 1.4l4.9 4.9-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4z"/></svg>
        </button>
      </div>
      <iframe title="Read Aloud" allow="autoplay" width="300" height="76"></iframe>
    </div>
  `
  const fab = root.querySelector(".fab")
  const grip = root.querySelector(".grip")
  const frame = root.querySelector("iframe")
  frame.src = chrome.runtime.getURL("popup.html?isPopup=1&fab=1")

  let position = FAB_DEFAULT_POSITION
  const box = () => ({width: host.offsetWidth, height: host.offsetHeight})
  const viewport = () => ({width: document.documentElement.clientWidth, height: window.innerHeight})
  const place = pos => {
    position = clampFabPosition(pos, box(), viewport())
    setStyle("right", position.right + "px")
    setStyle("top", position.top + "px")
  }
  const save = () => chrome.storage.local.set({[FAB_POSITION_KEY]: position}).catch(console.error)

  //the popup in the frame reports its size and colors, and asks to be closed when it opens elsewhere
  const onMessage = event => {
    if (event.source != frame.contentWindow || !event.data || typeof event.data.type != "string") return
    if (event.data.type == FAB_MESSAGE_PREFIX + "size") {
      const maxHeight = Math.max(0, window.innerHeight - position.top)
      frame.style.width = Math.ceil(Number(event.data.width) || 0) + "px"
      frame.style.height = Math.min(Math.ceil(Number(event.data.height) || 0), maxHeight) + "px"
      if (typeof event.data.background == "string") fab.style.background = event.data.background
      place(position)
      setStyle("opacity", "1")
      setStyle("pointer-events", "auto")
    }
    else if (event.data.type == FAB_MESSAGE_PREFIX + "close") close()
  }
  const onResize = () => place(position)
  const close = () => {
    window.removeEventListener("message", onMessage)
    window.removeEventListener("resize", onResize)
    host.remove()
    closeOpenFab = undefined
  }
  window.addEventListener("message", onMessage)
  window.addEventListener("resize", onResize)
  closeOpenFab = close
  root.querySelector(".close").addEventListener("click", close)

  grip.addEventListener("pointerdown", event => {
    if (event.button != 0) return
    event.preventDefault()
    grip.setPointerCapture(event.pointerId)
    fab.classList.add("dragging")
    const start = {x: event.clientX, y: event.clientY, right: position.right, top: position.top}
    const onMove = e => place({right: start.right - (e.clientX - start.x), top: start.top + (e.clientY - start.y)})
    const onEnd = () => {
      grip.removeEventListener("pointermove", onMove)
      grip.removeEventListener("pointerup", onEnd)
      grip.removeEventListener("pointercancel", onEnd)
      fab.classList.remove("dragging")
      save()
    }
    grip.addEventListener("pointermove", onMove)
    grip.addEventListener("pointerup", onEnd)
    grip.addEventListener("pointercancel", onEnd)
  })

  document.documentElement.appendChild(host)
  chrome.storage.local.get(FAB_POSITION_KEY)
    .then(items => place(items[FAB_POSITION_KEY] || FAB_DEFAULT_POSITION))
    .catch(err => {
      console.error(err)
      place(FAB_DEFAULT_POSITION)
    })
}
