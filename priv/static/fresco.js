// Fresco — polished pan-zoom image viewer for Phoenix apps.
//
// Hand-rolled CSS-transform pan/zoom engine. Zero external JS deps; no
// canvas, no tile pyramids, no spring math, no CDN load. The single <img>
// lives inside a stage div; `transform: translate3d(tx, ty, 0) scale(s)`
// on the stage handles all motion. Native Pointer Events drive gestures;
// native Fullscreen API handles fullscreen. The whole engine is small
// enough that consumers can audit every line.
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
// Events fired through `handle.on(eventName, fn)`:
//   "zoom" / "pan" / "open" / "resize"           — fired on intent (gesture start, source open, viewport resize)
//   "animation" / "update-viewport"              — fired per-frame, whenever the transform is rewritten
//
// Notes vs. 0.4.x:
//   - `handle.openSeadragon` / `handle.viewer` are gone. The engine is no
//     longer OSD-backed; there's no underlying instance to escape to.
//   - `getViewportBounds()` returns image-pixel coords `{x, y, width, height}`,
//     not OSD-normalized 0–1 rects.
//   - `fitBounds(..., immediately)` ignores `immediately` — the lite engine
//     has no animation system in 0.5.x.
//   - The `fast-pan` event is gone (no canvas redraw to coordinate around).
//     Overlays attached as children of `.fresco-stage` get the transform
//     for free; overlays driven by `on("zoom"|"pan"|"animation")` continue
//     to work.
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

  // Default source provider — last in the chain. Handles plain image URLs.
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

    // Same lookup as viewerFor; named separately so consumer code self-documents
    // which host shape it expects. Both share the registry.
    scrollStripFor: function(domId) {
      return viewerRegistry[domId] || null;
    },

    onViewerReady: function(domId, callback) {
      var handle = viewerRegistry[domId];
      if (handle) { callback(handle); return; }
      readyCallbacks[domId] = readyCallbacks[domId] || [];
      readyCallbacks[domId].push(callback);
    },

    // Alias for onViewerReady. The strip handle isn't a "viewer" colloquially —
    // callers reading scrollStrip code find onReady more natural.
    onReady: function(domId, callback) {
      return window.Fresco.onViewerReady(domId, callback);
    },

    // Register a source provider. Predicate is called with the source URL
    // before the default provider; first match wins. Providers added later
    // take precedence over the default (which always matches).
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
  // Styles — one stylesheet for both viewer and strip. The six --fresco-*
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

      // ── Viewer host theming ─────────────────────────────────────────────
      // Six --fresco-* custom properties drive the palette. The `inherit`
      // theme opts out of every Fresco-supplied declaration so the parent
      // app's CSS supplies the values (typically mapped to daisyUI tokens).
      ".fresco-viewer:not([data-fresco-theme=\"inherit\"]) {",
      "  --fresco-bg: #fafafa;",
      "  --fresco-grid-dot: #d4d4d8;",
      "  --fresco-nav-bg: rgba(0, 0, 0, 0.55);",
      "  --fresco-nav-bg-hover: rgba(0, 0, 0, 0.78);",
      "  --fresco-nav-fg: #fff;",
      "  --fresco-nav-focus: rgba(255, 255, 255, 0.7);",
      "}",
      // Structural rules — apply to every viewer regardless of theme.
      // `touch-action: none` is critical for iOS Safari: without it the
      // browser intercepts pinch + horizontal swipe (back-navigation) before
      // our PointerEvent handlers see them.
      // `user-select: none` blocks the i-beam highlight on the host so
      // mouse-drag pan doesn't look like a text selection in flight.
      // `cursor: grab` signals draggability; the engine swaps it to
      // `grabbing` during pointer gestures (via inline style).
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
      // Stage: the transformed surface holding the image. `transform-origin: 0 0`
      // pairs with our (tx, ty, s) math — translate first, then scale around
      // the stage's top-left, which is what makes `imageToScreen` correct.
      // The combo `will-change: transform` + `backface-visibility: hidden`
      // + a 3D transform string (`translate3d` + `scale3d` in apply()) keeps
      // the layer permanently composited on a single GPU plane. Without all
      // three, the browser re-rasterizes the layer the first time a zoom
      // threshold is crossed — visible as a one-time flash on the image.
      ".fresco-stage {",
      "  position: absolute; top: 0; left: 0;",
      "  transform-origin: 0 0;",
      "  will-change: transform;",
      "  backface-visibility: hidden;",
      "  -webkit-backface-visibility: hidden;",
      "}",
      // The stage <img> MUST be at its natural pixel size — the engine's
      // (tx, ty, s) math computes positions from `img.naturalWidth/Height`.
      // CSS resets like Tailwind v4's preflight (`img { max-width: 100% }`)
      // shrink the img's layout box and throw the transform math off, so
      // we explicitly opt out of any width/max-width clamping here.
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
      // (No CSS transition by design.) The engine sizes the <img> via its
      // CSS width/height (so the rasterized layer never has to upgrade
      // across zoom thresholds — that was the cause of the one-time
      // flash). A CSS transition would only animate the stage's translate
      // — the img resize would jump instantly — so the image would visibly
      // grow first, then slide into position. Better to snap instantly
      // and add a JS-driven animation later if needed.
      // System mode: follow OS preference. Excluded for explicit light or
      // inherit modes.
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
  // Shared event-bus helper. Used by the viewer handle and the strip handle.
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
  // `.setIcon(svg) / .setTitle(text) / .el` so callers can mutate after
  // creation without re-adding. When `navEl` is null (strip without a built-in
  // nav), returns a no-op so callers can call `appendNavButton` unconditionally.
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
  // Viewer engine — the new lite pan/zoom controller.
  //
  // State lives in closure-locals; no classes. The stage div (server-rendered
  // as a child of the host) receives `transform: translate3d(tx, ty, 0) scale(s)`.
  // All gestures mutate (tx, ty, s); a single rAF-coalesced apply() writes the
  // transform and emits events.
  //
  // Clamping (default mode): the image must cover the viewport — sMin = sFit
  // (image fits viewport), pan clamped so no void shows past edges.
  // Infinite-canvas mode: no pan clamp, sMin lowered to sFit * 0.05.
  // ===========================================================================

  function mountFrescoViewer(el) {
    // ── DOM ────────────────────────────────────────────────────────────────
    var stage = el.querySelector("[data-fresco-stage]") || el.querySelector(".fresco-stage");
    var img = stage && stage.querySelector("[data-fresco-img]");

    if (!stage || !img) {
      console.warn("[Fresco] mount: missing .fresco-stage or <img> inside", el);
      return null;
    }

    // Apply touch-action inline too — the stylesheet may not yet have
    // applied when iOS Safari processes the first pinch.
    el.style.touchAction = "none";

    // Belt-and-suspenders against framework resets (Tailwind preflight, etc.)
    // that apply `max-width: 100%` to <img>. The engine assumes the img is
    // at natural pixel size; if a framework rule wins (e.g., loaded after
    // Fresco's stylesheet), the transform math produces an off-center
    // result. Inline styles beat any stylesheet rule.
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.width = "auto";
    img.style.height = "auto";

    var infiniteCanvas = el.dataset.infiniteCanvas === "true";

    // ── State ──────────────────────────────────────────────────────────────
    var tx = 0, ty = 0, s = 1;            // current transform
    var iw = 0, ih = 0;                   // image natural dimensions (set on load)
    var vw = 0, vh = 0;                   // viewport dimensions (ResizeObserver-tracked)
    var sFit = 1;                         // cached fit-to-view scale
    var sMin = 1, sMax = 40;              // zoom bounds (recomputed when sFit changes)
    var currentSrc = img.getAttribute("src") || el.dataset.src || "";
    var frameRequested = false;
    var ready = false;                    // becomes true once the first fit() runs

    var bus = createEventBus();

    // Pointer tracking. Map<pointerId, {x, y}> in *page* coords (we convert to
    // viewport-local where needed via getBoundingClientRect()).
    var pointers = new Map();
    // gestureStart is null when idle; otherwise a snapshot taken at the moment
    // the gesture started (1-pointer pan, 2-pointer pinch).
    var gestureStart = null;

    // ── Transform math ─────────────────────────────────────────────────────

    function clamp(v, lo, hi) {
      return v < lo ? lo : v > hi ? hi : v;
    }

    function recomputeBounds() {
      // sFit = the scale at which the image just fits inside the viewport
      // (CONTAIN). In default (clamped) mode, this is also the minimum zoom.
      // In infinite-canvas mode, the user can zoom out further (to thumbnail).
      if (iw > 0 && ih > 0 && vw > 0 && vh > 0) {
        sFit = Math.min(vw / iw, vh / ih);
      } else {
        sFit = 1;
      }
      sMin = infiniteCanvas ? sFit * 0.05 : sFit;
      // sMax — twin cap. (1) Hard absolute: 8× natural pixel size, matching
      // OSD's old `maxZoomPixelRatio: 8`. (2) GPU safety: never let the
      // rasterized layer cross MAX_RASTER_DIM on either axis, or the browser
      // re-allocates the texture mid-zoom and the image flashes. 4096 is
      // safe on every mainstream GPU including mobile Safari; 8192 also
      // works on modern desktops. Going past these causes the flash the
      // user reported.
      var MAX_RASTER_DIM = 8192;
      var rasterCap = MAX_RASTER_DIM / Math.max(iw || 1, ih || 1);
      sMax = Math.min(8, rasterCap);
      // Don't let sMax fall below sFit (would be a contradiction — can't
      // zoom in past fit), or below a small absolute floor for safety.
      if (sMax < sFit) sMax = sFit;
      if (sMax < 1) sMax = Math.max(sFit, 1);
    }

    function clampPan() {
      if (infiniteCanvas) return;
      // Default mode: image must cover the viewport. If image larger than
      // viewport along an axis, clamp tx/ty so edges don't pull inside.
      // If smaller (only happens when image fits exactly at sFit on the
      // limiting axis), center on that axis.
      var imgW = iw * s;
      var imgH = ih * s;
      if (imgW >= vw) {
        tx = clamp(tx, vw - imgW, 0);
      } else {
        tx = (vw - imgW) / 2;
      }
      if (imgH >= vh) {
        ty = clamp(ty, vh - imgH, 0);
      } else {
        ty = (vh - imgH) / 2;
      }
    }

    function fit() {
      recomputeBounds();
      s = sFit;
      tx = (vw - iw * s) / 2;
      ty = (vh - ih * s) / 2;
      clampPan();
      requestFrame();
    }

    function zoomAt(px, py, k) {
      // (px, py) viewport-local. Scale around that point so the image-space
      // pixel under it stays put.
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
      tx += dx;
      ty += dy;
      clampPan();
      bus._emit("pan", { tx: tx, ty: ty });
      requestFrame();
    }

    function setTransform(nextTx, nextTy, nextS) {
      tx = nextTx;
      ty = nextTy;
      s = clamp(nextS, sMin, sMax);
      clampPan();
      requestFrame();
    }

    function apply() {
      // Two-part write per frame:
      // (1) the <img> takes its scaled CSS size — the browser renders the
      //     image at its current visible dimensions as plain layout, so it
      //     never has to upgrade a composited-layer texture mid-zoom (which
      //     was the source of the one-time flash);
      // (2) the stage carries translate3d only — pan is a pure GPU
      //     composite move, no layout, still 60fps smooth.
      img.style.width = (iw * s) + "px";
      img.style.height = (ih * s) + "px";
      stage.style.transform =
        "translate3d(" + tx + "px, " + ty + "px, 0)";
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

    function setTransitioning(_on) {
      // No-op for now — kept as a hook for a future JS-driven smooth-zoom
      // animation. (CSS transitions don't work cleanly with the
      // width/height-on-img rendering approach because the img resize
      // can't be synchronized with a transform-only transition.)
      el.classList.remove("fresco--transitioning");
    }

    // ── Pointer gestures (mouse + touch + pen, unified) ────────────────────

    function viewportRect() {
      return el.getBoundingClientRect();
    }

    function midpoint(p1, p2) {
      return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    }

    function distance(p1, p2) {
      var dx = p2.x - p1.x, dy = p2.y - p1.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function snapshotGesture() {
      // Take a fresh snapshot of the current pointers and viewport, used at
      // gesture start and whenever the pointer count changes (going from 2 → 1,
      // for example). All viewport-local coords are derived from page coords
      // at snapshot time so subsequent moves are just deltas off the snapshot.
      var rect = viewportRect();
      var pts = Array.from(pointers.values());
      if (pts.length === 1) {
        gestureStart = {
          kind: "pan",
          tx: tx, ty: ty,
          x: pts[0].x, y: pts[0].y,
          rectLeft: rect.left, rectTop: rect.top
        };
      } else if (pts.length >= 2) {
        var mid = midpoint(pts[0], pts[1]);
        gestureStart = {
          kind: "pinch",
          tx: tx, ty: ty, s: s,
          // midpoint in viewport-local coords (anchor for the zoom)
          midX: mid.x - rect.left,
          midY: mid.y - rect.top,
          // page-coords midpoint for delta tracking (so pinch can also pan)
          pageMidX: mid.x,
          pageMidY: mid.y,
          dist: distance(pts[0], pts[1]),
          rectLeft: rect.left, rectTop: rect.top
        };
      } else {
        gestureStart = null;
      }
    }

    function onPointerDown(e) {
      // Only primary buttons drive gestures — secondary/middle-click should
      // bubble (browsers use them for context menu, scroll, etc.).
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Don't steal pointer events that originated inside the nav (or any
      // interactive element marked with `data-fresco-no-capture`). Without
      // this guard, setPointerCapture on the host would hijack the pointer
      // before the button's click sequence completes, and nothing would
      // happen when the user clicks zoom-in / reset / fullscreen. The same
      // guard runs in onWheel and onDblClick so scrolling/double-clicking
      // over a button doesn't bleed through to the engine either.
      if (isFromNav(e)) return;
      // Critical: preventDefault stops Chrome from initiating its built-in
      // drag-image / text-selection gestures over the viewer. Without this,
      // mouse-drag pan turns into "save image" or i-beam selection, and
      // pointer capture never engages cleanly.
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      setTransitioning(false);
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

        // Step 1: zoom around the start midpoint (anchor stays fixed for
        // the duration of the pinch — feels more stable than re-anchoring).
        var s2 = clamp(gestureStart.s * (newDist / gestureStart.dist), sMin, sMax);
        var kEff = s2 / gestureStart.s;
        var newTx = gestureStart.midX - (gestureStart.midX - gestureStart.tx) * kEff;
        var newTy = gestureStart.midY - (gestureStart.midY - gestureStart.ty) * kEff;

        // Step 2: pan by the midpoint delta so users can also "drag" mid-pinch.
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
      // If we drop from pinch → pan, snapshot the remaining pointer so the
      // subsequent move continues smoothly from the current state.
      if (pointers.size >= 1) {
        snapshotGesture();
      } else {
        gestureStart = null;
        el.classList.remove("fresco--dragging");
      }
    }

    // Suppress Chrome's drag-image ghost as a belt-and-suspenders against
    // the pointerdown preventDefault — some Chrome versions still fire
    // `dragstart` for images even when pointerdown is suppressed.
    function onDragStart(e) {
      e.preventDefault();
    }

    // ── Wheel zoom (centered on cursor) ────────────────────────────────────

    function isFromNav(e) {
      return e.target && e.target.closest && (
        e.target.closest(".fresco-nav") ||
        e.target.closest("[data-fresco-no-capture]")
      );
    }

    function onWheel(e) {
      if (isFromNav(e)) return;
      e.preventDefault();
      var rect = viewportRect();
      var px = e.clientX - rect.left;
      var py = e.clientY - rect.top;
      // Smooth exponential decay — feels uniform across mouse wheel,
      // trackpad two-finger scroll (ctrlKey=false), and trackpad pinch
      // (ctrlKey=true, smaller deltaY). Sign convention: deltaY > 0 means
      // scroll down → zoom OUT.
      var k = Math.exp(-e.deltaY * 0.0015);
      setTransitioning(false);
      zoomAt(px, py, k);
    }

    function onDblClick(e) {
      if (isFromNav(e)) return;
      var rect = viewportRect();
      var px = e.clientX - rect.left;
      var py = e.clientY - rect.top;
      setTransitioning(false);
      zoomAt(px, py, 2);
    }

    // ── Keyboard ───────────────────────────────────────────────────────────

    function onKeyDown(e) {
      // Don't steal keys when the user is typing in a form or contenteditable.
      var t = e.target;
      if (t && t !== el && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      var handled = true;
      setTransitioning(false);
      switch (e.key) {
        case "ArrowUp":    panBy(0, 60);  break;
        case "ArrowDown":  panBy(0, -60); break;
        case "ArrowLeft":  panBy(60, 0);  break;
        case "ArrowRight": panBy(-60, 0); break;
        case "+": case "=":
          zoomAt(vw / 2, vh / 2, 1.4); break;
        case "-": case "_":
          zoomAt(vw / 2, vh / 2, 1 / 1.4); break;
        case "0":
          fit(); break;
        case "f": case "F":
          toggleFullscreen(); break;
        default:
          handled = false;
          setTransitioning(false);
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

    // ── Image load + initial fit ───────────────────────────────────────────

    function initEngineFromImg() {
      iw = img.naturalWidth || img.width || 0;
      ih = img.naturalHeight || img.height || 0;
      // Use decode() if available so the bitmap is GPU-uploaded before we
      // apply the first transform — eliminates "transform on undecoded image"
      // flash on slow connections. Viewport dimensions are re-read inside
      // doFit so any layout settling during decode() is captured fresh.
      var doFit = function() {
        var rect = viewportRect();
        vw = rect.width;
        vh = rect.height;
        recomputeBounds();
        fit();
        ready = true;
        bus._emit("open", { src: currentSrc, naturalWidth: iw, naturalHeight: ih });
      };
      if (typeof img.decode === "function") {
        img.decode().then(doFit, doFit);
      } else {
        doFit();
      }
    }

    function onImgLoad() {
      initEngineFromImg();
    }

    // ── Source swap ────────────────────────────────────────────────────────

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
      ready = false;
      // New <img> load → fit on completion.
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
      // Preserve (tx, ty, s) on load; recompute sFit/bounds against new dims
      // but don't refit. If natural dimensions change drastically, this may
      // crop weirdly — acceptable tradeoff for now (matches OSD's behavior).
      var prevTx = tx, prevTy = ty, prevS = s;
      img.addEventListener("load", function once() {
        img.removeEventListener("load", once);
        iw = img.naturalWidth || img.width || 0;
        ih = img.naturalHeight || img.height || 0;
        recomputeBounds();
        tx = prevTx; ty = prevTy; s = clamp(prevS, sMin, sMax);
        clampPan();
        bus._emit("open", { src: currentSrc, naturalWidth: iw, naturalHeight: ih });
        requestFrame();
      }, { once: true });
      img.src = resolved.url;
    }

    // ── Viewport resize ────────────────────────────────────────────────────

    var resizeObserver = null;
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(function() {
        if (!ready) return;
        var rect = viewportRect();
        if (rect.width === vw && rect.height === vh) return;
        vw = rect.width;
        vh = rect.height;
        recomputeBounds();
        // Preserve user's zoom intent on resize: only force-up if s falls
        // below the new sMin (e.g. viewport grew, fit scale grew). Always
        // re-clamp pan against the new bounds.
        if (s < sMin) s = sMin;
        if (s > sMax) s = sMax;
        clampPan();
        bus._emit("resize", { width: vw, height: vh });
        requestFrame();
      });
      resizeObserver.observe(el);
    }

    // ── Listeners ──────────────────────────────────────────────────────────

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("dblclick", onDblClick);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("dragstart", onDragStart);

    // Build the nav overlay (returns the nav element so the handle can attach
    // extension buttons via `appendNavButton`).
    var navEl = buildNav(el, {
      onFit: function() { setTransitioning(true); fit(); },
      onZoomIn: function() {
        var rect = viewportRect();
        vw = rect.width; vh = rect.height;
        setTransitioning(false);
        zoomAt(vw / 2, vh / 2, 1.4);
      },
      onZoomOut: function() {
        var rect = viewportRect();
        vw = rect.width; vh = rect.height;
        setTransitioning(false);
        zoomAt(vw / 2, vh / 2, 1 / 1.4);
      },
      onFullscreen: toggleFullscreen
    });

    // Wire image-load. If the server-rendered <img> already finished decoding
    // by the time we mounted, fire immediately; otherwise wait on `load`.
    if (img.complete && img.naturalWidth > 0) {
      initEngineFromImg();
    } else {
      img.addEventListener("load", onImgLoad, { once: true });
    }

    // ── Teardown ───────────────────────────────────────────────────────────

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

    // ── Controller — internal-facing API used by makeHandle ────────────────

    return {
      el: el,
      stage: stage,
      img: img,
      navEl: navEl,
      bus: bus,
      getTransform: function() { return { tx: tx, ty: ty, s: s }; },
      getViewportSize: function() { return { vw: vw, vh: vh }; },
      getImageSize: function() { return { iw: iw, ih: ih }; },
      isInfiniteCanvas: function() { return infiniteCanvas; },
      getCurrentSrc: function() { return currentSrc; },
      fit: function() { setTransitioning(true); fit(); },
      zoomAt: function(px, py, k) { setTransitioning(true); zoomAt(px, py, k); },
      panBy: function(dx, dy) { panBy(dx, dy); },
      setTransform: setTransform,
      setSource: setSource,
      swapSourcePreservingBounds: swapSourcePreservingBounds,
      teardown: teardown
    };
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
  // Viewer handle — the public surface exposed to extensions through
  // `window.Fresco.viewerFor(id)`.
  // ===========================================================================

  function makeViewerHandle(controller) {
    var bus = controller.bus;
    var el = controller.el;

    function imageToScreen(pt) {
      // Image-pixel coords → page-pixel coords (matches 0.4.x convention so
      // overlay code that read OSD's viewportToWindowCoordinates keeps working
      // with minimal change).
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
      // Image-pixel rect currently visible. Semantics: a rect whose top-left
      // is the image-coord at the viewport's top-left, sized to viewport in
      // image pixels. NOTE: 0.4.x returned OSD's normalized 0–1 viewport rect;
      // 0.5.x returns image-pixel coords directly — easier to use, but a
      // breaking change. See CHANGELOG.
      var t = controller.getTransform();
      var v = controller.getViewportSize();
      return {
        x: -t.tx / t.s,
        y: -t.ty / t.s,
        width: v.vw / t.s,
        height: v.vh / t.s
      };
    }

    function fitBounds(rect /* , immediately */) {
      // Solve for (s, tx, ty) such that the given image-pixel rect fills the
      // viewport, centered. `immediately` is accepted for API compatibility
      // but ignored — 0.5.x has no animation system.
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
      swapSourcePreservingBounds: function(url) {
        controller.swapSourcePreservingBounds(url);
      },

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

      // The component server-rendered the data-sources payload as JSON.
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
