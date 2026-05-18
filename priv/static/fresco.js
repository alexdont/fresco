// Fresco — polished pan-zoom image viewer for Phoenix apps.
//
// Hand-rolled CSS-transform pan/zoom engine. Zero external JS deps; no
// canvas, no tile pyramids, no spring math, no CDN load. The single <img>
// (or N <img>s for <Fresco.canvas>) lives inside a stage div; the engine
// translates the stage and sizes each img per-frame. Native Pointer Events
// drive gestures; native Fullscreen API handles fullscreen.
//
// Public surface (unchanged from 0.4.x where compatible):
//
//   window.Fresco.viewerFor(domId)             // → viewer handle, or null
//   window.Fresco.onViewerReady(domId, cb)     // fires once when ready
//   window.Fresco.onReady(domId, cb)           // alias of onViewerReady
//   window.Fresco.registerSourceProvider(predicate, factory)
//
// Viewer handle (returned by viewerFor):
//
//   { container,
//     imageToScreen(pt), screenToImage(pt),
//     getViewportBounds(),
//     fitBounds(rect, immediately),
//     setSource(url), swapSourcePreservingBounds(url),
//     on(eventName, handler) → unsubscribe,
//     appendNavButton(svg, title, onClick) → unsubscribe (+ .setIcon/.setTitle/.el) }
//
// Canvas handle (additionally):
//
//   { getCanvasSize(), getImages(), imageBoundsFor(id), fitImage(id),
//     getExtension(name) }
//
// Events fired through `handle.on(eventName, fn)`:
//   "zoom" / "pan" / "open" / "resize"           — fired on intent
//   "animation" / "update-viewport"              — fired per-frame
//   "image-loaded"                               — canvas only; per-image load events
//
// Notes vs. 0.4.x:
//   - `handle.openSeadragon` / `handle.viewer` are gone. The engine is no
//     longer OSD-backed; there's no underlying instance to escape to.
//   - `getViewportBounds()` returns image-pixel (viewer) or canvas-pixel
//     (canvas) coords `{x, y, width, height}`, not OSD-normalized 0–1 rects.
//   - `fitBounds(..., immediately)` ignores `immediately` — the lite engine
//     has no animation system in 0.5.x.
//
// Parent app wiring:
//   import "../../deps/fresco/priv/static/fresco.js"
//   hooks: { ...window.FrescoHooks, ...colocatedHooks }

