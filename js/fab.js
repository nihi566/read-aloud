//floating toolbar（改造版）: the toolbar button puts the popup on the page as a box the user can drag anywhere,
//since the browser always opens the real popup under the toolbar button. Injected by events.js on every click;
//a second click takes the box away again. The box keeps its distance from the top right corner in storage.
//Dragging is done by Draggabilly (js/draggabilly.pkgd.min.js), which events.js injects just before this file.

var FAB_HOST_ID = "read-aloud-fab-host"
var FAB_POSITION_KEY = "fabPosition"
var FAB_DEFAULT_POSITION = {right: 16, top: 16}
var FAB_MESSAGE_PREFIX = "read-aloud-fab:"
var FAB_POINTER_EVENTS = ["pointermove", "pointerup", "pointercancel"]
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
  //the host covers the viewport without taking clicks; the box inside moves within it and takes clicks once shown
  host.style.cssText = "all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important;"
  setStyle("opacity", "0")
  setStyle("pointer-events", "none")
  const root = host.attachShadow({mode: "closed"})
  root.innerHTML = `
    <style>
      .bounds { position: absolute; inset: 0; }
      .fab {
        position: absolute;
        pointer-events: none;
        display: flex;
        align-items: flex-start;
        border-radius: 28px;
        background: #ffffff;
        box-shadow: 0 6px 20px rgba(15, 23, 42, .22);
        overflow: hidden;
      }
      .fab.shown { pointer-events: auto; }
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
      .grip { cursor: grab; }
      .is-dragging .grip { cursor: grabbing; }
      /*the frame is a page of the extension, which takes the pointer moves over it even from a captured pointer*/
      .is-pointer-down iframe { pointer-events: none; }
      iframe { border: 0; display: block; color-scheme: normal; }
      svg { width: 16px; height: 16px; fill: currentColor; }
    </style>
    <div class="bounds"><div class="fab">
      <div class="handle">
        <button class="grip" type="button" title="ドラッグで動かす" aria-label="ドラッグで動かす">
          <svg viewBox="0 0 24 24"><path d="M9 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm-6 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>
        </button>
        <button class="close" type="button" title="閉じる（読み上げは続きます）" aria-label="閉じる">
          <svg viewBox="0 0 24 24"><path d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 1 0-1.4 1.4l4.9 4.9-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4z"/></svg>
        </button>
      </div>
      <iframe title="Read Aloud" allow="autoplay" width="300" height="76"></iframe>
    </div></div>
  `
  const bounds = root.querySelector(".bounds")
  const fab = root.querySelector(".fab")
  const frame = root.querySelector("iframe")
  frame.src = chrome.runtime.getURL("popup.html?isPopup=1&fab=1")
  //in the page before Draggabilly starts, since it reads how the box is positioned
  document.documentElement.appendChild(host)

  let position = FAB_DEFAULT_POSITION
  const box = () => ({width: fab.offsetWidth, height: fab.offsetHeight})
  const viewport = () => ({width: bounds.clientWidth, height: bounds.clientHeight})
  //Draggabilly listens to touch events alone when the browser has them (PCs with a touch screen), and a mouse can't drag
  //there; listen to pointer events instead, which cover the mouse, pens and fingers. A pointer the browser takes over
  //(pointercancel) ends the drag like letting go.
  //Draggabilly waits for the moves on the window, which misses them while the pointer is over the page's own frames
  //(ads, embedded videos) or outside the browser, so the box stops and falls behind the pointer; the grip captures
  //the pointer instead and takes every move until the button is let go
  class FabDraggabilly extends Draggabilly {
    _bindHandles(bindMethod, touchAction) {
      for (const handle of this.handles) {
        for (const type of ["pointerdown", "click", "lostpointercapture", ...FAB_POINTER_EVENTS]) handle[bindMethod](type, this)
        handle.style.touchAction = touchAction
      }
    }
    onpointerdown(event) {
      if (event.button == 0) event.currentTarget.setPointerCapture(event.pointerId)
      super.onpointerdown(event)
    }
    //the capture can go away without a pointerup reaching the grip; end the drag then, or the box can't be grabbed again
    onlostpointercapture(event) {
      if (this.isPointerDown) this.withPointer("pointerCancel", event)
    }
    bindActivePointerEvents() {}
    unbindActivePointerEvents() {}
    pointerCancel(event, pointer) {
      this.pointerUp(event, pointer)
    }
  }
  const draggie = new FabDraggabilly(fab, {handle: root.querySelector(".grip"), containment: bounds})
  const place = pos => {
    position = clampFabPosition(pos, box(), viewport())
    draggie.setPosition(viewport().width - box().width - position.right, position.top)
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
      fab.classList.add("shown")
    }
    else if (event.data.type == FAB_MESSAGE_PREFIX + "close") close()
  }
  const onResize = () => place(position)
  const close = () => {
    window.removeEventListener("message", onMessage)
    window.removeEventListener("resize", onResize)
    draggie.destroy()
    host.remove()
    closeOpenFab = undefined
  }
  window.addEventListener("message", onMessage)
  window.addEventListener("resize", onResize)
  closeOpenFab = close
  root.querySelector(".close").addEventListener("click", close)

  //Draggabilly moves the box by its left edge; keep the distance from the right edge, so the box stays on the right on resize
  draggie.on("dragEnd", () => {
    place({right: viewport().width - box().width - draggie.position.x, top: draggie.position.y})
    save()
  })

  chrome.storage.local.get(FAB_POSITION_KEY)
    .then(items => place(items[FAB_POSITION_KEY] || FAB_DEFAULT_POSITION))
    .catch(err => {
      console.error(err)
      place(FAB_DEFAULT_POSITION)
    })
}