(function() {
  if (window.FrescoLoaded) return;
  window.FrescoLoaded = true;

  // ===========================================================================
  // Extension surface — same shape as 0.4.x so consumers (Tessera, future
  // Etcher) attach the same way. The default `{type: "image", url}` provider
  // matches plain image URLs; Tessera-lite will register a `{type: "tiles", …}`
  // factory when it lands. The viewer engine dispatches on `resolved.type`
  // — it currently only knows "image" and throws a clear error for anything
  // else so future tile-source integration fails loudly rather than silently.
  // ===========================================================================

  var viewerRegistry = {};        // domId → viewer handle
  var readyCallbacks = {};        // domId → [callback, …]
  var sourceProviders = [];       // [{predicate, factory}]

  sourceProviders.push({
    predicate: function() { return true; },
    factory: function(url) { return { type: "image", url: url }; }
  });

  function resolveTileSource(url) {
    for (var i = 0; i < sourceProviders.length; i++) {
      if (sourceProviders[i].predicate(url)) {
        return sourceProviders[i].factory(url);
      }
    }
    return { type: "image", url: url };
  }

  window.Fresco = {
    viewerFor: function(domId) {
      return viewerRegistry[domId] || null;
    },

    scrollStripFor: function(domId) {
      return viewerRegistry[domId] || null;
    },

    onViewerReady: function(domId, callback) {
      var handle = viewerRegistry[domId];
      if (handle) { callback(handle); return; }
      readyCallbacks[domId] = readyCallbacks[domId] || [];
      readyCallbacks[domId].push(callback);
    },

    onReady: function(domId, callback) {
      return window.Fresco.onViewerReady(domId, callback);
    },

    registerSourceProvider: function(predicate, factory) {
      sourceProviders.unshift({ predicate: predicate, factory: factory });
    }
  };

  function publishReady(domId, handle) {
    viewerRegistry[domId] = handle;
    var cbs = readyCallbacks[domId] || [];
    delete readyCallbacks[domId];
    cbs.forEach(function(cb) { cb(handle); });
  }

  function unpublish(domId) {
    delete viewerRegistry[domId];
  }

  // ===========================================================================
  // Heroicons (outline, 24×24, stroke="currentColor")
  // ===========================================================================

  var ICONS = {
    zoomIn:  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM10.5 7.5v6m3-3h-6"/></svg>',
    zoomOut: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM13.5 10.5h-6"/></svg>',
    reset:   '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>',
    expand:  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"/></svg>'
  };

  // ===========================================================================
  // Styles — one stylesheet for viewer, canvas, and strip. The six --fresco-*
  // custom properties are the entire palette surface (system / light / dark /
  // inherit branches below). Structural rules apply regardless of theme.
  // ===========================================================================

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    var css = [
      // ── Nav buttons ─────────────────────────────────────────────────────
      ".fresco-nav {",
      "  position: absolute; top: 12px; left: 12px; z-index: 10;",
      "  display: flex; flex-direction: column; gap: 6px;",
      "  pointer-events: auto;",
      "}",
      ".fresco-nav button {",
      "  width: 36px; height: 36px;",
      "  display: inline-flex; align-items: center; justify-content: center;",
      "  border: none; padding: 0; cursor: pointer;",
      "  background: var(--fresco-nav-bg); color: var(--fresco-nav-fg);",
      "  border-radius: 8px;",
      "  transition: background 120ms ease;",
      "}",
      ".fresco-nav button:hover { background: var(--fresco-nav-bg-hover); }",
      ".fresco-nav button:focus-visible {",
      "  outline: 2px solid var(--fresco-nav-focus); outline-offset: 1px;",
      "}",
      ".fresco-nav svg { width: 18px; height: 18px; }",

      // ── Host theming ────────────────────────────────────────────────────
      ".fresco-viewer:not([data-fresco-theme=\"inherit\"]) {",
      "  --fresco-bg: #fafafa;",
      "  --fresco-grid-dot: #d4d4d8;",
      "  --fresco-nav-bg: rgba(0, 0, 0, 0.55);",
      "  --fresco-nav-bg-hover: rgba(0, 0, 0, 0.78);",
      "  --fresco-nav-fg: #fff;",
      "  --fresco-nav-focus: rgba(255, 255, 255, 0.7);",
      "}",
      // `touch-action: none` is critical for iOS Safari (blocks browser pinch).
      // `user-select: none` blocks i-beam highlight on the host.
      // `cursor: grab` signals draggability; engine swaps to `grabbing` via class.
      ".fresco-viewer {",
      "  position: relative; overflow: hidden;",
      "  touch-action: none;",
      "  user-select: none;",
      "  -webkit-user-select: none;",
      "  cursor: grab;",
      "  background-color: var(--fresco-bg);",
      "  background-image: radial-gradient(circle, var(--fresco-grid-dot) 1px, transparent 1px);",
      "  background-size: 24px 24px;",
      "  outline: none;",
      "}",
      ".fresco-viewer.fresco--dragging { cursor: grabbing; }",
      // Stage: transformed surface holding the image(s). `transform-origin: 0 0`
      // pairs with the engine's (tx, ty, s) math. `will-change: transform` +
      // `backface-visibility: hidden` keep the layer permanently composited.
      ".fresco-stage {",
      "  position: absolute; top: 0; left: 0;",
      "  transform-origin: 0 0;",
      "  will-change: transform;",
      "  backface-visibility: hidden;",
      "  -webkit-backface-visibility: hidden;",
      "}",
      // Stage <img>s must NOT be CSS-shrunk by framework resets. The engine
      // sizes each img inline via width/height per frame; Tailwind preflight's
      // `img { max-width: 100% }` would override our math without this.
      ".fresco-stage img {",
      "  display: block;",
      "  max-width: none;",
      "  max-height: none;",
      "  width: auto;",
      "  height: auto;",
      "  user-select: none;",
      "  -webkit-user-drag: none;",
      "  pointer-events: none;",
      "}",
      // System mode: follow OS preference. Excluded for explicit light or inherit.
      "@media (prefers-color-scheme: dark) {",
      "  .fresco-viewer:not([data-fresco-theme=\"light\"]):not([data-fresco-theme=\"inherit\"]) {",
      "    --fresco-bg: #0a0a0a;",
      "    --fresco-grid-dot: #262626;",
      "    --fresco-nav-bg: rgba(255, 255, 255, 0.12);",
      "    --fresco-nav-bg-hover: rgba(255, 255, 255, 0.20);",
      "    --fresco-nav-fg: #fff;",
      "    --fresco-nav-focus: rgba(255, 255, 255, 0.7);",
      "  }",
      "}",
      ".fresco-viewer[data-fresco-theme=\"dark\"] {",
      "  --fresco-bg: #0a0a0a;",
      "  --fresco-grid-dot: #262626;",
      "  --fresco-nav-bg: rgba(255, 255, 255, 0.12);",
      "  --fresco-nav-bg-hover: rgba(255, 255, 255, 0.20);",
      "  --fresco-nav-fg: #fff;",
      "  --fresco-nav-focus: rgba(255, 255, 255, 0.7);",
      "}",
      ".fresco-viewer[data-fresco-theme=\"light\"] {",
      "  --fresco-bg: #fafafa;",
      "  --fresco-grid-dot: #d4d4d8;",
      "  --fresco-nav-bg: rgba(0, 0, 0, 0.55);",
      "  --fresco-nav-bg-hover: rgba(0, 0, 0, 0.78);",
      "  --fresco-nav-fg: #fff;",
      "  --fresco-nav-focus: rgba(255, 255, 255, 0.7);",
      "}",

      // ── Strip host theming (unchanged from 0.4.x) ───────────────────────
      ".fresco-strip:not([data-fresco-theme=\"inherit\"]) {",
      "  --fresco-bg: #fafafa;",
      "  --fresco-nav-bg: rgba(0, 0, 0, 0.55);",
      "  --fresco-nav-bg-hover: rgba(0, 0, 0, 0.78);",
      "  --fresco-nav-fg: #fff;",
      "  --fresco-nav-focus: rgba(255, 255, 255, 0.7);",
      "}",
      ".fresco-strip {",
      "  background-color: var(--fresco-bg);",
      "  -webkit-overflow-scrolling: touch;",
      "  scrollbar-width: thin;",
      "}",
      ".fresco-strip.fresco-strip--snap-mandatory {",
      "  scroll-snap-type: y mandatory;",
      "}",
      ".fresco-strip.fresco-strip--snap-mandatory > img {",
      "  scroll-snap-align: start;",
      "}",
      ".fresco-strip.fresco-strip--snap-proximity {",
      "  scroll-snap-type: y proximity;",
      "}",
      ".fresco-strip.fresco-strip--snap-proximity > img {",
      "  scroll-snap-align: start;",
      "}",
      "@media (prefers-color-scheme: dark) {",
      "  .fresco-strip:not([data-fresco-theme=\"light\"]):not([data-fresco-theme=\"inherit\"]) {",
      "    --fresco-bg: #0a0a0a;",
      "    --fresco-nav-bg: rgba(255, 255, 255, 0.12);",
      "    --fresco-nav-bg-hover: rgba(255, 255, 255, 0.20);",
      "    --fresco-nav-fg: #fff;",
      "    --fresco-nav-focus: rgba(255, 255, 255, 0.7);",
      "  }",
      "}",
      ".fresco-strip[data-fresco-theme=\"dark\"] {",
      "  --fresco-bg: #0a0a0a;",
      "  --fresco-nav-bg: rgba(255, 255, 255, 0.12);",
      "  --fresco-nav-bg-hover: rgba(255, 255, 255, 0.20);",
      "  --fresco-nav-fg: #fff;",
      "  --fresco-nav-focus: rgba(255, 255, 255, 0.7);",
      "}",
      ".fresco-strip[data-fresco-theme=\"light\"] {",
      "  --fresco-bg: #fafafa;",
      "  --fresco-nav-bg: rgba(0, 0, 0, 0.55);",
      "  --fresco-nav-bg-hover: rgba(0, 0, 0, 0.78);",
      "  --fresco-nav-fg: #fff;",
      "  --fresco-nav-focus: rgba(255, 255, 255, 0.7);",
      "}"
    ].join("\n");

    var style = document.createElement("style");
    style.setAttribute("data-fresco", "");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function makeButton(svg, title, onClick) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.innerHTML = svg;
    btn.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  // ===========================================================================
  // Shared event-bus helper. Used by the viewer, canvas, and strip handles.
  // ===========================================================================

  function createEventBus() {
    var subscribers = {};

    return {
      on: function(eventName, handler) {
        subscribers[eventName] = subscribers[eventName] || [];
        subscribers[eventName].push(handler);
        return function unsubscribe() {
          var arr = subscribers[eventName] || [];
          var idx = arr.indexOf(handler);
          if (idx !== -1) arr.splice(idx, 1);
        };
      },

      _emit: function(eventName, payload) {
        var arr = subscribers[eventName] || [];
        for (var i = 0; i < arr.length; i++) {
          try { arr[i](payload); } catch (_) {}
        }
      }
    };
  }

  // ===========================================================================
  // Shared nav-button attach helper. Returns an unsubscribe function carrying
  // `.setIcon(svg) / .setTitle(text) / .el`. No-op when navEl is null.
  // ===========================================================================

  function attachNavButton(navEl, svg, title, onClick) {
    if (!navEl) return function noop() {};
    var btn = makeButton(svg, title, onClick);
    navEl.appendChild(btn);
    var remove = function removeButton() {
      if (btn.parentNode === navEl) navEl.removeChild(btn);
    };
    remove.setIcon = function(nextSvg) { btn.innerHTML = nextSvg; };
    remove.setTitle = function(nextTitle) {
      btn.title = nextTitle;
      btn.setAttribute("aria-label", nextTitle);
    };
    remove.el = btn;
    return remove;
  }

  // ===========================================================================
  // Nav overlay — four buttons (fullscreen, zoom-in, zoom-out, reset). The
  // host element provides relative positioning (set in CSS), and the nav
  // attaches as a child so extensions can append more buttons via
  // `handle.appendNavButton(...)`.
  // ===========================================================================

  function buildNav(host, handlers) {
    injectStyles();
    var nav = document.createElement("div");
    nav.className = "fresco-nav";
    nav.appendChild(makeButton(ICONS.expand, "Toggle fullscreen", handlers.onFullscreen));
    nav.appendChild(makeButton(ICONS.zoomIn, "Zoom in",  handlers.onZoomIn));
    nav.appendChild(makeButton(ICONS.zoomOut, "Zoom out", handlers.onZoomOut));
    nav.appendChild(makeButton(ICONS.reset,  "Reset view", handlers.onFit));
    host.appendChild(nav);
    return nav;
  }

  // ===========================================================================
  // Shared transform engine — drives both <Fresco.viewer> (single image) and
  // <Fresco.canvas> (N images at canvas-pixel coords). The math is identical;
  // only what gets sized per-frame differs.
  //
  // Callers provide:
  //   getNaturalSize() → {w, h}   // viewer: image natural dims; canvas: canvas extent
  //   applyChildren(s)             // viewer: resize one <img>; canvas: re-layout all <img>s
  //
  // The engine owns state (tx, ty, s, vw, vh, …), gestures, fit/clamp math,
  // ResizeObserver, the nav overlay, the event bus, and teardown.
  // ===========================================================================

  function createTransformEngine(opts) {
    var el             = opts.el;
    var stage          = opts.stage;
    var getNaturalSize = opts.getNaturalSize;
    var applyChildren  = opts.applyChildren;
    var infiniteCanvas = !!opts.infiniteCanvas;

    // ── State ──────────────────────────────────────────────────────────────
    var tx = 0, ty = 0, s = 1;
    var nw = 0, nh = 0;          // natural extent (image natural for viewer; canvas dims for canvas)
    var vw = 0, vh = 0;          // viewport
    var sFit = 1, sMin = 1, sMax = 8;
    var frameRequested = false;
    var ready = false;
    var bus = createEventBus();
    var pointers = new Map();
    var gestureStart = null;

    // ── Math ───────────────────────────────────────────────────────────────
    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

    function recomputeBounds() {
      if (nw > 0 && nh > 0 && vw > 0 && vh > 0) {
        sFit = Math.min(vw / nw, vh / nh);
      } else {
        sFit = 1;
      }
      sMin = infiniteCanvas ? sFit * 0.05 : sFit;
      // GPU safety: keep the rasterized layer under MAX_RASTER_DIM on each
      // axis or the browser re-rasterizes mid-zoom (the one-time flash bug).
      var MAX_RASTER_DIM = 8192;
      var rasterCap = MAX_RASTER_DIM / Math.max(nw || 1, nh || 1);
      sMax = Math.min(8, rasterCap);
      if (sMax < sFit) sMax = sFit;
      if (sMax < 1) sMax = Math.max(sFit, 1);
    }

    function clampPan() {
      if (infiniteCanvas) return;
      var w = nw * s, h = nh * s;
      if (w >= vw) { tx = clamp(tx, vw - w, 0); } else { tx = (vw - w) / 2; }
      if (h >= vh) { ty = clamp(ty, vh - h, 0); } else { ty = (vh - h) / 2; }
    }

    // Re-read natural size + viewport from the DOM, recompute bounds, re-clamp.
    // Use this when source dimensions changed (image load, layout swap) but
    // you don't want to force a refit (preserves user's current zoom intent).
    function refresh() {
      var n = getNaturalSize();
      nw = n.w || 0;
      nh = n.h || 0;
      var rect = el.getBoundingClientRect();
      vw = rect.width;
      vh = rect.height;
      recomputeBounds();
      if (s < sMin) s = sMin;
      if (s > sMax) s = sMax;
      clampPan();
    }

    function fit() {
      refresh();
      s = sFit;
      tx = (vw - nw * s) / 2;
      ty = (vh - nh * s) / 2;
      clampPan();
      requestFrame();
    }

    function zoomAt(px, py, k) {
      var s2 = clamp(s * k, sMin, sMax);
      if (s2 === s) return;
      var kEff = s2 / s;
      tx = px - (px - tx) * kEff;
      ty = py - (py - ty) * kEff;
      s = s2;
      clampPan();
      bus._emit("zoom", { scale: s });
      requestFrame();
    }

    function panBy(dx, dy) {
      tx += dx; ty += dy;
      clampPan();
      bus._emit("pan", { tx: tx, ty: ty });
      requestFrame();
    }

    function setTransform(nextTx, nextTy, nextS) {
      tx = nextTx; ty = nextTy;
      s = clamp(nextS, sMin, sMax);
      clampPan();
      requestFrame();
    }

    function apply() {
      applyChildren(s);
      stage.style.transform = "translate3d(" + tx + "px, " + ty + "px, 0)";
      bus._emit("animation", { tx: tx, ty: ty, scale: s });
      bus._emit("update-viewport", { tx: tx, ty: ty, scale: s });
    }

    function requestFrame() {
      if (frameRequested) return;
      frameRequested = true;
      window.requestAnimationFrame(function() {
        frameRequested = false;
        apply();
      });
    }

    // ── Gestures ───────────────────────────────────────────────────────────
    function viewportRect() { return el.getBoundingClientRect(); }
    function midpoint(p1, p2) { return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }; }
    function distance(p1, p2) {
      var dx = p2.x - p1.x, dy = p2.y - p1.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function isFromNav(e) {
      return e.target && e.target.closest && (
        e.target.closest(".fresco-nav") ||
        e.target.closest("[data-fresco-no-capture]")
      );
    }

    function snapshotGesture() {
      var rect = viewportRect();
      var pts = Array.from(pointers.values());
      if (pts.length === 1) {
        gestureStart = {
          kind: "pan",
          tx: tx, ty: ty,
          x: pts[0].x, y: pts[0].y
        };
      } else if (pts.length >= 2) {
        var mid = midpoint(pts[0], pts[1]);
        gestureStart = {
          kind: "pinch",
          tx: tx, ty: ty, s: s,
          midX: mid.x - rect.left,
          midY: mid.y - rect.top,
          pageMidX: mid.x,
          pageMidY: mid.y,
          dist: distance(pts[0], pts[1])
        };
      } else {
        gestureStart = null;
      }
    }

    function onPointerDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (isFromNav(e)) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.classList.add("fresco--dragging");
      snapshotGesture();
    }

    function onPointerMove(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gestureStart) return;

      if (gestureStart.kind === "pan") {
        var dx = e.clientX - gestureStart.x;
        var dy = e.clientY - gestureStart.y;
        tx = gestureStart.tx + dx;
        ty = gestureStart.ty + dy;
        clampPan();
        bus._emit("pan", { tx: tx, ty: ty });
        requestFrame();
        return;
      }

      if (gestureStart.kind === "pinch") {
        var pts = Array.from(pointers.values());
        if (pts.length < 2) return;
        var newDist = distance(pts[0], pts[1]);
        if (newDist === 0) return;
        var newMid = midpoint(pts[0], pts[1]);

        var s2 = clamp(gestureStart.s * (newDist / gestureStart.dist), sMin, sMax);
        var kEff = s2 / gestureStart.s;
        var newTx = gestureStart.midX - (gestureStart.midX - gestureStart.tx) * kEff;
        var newTy = gestureStart.midY - (gestureStart.midY - gestureStart.ty) * kEff;

        newTx += (newMid.x - gestureStart.pageMidX);
        newTy += (newMid.y - gestureStart.pageMidY);

        tx = newTx; ty = newTy; s = s2;
        clampPan();
        bus._emit("zoom", { scale: s });
        bus._emit("pan", { tx: tx, ty: ty });
        requestFrame();
      }
    }

    function onPointerUp(e) {
      pointers.delete(e.pointerId);
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      if (pointers.size >= 1) {
        snapshotGesture();
      } else {
        gestureStart = null;
        el.classList.remove("fresco--dragging");
      }
    }

    function onDragStart(e) { e.preventDefault(); }

    function onWheel(e) {
      if (isFromNav(e)) return;
      e.preventDefault();
      var rect = viewportRect();
      var px = e.clientX - rect.left;
      var py = e.clientY - rect.top;
      var k = Math.exp(-e.deltaY * 0.0015);
      zoomAt(px, py, k);
    }

    function onDblClick(e) {
      if (isFromNav(e)) return;
      var rect = viewportRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, 2);
    }

    function onKeyDown(e) {
      var t = e.target;
      if (t && t !== el && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      var handled = true;
      switch (e.key) {
        case "ArrowUp":    panBy(0, 60);  break;
        case "ArrowDown":  panBy(0, -60); break;
        case "ArrowLeft":  panBy(60, 0);  break;
        case "ArrowRight": panBy(-60, 0); break;
        case "+": case "=": zoomAt(vw / 2, vh / 2, 1.4); break;
        case "-": case "_": zoomAt(vw / 2, vh / 2, 1 / 1.4); break;
        case "0": fit(); break;
        case "f": case "F": toggleFullscreen(); break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    }

    function toggleFullscreen() {
      if (document.fullscreenElement === el) {
        if (document.exitFullscreen) document.exitFullscreen();
      } else if (el.requestFullscreen) {
        el.requestFullscreen().catch(function() {});
      }
    }

    // ── Listeners + nav + resize ───────────────────────────────────────────
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("dblclick", onDblClick);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("dragstart", onDragStart);

    var navEl = buildNav(el, {
      onFit: fit,
      onZoomIn: function() {
        var rect = viewportRect();
        vw = rect.width; vh = rect.height;
        zoomAt(vw / 2, vh / 2, 1.4);
      },
      onZoomOut: function() {
        var rect = viewportRect();
        vw = rect.width; vh = rect.height;
        zoomAt(vw / 2, vh / 2, 1 / 1.4);
      },
      onFullscreen: toggleFullscreen
    });

    var resizeObserver = null;
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(function() {
        if (!ready) return;
        var rect = viewportRect();
        if (rect.width === vw && rect.height === vh) return;
        vw = rect.width; vh = rect.height;
        recomputeBounds();
        if (s < sMin) s = sMin;
        if (s > sMax) s = sMax;
        clampPan();
        bus._emit("resize", { width: vw, height: vh });
        requestFrame();
      });
      resizeObserver.observe(el);
    }

    function teardown() {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("dblclick", onDblClick);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("dragstart", onDragStart);
      if (resizeObserver) {
        try { resizeObserver.disconnect(); } catch (_) {}
        resizeObserver = null;
      }
      if (navEl && navEl.parentNode) navEl.parentNode.removeChild(navEl);
    }

    return {
      el: el,
      stage: stage,
      navEl: navEl,
      bus: bus,
      fit: fit,
      zoomAt: zoomAt,
      panBy: panBy,
      setTransform: setTransform,
      refresh: refresh,
      requestFrame: requestFrame,
      getTransform: function() { return { tx: tx, ty: ty, s: s }; },
      getViewportSize: function() { return { vw: vw, vh: vh }; },
      getNaturalSize: function() { return { w: nw, h: nh }; },
      isInfiniteCanvas: function() { return infiniteCanvas; },
      isReady: function() { return ready; },
      setReady: function(b) { ready = b; },
      teardown: teardown
    };
  }

  // ===========================================================================
  // <Fresco.viewer> mount — single image, the simple case. Wraps the engine
  // with image-load handling and source-swap methods.
  // ===========================================================================

  function mountFrescoViewer(el) {
    var stage = el.querySelector("[data-fresco-stage]") || el.querySelector(".fresco-stage");
    var img = stage && stage.querySelector("[data-fresco-img]");
    if (!stage || !img) {
      console.warn("[Fresco] mount: missing .fresco-stage or <img> inside", el);
      return null;
    }

    // CSS resets like Tailwind preflight set `img { max-width: 100% }` which
    // shrinks the layout box and breaks the transform math. Override inline
    // so any later stylesheet rule can't steal it back.
    el.style.touchAction = "none";
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.width = "auto";
    img.style.height = "auto";

    var infiniteCanvas = el.dataset.infiniteCanvas === "true";
    var currentSrc = img.getAttribute("src") || el.dataset.src || "";

    var engine = createTransformEngine({
      el: el,
      stage: stage,
      infiniteCanvas: infiniteCanvas,
      getNaturalSize: function() {
        return {
          w: img.naturalWidth || img.width || 0,
          h: img.naturalHeight || img.height || 0
        };
      },
      applyChildren: function(s) {
        var iw = img.naturalWidth || img.width || 0;
        var ih = img.naturalHeight || img.height || 0;
        img.style.width = (iw * s) + "px";
        img.style.height = (ih * s) + "px";
      }
    });

    function doFit() {
      engine.fit();
      engine.setReady(true);
      engine.bus._emit("open", {
        src: currentSrc,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
      });
    }

    function initEngineFromImg() {
      if (typeof img.decode === "function") {
        img.decode().then(doFit, doFit);
      } else {
        doFit();
      }
    }

    function onImgLoad() { initEngineFromImg(); }

    function setSource(url) {
      if (!url) return;
      currentSrc = url;
      var resolved = resolveTileSource(url);
      if (resolved.type !== "image") {
        console.error(
          "[Fresco] tile-source types other than \"image\" aren't supported in 0.5.x — " +
          "Tessera integration is planned for a later release."
        );
        return;
      }
      engine.setReady(false);
      img.addEventListener("load", onImgLoad, { once: true });
      img.src = resolved.url;
    }

    function swapSourcePreservingBounds(url) {
      if (!url) return;
      currentSrc = url;
      var resolved = resolveTileSource(url);
      if (resolved.type !== "image") {
        console.error(
          "[Fresco] tile-source types other than \"image\" aren't supported in 0.5.x — " +
          "Tessera integration is planned for a later release."
        );
        return;
      }
      var t0 = engine.getTransform();
      img.addEventListener("load", function once() {
        img.removeEventListener("load", once);
        engine.refresh();
        engine.setTransform(t0.tx, t0.ty, t0.s);
        engine.bus._emit("open", {
          src: currentSrc,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight
        });
      }, { once: true });
      img.src = resolved.url;
    }

    if (img.complete && img.naturalWidth > 0) {
      initEngineFromImg();
    } else {
      img.addEventListener("load", onImgLoad, { once: true });
    }

    return {
      el: el,
      stage: stage,
      img: img,
      navEl: engine.navEl,
      bus: engine.bus,
      getTransform: engine.getTransform,
      getViewportSize: engine.getViewportSize,
      getImageSize: function() {
        return { iw: img.naturalWidth || 0, ih: img.naturalHeight || 0 };
      },
      isInfiniteCanvas: engine.isInfiniteCanvas,
      getCurrentSrc: function() { return currentSrc; },
      fit: engine.fit,
      zoomAt: engine.zoomAt,
      panBy: engine.panBy,
      setTransform: engine.setTransform,
      setSource: setSource,
      swapSourcePreservingBounds: swapSourcePreservingBounds,
      teardown: engine.teardown
    };
  }

  // ===========================================================================
  // Viewer handle — public surface via window.Fresco.viewerFor(id).
  // ===========================================================================

  function makeViewerHandle(controller) {
    var bus = controller.bus;
    var el = controller.el;

    function imageToScreen(pt) {
      var t = controller.getTransform();
      var rect = el.getBoundingClientRect();
      return {
        x: (pt.x || 0) * t.s + t.tx + rect.left,
        y: (pt.y || 0) * t.s + t.ty + rect.top
      };
    }

    function screenToImage(pt) {
      var t = controller.getTransform();
      var rect = el.getBoundingClientRect();
      return {
        x: ((pt.x || 0) - rect.left - t.tx) / t.s,
        y: ((pt.y || 0) - rect.top - t.ty) / t.s
      };
    }

    function getViewportBounds() {
      var t = controller.getTransform();
      var v = controller.getViewportSize();
      return {
        x: -t.tx / t.s,
        y: -t.ty / t.s,
        width: v.vw / t.s,
        height: v.vh / t.s
      };
    }

    function fitBounds(rect) {
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      var v = controller.getViewportSize();
      var newS = Math.min(v.vw / rect.width, v.vh / rect.height);
      var newTx = (v.vw - newS * rect.width) / 2 - newS * rect.x;
      var newTy = (v.vh - newS * rect.height) / 2 - newS * rect.y;
      controller.setTransform(newTx, newTy, newS);
    }

    return {
      container: el,
      imageToScreen: imageToScreen,
      screenToImage: screenToImage,
      getViewportBounds: getViewportBounds,
      fitBounds: fitBounds,
      setSource: function(url) { controller.setSource(url); },
      swapSourcePreservingBounds: function(url) { controller.swapSourcePreservingBounds(url); },
      on: bus.on,
      _emit: bus._emit,
      appendNavButton: function(svg, title, onClick) {
        return attachNavButton(controller.navEl, svg, title, onClick);
      }
    };
  }

  // ===========================================================================
  // FrescoViewer LiveView hook
  // ===========================================================================

  window.FrescoHooks = window.FrescoHooks || {};

  window.FrescoHooks.FrescoViewer = {
    mounted: function() {
      injectStyles();
      var controller = mountFrescoViewer(this.el);
      if (!controller) return;
      this.controller = controller;
      var handle = makeViewerHandle(controller);
      this.handle = handle;
      publishReady(this.el.id, handle);
    },

    updated: function() {
      if (!this.controller) return;
      var next = this.el.dataset.src;
      if (next && next !== this.controller.getCurrentSrc()) {
        this.controller.swapSourcePreservingBounds(next);
      }
    },

    destroyed: function() {
      if (this.el && this.el.id) unpublish(this.el.id);
      if (this.controller) {
        try { this.controller.teardown(); } catch (_) {}
        this.controller = null;
      }
      this.handle = null;
    }
  };

  // ===========================================================================
  // <Fresco.canvas> mount — N images laid out at canvas-pixel coords.
  //
  // The host carries data-canvas-width/-height. The stage holds N <img>
  // children with data-canvas-x/-y/-width (and optional data-canvas-height,
  // data-image-id, data-z-index). The engine's applyChildren(s) walks the
  // imgs every frame and rewrites each one's left/top/width/height.
  // Single-image is just N=1.
  //
  // The canvas handle adds: getCanvasSize, getImages, imageBoundsFor,
  // fitImage, getExtension (read-only; extensions write through LiveView).
  // Coordinates operate in canvas-pixel space — same coord system the
  // .fresco file uses, so annotation payloads compose uniformly.
  // ===========================================================================

  function mountFrescoCanvas(el) {
    var stage = el.querySelector("[data-fresco-stage]") || el.querySelector(".fresco-stage");
    if (!stage) {
      console.warn("[Fresco] canvas mount: missing .fresco-stage", el);
      return null;
    }

    el.style.touchAction = "none";

    var canvasW = parseFloat(el.dataset.canvasWidth) || 0;
    var canvasH = parseFloat(el.dataset.canvasHeight) || 0;
    var infiniteCanvas = el.dataset.infiniteCanvas === "true";

    var imgs = Array.from(stage.querySelectorAll("[data-fresco-canvas-img]"));
    function applyImgResets(im) {
      im.style.maxWidth = "none";
      im.style.maxHeight = "none";
    }
    imgs.forEach(applyImgResets);

    function imgRect(im) {
      var x = parseFloat(im.dataset.canvasX) || 0;
      var y = parseFloat(im.dataset.canvasY) || 0;
      var w = parseFloat(im.dataset.canvasWidth) || 0;
      var dh = parseFloat(im.dataset.canvasHeight);
      var h;
      if (dh > 0) {
        h = dh;
      } else if (im.naturalWidth > 0 && im.naturalHeight > 0 && w > 0) {
        h = w * (im.naturalHeight / im.naturalWidth);
      } else {
        h = 0;
      }
      return { x: x, y: y, width: w, height: h };
    }

    var engine = createTransformEngine({
      el: el,
      stage: stage,
      infiniteCanvas: infiniteCanvas,
      getNaturalSize: function() { return { w: canvasW, h: canvasH }; },
      applyChildren: function(s) {
        for (var i = 0; i < imgs.length; i++) {
          var im = imgs[i];
          var r = imgRect(im);
          im.style.left = (r.x * s) + "px";
          im.style.top = (r.y * s) + "px";
          im.style.width = (r.width * s) + "px";
          if (r.height > 0) {
            im.style.height = (r.height * s) + "px";
          }
        }
      }
    });

    // Hydrate from server-rendered HTML and run initial fit. Canvas dims are
    // known immediately — no need to wait for image loads. Per-image natural
    // dims arrive later via load events; we requestFrame on each load so
    // heights derived from natural aspect ratio settle in cleanly.
    function initialFit() {
      engine.fit();
      engine.setReady(true);
      engine.bus._emit("open", {
        canvasWidth: canvasW,
        canvasHeight: canvasH,
        imageCount: imgs.length
      });
    }
    initialFit();

    function onImgLoad(e) {
      var im = e.target;
      engine.bus._emit("image-loaded", {
        imageId: im.dataset.imageId,
        naturalWidth: im.naturalWidth,
        naturalHeight: im.naturalHeight
      });
      engine.requestFrame();
    }
    imgs.forEach(function(im) {
      if (!im.complete) im.addEventListener("load", onImgLoad);
      else if (im.naturalWidth > 0) {
        engine.bus._emit("image-loaded", {
          imageId: im.dataset.imageId,
          naturalWidth: im.naturalWidth,
          naturalHeight: im.naturalHeight
        });
      }
    });

    // Re-read canvas dims and images list — called from the hook's `updated`
    // callback when the server-rendered layout changes.
    function refreshLayout() {
      canvasW = parseFloat(el.dataset.canvasWidth) || 0;
      canvasH = parseFloat(el.dataset.canvasHeight) || 0;
      imgs = Array.from(stage.querySelectorAll("[data-fresco-canvas-img]"));
      imgs.forEach(applyImgResets);
      imgs.forEach(function(im) {
        if (!im.complete) im.addEventListener("load", onImgLoad);
      });
      engine.refresh();
      engine.requestFrame();
    }

    function imageBoundsFor(id) {
      for (var i = 0; i < imgs.length; i++) {
        if (imgs[i].dataset.imageId === id) return imgRect(imgs[i]);
      }
      return null;
    }

    function getImages() {
      return imgs.map(function(im) {
        var r = imgRect(im);
        return {
          id: im.dataset.imageId || null,
          x: r.x, y: r.y, width: r.width, height: r.height,
          z_index: parseInt(im.dataset.zIndex || im.style.zIndex || "0", 10),
          naturalWidth: im.naturalWidth || 0,
          naturalHeight: im.naturalHeight || 0,
          src: im.getAttribute("src") || ""
        };
      });
    }

    function getExtension(name) {
      var raw = el.dataset.extensions;
      if (!raw) return undefined;
      try {
        var parsed = JSON.parse(raw);
        return parsed && parsed[name];
      } catch (_) { return undefined; }
    }

    return {
      el: el,
      stage: stage,
      imgs: imgs,
      navEl: engine.navEl,
      bus: engine.bus,
      getTransform: engine.getTransform,
      getViewportSize: engine.getViewportSize,
      isInfiniteCanvas: engine.isInfiniteCanvas,
      getCanvasSize: function() { return { width: canvasW, height: canvasH }; },
      getImages: getImages,
      imageBoundsFor: imageBoundsFor,
      getExtension: getExtension,
      fit: engine.fit,
      zoomAt: engine.zoomAt,
      panBy: engine.panBy,
      setTransform: engine.setTransform,
      refreshLayout: refreshLayout,
      teardown: engine.teardown
    };
  }

  // ===========================================================================
  // Canvas handle — public surface via window.Fresco.viewerFor(id) /
  // window.Fresco.onReady(id, cb).
  // ===========================================================================

  function makeCanvasHandle(controller) {
    var bus = controller.bus;
    var el = controller.el;

    function imageToScreen(pt) {
      var t = controller.getTransform();
      var rect = el.getBoundingClientRect();
      return {
        x: (pt.x || 0) * t.s + t.tx + rect.left,
        y: (pt.y || 0) * t.s + t.ty + rect.top
      };
    }

    function screenToImage(pt) {
      var t = controller.getTransform();
      var rect = el.getBoundingClientRect();
      return {
        x: ((pt.x || 0) - rect.left - t.tx) / t.s,
        y: ((pt.y || 0) - rect.top - t.ty) / t.s
      };
    }

    function getViewportBounds() {
      var t = controller.getTransform();
      var v = controller.getViewportSize();
      return {
        x: -t.tx / t.s,
        y: -t.ty / t.s,
        width: v.vw / t.s,
        height: v.vh / t.s
      };
    }

    function fitBounds(rect) {
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      var v = controller.getViewportSize();
      var newS = Math.min(v.vw / rect.width, v.vh / rect.height);
      var newTx = (v.vw - newS * rect.width) / 2 - newS * rect.x;
      var newTy = (v.vh - newS * rect.height) / 2 - newS * rect.y;
      controller.setTransform(newTx, newTy, newS);
    }

    function fitImage(id) {
      var bounds = controller.imageBoundsFor(id);
      if (bounds) fitBounds(bounds);
    }

    return {
      container: el,
      imageToScreen: imageToScreen,
      screenToImage: screenToImage,
      getViewportBounds: getViewportBounds,
      fitBounds: fitBounds,
      getCanvasSize: controller.getCanvasSize,
      getImages: controller.getImages,
      imageBoundsFor: controller.imageBoundsFor,
      fitImage: fitImage,
      getExtension: controller.getExtension,
      on: bus.on,
      _emit: bus._emit,
      appendNavButton: function(svg, title, onClick) {
        return attachNavButton(controller.navEl, svg, title, onClick);
      }
    };
  }

  // ===========================================================================
  // FrescoCanvas LiveView hook
  // ===========================================================================

  window.FrescoHooks.FrescoCanvas = {
    mounted: function() {
      injectStyles();
      var controller = mountFrescoCanvas(this.el);
      if (!controller) return;
      this.controller = controller;
      var handle = makeCanvasHandle(controller);
      this.handle = handle;
      // Initialize layout rev so `updated` can fast-path extension-only churn.
      this._layoutRev = this.el.dataset.canvasWidth + "x" + this.el.dataset.canvasHeight + ":" +
                        this.el.querySelectorAll("[data-fresco-canvas-img]").length;
      publishReady(this.el.id, handle);
    },

    updated: function() {
      if (!this.controller) return;
      // Fast-path: skip DOM work when only `data-extensions` changed (Etcher
      // will churn this on every annotation edit). Re-layout only when canvas
      // dims or image count actually changed.
      var nextLayoutRev = this.el.dataset.canvasWidth + "x" + this.el.dataset.canvasHeight + ":" +
                         this.el.querySelectorAll("[data-fresco-canvas-img]").length;
      if (nextLayoutRev !== this._layoutRev) {
        this._layoutRev = nextLayoutRev;
        this.controller.refreshLayout();
      }
    },

    destroyed: function() {
      if (this.el && this.el.id) unpublish(this.el.id);
      if (this.controller) {
        try { this.controller.teardown(); } catch (_) {}
        this.controller = null;
      }
      this.handle = null;
    }
  };

  // ===========================================================================
  // Strip handle — unchanged from 0.4.x (the strip component was already lite).
  //
  // Surface mirrors the viewer handle where it makes sense (`container`, `on`,
  // `_emit`, `appendNavButton`) and replaces the rest with strip-native
  // methods:
  //
  //   handle.scrollTo({imageIdx, y, behavior})  — replaces panTo
  //   handle.scrollBy({dy, behavior})           — replaces panBy
  //   handle.imageToScreen({imageIdx, x, y})    — coords are per-image
  //   handle.screenToImage({x, y}) → {imageIdx, x, y}
  //   handle.getScrollState()                   — strip equivalent of bounds
  // ===========================================================================

  function makeStripHandle(container, sources, opts) {
    opts = opts || {};
    var navEl = opts.navEl || null;

    var bus = createEventBus();

    function imgAt(idx) {
      if (!container) return null;
      return container.querySelector(
        '[data-fresco-strip-img][data-image-idx="' + idx + '"]'
      );
    }

    function scrollTopFor(idx, y) {
      var img = imgAt(idx);
      if (!img) return null;
      var rect = img.getBoundingClientRect();
      var cRect = container.getBoundingClientRect();
      return container.scrollTop + (rect.top - cRect.top) + (y || 0);
    }

    function scrollTo(payload) {
      payload = payload || {};
      var behavior = payload.behavior === "smooth" ? "smooth" : "instant";
      var idx = typeof payload.imageIdx === "number" ? payload.imageIdx : 0;
      var y = typeof payload.y === "number" ? payload.y : 0;
      var top = scrollTopFor(idx, y);
      if (top == null) return;
      try {
        container.scrollTo({ top: top, behavior: behavior });
      } catch (_) {
        container.scrollTop = top;
      }
    }

    function scrollBy(payload) {
      payload = payload || {};
      var dy = typeof payload.dy === "number" ? payload.dy : 0;
      var behavior = payload.behavior === "smooth" ? "smooth" : "instant";
      try {
        container.scrollBy({ top: dy, behavior: behavior });
      } catch (_) {
        container.scrollTop = container.scrollTop + dy;
      }
    }

    function imageToScreen(pt) {
      pt = pt || {};
      var idx = typeof pt.imageIdx === "number" ? pt.imageIdx : 0;
      var img = imgAt(idx);
      if (!img) return { x: 0, y: 0 };
      var rect = img.getBoundingClientRect();
      var scale = rect.width / (sources[idx] && sources[idx].width ? sources[idx].width : rect.width);
      return {
        x: rect.left + (pt.x || 0) * scale,
        y: rect.top + (pt.y || 0) * scale
      };
    }

    function screenToImage(pt) {
      pt = pt || {};
      var px = typeof pt.x === "number" ? pt.x : 0;
      var py = typeof pt.y === "number" ? pt.y : 0;
      for (var i = 0; i < sources.length; i++) {
        var img = imgAt(i);
        if (!img) continue;
        var rect = img.getBoundingClientRect();
        if (py >= rect.top && py <= rect.bottom) {
          var scale = (sources[i] && sources[i].width) ? sources[i].width / rect.width : 1;
          return {
            imageIdx: i,
            x: (px - rect.left) * scale,
            y: (py - rect.top) * scale
          };
        }
      }
      return { imageIdx: py < 0 ? 0 : sources.length - 1, x: 0, y: 0 };
    }

    function getScrollState() {
      var state = opts.getState ? opts.getState() : {};
      return {
        scrollTop: container ? container.scrollTop : 0,
        scrollHeight: container ? container.scrollHeight : 0,
        viewportH: container ? container.clientHeight : 0,
        currentImageIdx: state.currentImageIdx || 0,
        fractionWithin: state.fractionWithin || 0
      };
    }

    var handle = {
      container: container,

      scrollTo: scrollTo,
      scrollBy: scrollBy,
      imageToScreen: imageToScreen,
      screenToImage: screenToImage,
      getScrollState: getScrollState,

      on: bus.on,
      _emit: bus._emit,

      appendNavButton: function(svg, title, onClick) {
        return attachNavButton(navEl, svg, title, onClick);
      }
    };

    // Throwing getter: anything that pokes `handle.openSeadragon` on a strip
    // handle is almost certainly an overlay written against an older Fresco.
    // The error message points at the fix — 0.5.x removed OSD entirely.
    Object.defineProperty(handle, "openSeadragon", {
      get: function() {
        throw new Error(
          "[Fresco] handle.openSeadragon is gone in 0.5.x — Fresco no longer " +
          "wraps OpenSeadragon. Update overlays to use coordinate adapters " +
          "(`handle.imageToScreen`/`handle.screenToImage`) and event hooks " +
          "(`handle.on(\"zoom\"|\"pan\"|\"animation\", …)`), or attach as a " +
          "child of `.fresco-stage` to inherit the transform for free."
        );
      },
      configurable: false
    });

    return handle;
  }

  // ===========================================================================
  // FrescoScrollStrip LiveView hook
  //
  // Native browser scroll on DOM <img> elements (one per source), with
  // memory windowing so off-screen images get their `src` evicted to free
  // decoded-image memory. The component server-renders the entire DOM —
  // this hook only attaches scroll handlers and the strip handle.
  // ===========================================================================

  window.FrescoHooks.FrescoScrollStrip = {
    mounted: function() {
      var self = this;
      var container = self.el;
      if (!container) return;

      var sourcesJson = container.dataset.sources;
      var sources;
      try {
        sources = JSON.parse(sourcesJson);
        if (!Array.isArray(sources) || sources.length === 0) throw new Error("empty");
      } catch (_) {
        console.warn(
          "[Fresco] FrescoScrollStrip mount: data-sources missing or malformed", container
        );
        return;
      }

      var windowBefore = parseInt(container.dataset.windowBefore || "1", 10);
      var windowAfter = parseInt(container.dataset.windowAfter || "3", 10);

      var state = { currentImageIdx: 0, fractionWithin: 0 };

      var handle = makeStripHandle(container, sources, {
        navEl: null,
        getState: function() { return state; }
      });
      self.handle = handle;
      self.sources = sources;

      // ---- Memory windowing -------------------------------------------------

      var allImgs = Array.from(
        container.querySelectorAll("[data-fresco-strip-img]")
      );

      function evictOutsideWindow(centerIdx) {
        var lo = Math.max(0, centerIdx - windowBefore);
        var hi = Math.min(sources.length - 1, centerIdx + windowAfter);
        for (var i = 0; i < allImgs.length; i++) {
          var img = allImgs[i];
          var idx = parseInt(img.dataset.imageIdx, 10);
          if (idx >= lo && idx <= hi) {
            if (!img.src && img.dataset.src) {
              img.src = img.dataset.src;
            }
          } else {
            if (img.src) {
              if (!img.dataset.src) img.dataset.src = img.src;
              img.removeAttribute("src");
              handle._emit("image-evicted", { imageIdx: idx });
            }
          }
        }
      }

      function onImgLoad(e) {
        var img = e.target;
        if (!img || !img.dataset) return;
        var idx = parseInt(img.dataset.imageIdx, 10);
        if (!isNaN(idx)) handle._emit("image-loaded", { imageIdx: idx });
      }
      allImgs.forEach(function(img) {
        img.addEventListener("load", onImgLoad);
      });

      // ---- Scroll bridge ----------------------------------------------------

      var pendingScroll = false;

      function computeDominantImage() {
        var cTop = container.scrollTop;
        var cMid = cTop + container.clientHeight / 2;
        var bestIdx = state.currentImageIdx;
        var bestDist = Infinity;
        for (var i = 0; i < allImgs.length; i++) {
          var img = allImgs[i];
          var idx = parseInt(img.dataset.imageIdx, 10);
          var top = img.offsetTop;
          var mid = top + img.offsetHeight / 2;
          var dist = Math.abs(mid - cMid);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = idx;
          }
        }
        var dominantImg = allImgs.find(function(img) {
          return parseInt(img.dataset.imageIdx, 10) === bestIdx;
        });
        var frac = 0;
        if (dominantImg && dominantImg.offsetHeight > 0) {
          frac = (cTop - dominantImg.offsetTop) / dominantImg.offsetHeight;
          if (frac < 0) frac = 0;
          if (frac > 1) frac = 1;
        }
        return { currentImageIdx: bestIdx, fractionWithin: frac };
      }

      function onScrollTick() {
        pendingScroll = false;
        handle._emit("scroll", {
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight
        });
        var next = computeDominantImage();
        if (next.currentImageIdx !== state.currentImageIdx) {
          state.currentImageIdx = next.currentImageIdx;
          state.fractionWithin = next.fractionWithin;
          handle._emit("viewport-change", {
            currentImageIdx: state.currentImageIdx,
            fractionWithin: state.fractionWithin
          });
          evictOutsideWindow(state.currentImageIdx);
        } else {
          state.fractionWithin = next.fractionWithin;
        }
      }

      self._onScroll = function() {
        if (pendingScroll) return;
        pendingScroll = true;
        window.requestAnimationFrame(onScrollTick);
      };
      container.addEventListener("scroll", self._onScroll, { passive: true });

      // ---- Server-pushed scroll --------------------------------------------

      self._onServerScroll = function(payload) {
        handle.scrollTo(payload || {});
      };
      if (typeof self.handleEvent === "function") {
        self.handleEvent("phx:scroll-to", self._onServerScroll);
      }

      // ---- Mount sequencing -------------------------------------------------

      var initial = computeDominantImage();
      state.currentImageIdx = initial.currentImageIdx;
      state.fractionWithin = initial.fractionWithin;
      evictOutsideWindow(state.currentImageIdx);

      publishReady(container.id, handle);

      handle._emit("viewport-change", {
        currentImageIdx: state.currentImageIdx,
        fractionWithin: state.fractionWithin
      });
      handle._emit("open", { sources: sources });
    },

    updated: function() {
      // Sources are immutable after mount. Consumers who need to swap should
      // change the component's `:id` to trigger a remount.
    },

    destroyed: function() {
      if (this.el && this.el.id) unpublish(this.el.id);
      if (this._onScroll && this.el) {
        this.el.removeEventListener("scroll", this._onScroll);
        this._onScroll = null;
      }
      this.handle = null;
      this.sources = null;
    }
  };
})();
