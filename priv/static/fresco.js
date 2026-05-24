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

  // Handle registry + ready-callback queue live on the shared
  // `window.Fresco` global so peer packages (currently `fresco_strip`,
  // future ones too) can register handles into the same map. Both
  // packages defensively idempotent-init the registry; whichever
  // package loads first creates it, the other piggy-backs. Without
  // this, fresco's closure-local var and fresco_strip's
  // window-scoped var would diverge and `onViewerReady("strip-id")`
  // calls would queue forever (fresco's queue) while the handle sat
  // on the other map (fresco_strip's). Fixed in 0.6.1 — 0.6.0
  // shipped with the two registries un-shared by accident.
  window.Fresco = window.Fresco || {};
  window.Fresco.viewerRegistry  = window.Fresco.viewerRegistry  || {};
  window.Fresco._readyCallbacks = window.Fresco._readyCallbacks || {};
  var viewerRegistry  = window.Fresco.viewerRegistry;
  var readyCallbacks  = window.Fresco._readyCallbacks;
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

  // `Object.assign` (not `window.Fresco = {...}`) so the public API
  // surface cooperates with whichever package loaded first. A bare
  // assignment would clobber `fresco_strip`'s defensive setup;
  // assign-onto preserves it. Methods themselves are idempotent —
  // re-installing them at module-load time is harmless.
  Object.assign(window.Fresco, {
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
  });

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
    expand:  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"/></svg>',
    // Heroicons `arrow-path-rounded-square` — quarter-turn rotation
    // affordance for the rotate nav button. Spins the content
    // clockwise 90° per click; the icon's CW arrow matches.
    rotate:  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 0 0-3.7-3.7 48.678 48.678 0 0 0-7.324 0 4.006 4.006 0 0 0-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 0 0 3.7 3.7 48.656 48.656 0 0 0 7.324 0 4.006 4.006 0 0 0 3.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3-3 3"/></svg>'
  };

  // Snap any rotation input to the nearest multiple of 90 and
  // normalize to [0, 360). Used everywhere rotation is accepted as
  // input; keeps the engine's `rot` state in a closed set of
  // {0, 90, 180, 270} so the trig math is exact (no float drift)
  // and the CSS transform string never carries a fractional angle.
  function normalizeRotation(deg) {
    if (typeof deg !== "number" || !isFinite(deg)) return 0;
    var snapped = Math.round(deg / 90) * 90;
    return ((snapped % 360) + 360) % 360;
  }

  // Exact cosine + sine for the four snapped rotations. Avoids
  // running `Math.cos`/`Math.sin` per coordinate transform and
  // guarantees the 90° / 270° cases produce a clean 0 (rather than
  // ~6e-17, which compounds over many transforms).
  function rotationCosSin(rot) {
    switch (rot) {
      case 0:   return { c:  1, sn:  0 };
      case 90:  return { c:  0, sn:  1 };
      case 180: return { c: -1, sn:  0 };
      case 270: return { c:  0, sn: -1 };
    }
    var r = rot * Math.PI / 180;
    return { c: Math.cos(r), sn: Math.sin(r) };
  }

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
      // Hide the image until the engine has run the first fit. Without this,
      // a high-resolution image (e.g. 30000×20000) renders at its natural
      // CSS pixel size during the gap between the img element appearing in
      // the DOM and the engine reading naturalWidth + calling applyChildren.
      // The viewer's `overflow: hidden` clips everything outside the
      // viewport — the user sees just the top-left chunk and can't pan to
      // the rest (clampPan has nothing to clamp against until iw/ih are
      // set). Toggling visibility via this class keeps the layout stable
      // (img still participates in stage sizing) while keeping the natural-
      // size flash invisible.
      ".fresco-viewer:not(.fresco--ready) .fresco-stage img {",
      "  visibility: hidden;",
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

      // Strip-host CSS lives in the separate `fresco_strip` package as
      // of fresco 0.6.0. Consumers using `<FrescoStrip.viewer>` import
      // `fresco_strip/priv/static/fresco_strip.js`, which injects its
      // own `.fresco-strip-*` rules on first hook mount.
      ""
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
  // View tracker — emits "view-focus" / "view-blur" events on the bus when
  // the dominant image on the host changes (or visibility flips). Shared
  // between <Fresco.canvas> (overlap-ratio dominance) and
  // <Fresco.scroll_strip> (existing currentImageIdx). The host supplies
  // `getDominantImageId() → string | null` and calls `tick()` when the
  // viewport changes; the tracker handles the settleMs gate, the focused-
  // state machine, the Page Visibility pause, and the event emits.
  //
  // Default off — callers explicitly invoke `enable(opts)` to start. Until
  // then the helper sits idle and emits nothing.
  // ===========================================================================

  function createViewTracker(opts) {
    var bus = opts.bus;
    var getDominantImageId = opts.getDominantImageId;
    var settleMs = (typeof opts.defaultSettleMs === "number") ? opts.defaultSettleMs : 150;
    var threshold = (typeof opts.defaultThreshold === "number") ? opts.defaultThreshold : 0.5;

    var enabled = false;
    var focusedImageId = null;
    var focusedAtMs = 0;
    var candidateImageId = null;
    var candidateSince = 0;
    var settleTimerId = null;
    var visibilityListener = null;

    function nowMs() {
      return (typeof performance !== "undefined" && performance.now)
        ? performance.now() : Date.now();
    }

    function clearSettleTimer() {
      if (settleTimerId) {
        try { clearTimeout(settleTimerId); } catch (_) {}
        settleTimerId = null;
      }
    }

    function commitChange(newId, reason) {
      var prev = focusedImageId;
      var prevAtMs = focusedAtMs;
      if (prev !== null && prev !== newId) {
        bus._emit("view-blur", {
          imageId: prev,
          durationMs: Math.max(0, nowMs() - prevAtMs),
          atMs: nowMs(),
          reason: reason || "viewport-change"
        });
      }
      if (newId !== null && newId !== prev) {
        focusedImageId = newId;
        focusedAtMs = nowMs();
        bus._emit("view-focus", {
          imageId: newId,
          previousImageId: prev,
          atMs: nowMs()
        });
      } else if (newId === null) {
        focusedImageId = null;
        focusedAtMs = 0;
      }
    }

    function tick() {
      if (!enabled) return;
      if (typeof document !== "undefined" && document.hidden) return;
      var dominant = null;
      try { dominant = getDominantImageId(threshold); } catch (_) {}
      if (dominant === candidateImageId) return;
      candidateImageId = dominant;
      candidateSince = nowMs();
      clearSettleTimer();
      if (dominant !== focusedImageId) {
        // Schedule a commit after the settle window. If the candidate
        // changes again before settle, the next tick clears this
        // timer and starts a new one.
        settleTimerId = setTimeout(function() {
          settleTimerId = null;
          if (enabled &&
              candidateImageId === dominant &&
              dominant !== focusedImageId) {
            commitChange(dominant, "viewport-change");
          }
        }, settleMs);
      }
    }

    function onVisibilityChange() {
      if (!enabled) return;
      if (typeof document !== "undefined" && document.hidden) {
        if (focusedImageId !== null) {
          commitChange(null, "page-hidden");
        }
        clearSettleTimer();
        candidateImageId = null;
        candidateSince = 0;
      } else {
        tick();
      }
    }

    function enable(o) {
      if (o && typeof o.settleMs === "number") settleMs = o.settleMs;
      if (o && typeof o.threshold === "number") threshold = o.threshold;
      if (enabled) {
        tick();
        return;
      }
      enabled = true;
      if (typeof document !== "undefined" && document.addEventListener) {
        visibilityListener = onVisibilityChange;
        document.addEventListener("visibilitychange", visibilityListener);
      }
      tick();
    }

    function disable(reason) {
      if (!enabled) return;
      if (focusedImageId !== null) {
        commitChange(null, reason || "disabled");
      }
      enabled = false;
      clearSettleTimer();
      candidateImageId = null;
      candidateSince = 0;
      if (visibilityListener && typeof document !== "undefined") {
        try {
          document.removeEventListener("visibilitychange", visibilityListener);
        } catch (_) {}
      }
      visibilityListener = null;
    }

    function getFocused() {
      if (!enabled || focusedImageId === null) return null;
      return {
        imageId: focusedImageId,
        durationSoFarMs: nowMs() - focusedAtMs,
        atMs: focusedAtMs
      };
    }

    return {
      enable: enable,
      disable: disable,
      tick: tick,
      getFocused: getFocused,
      isEnabled: function() { return enabled; }
    };
  }

  // ===========================================================================
  // Nav overlay — four buttons (fullscreen, zoom-in, zoom-out, reset). The
  // host element provides relative positioning (set in CSS), and the nav
  // attaches as a child so extensions can append more buttons via
  // `handle.appendNavButton(...)`.
  // ===========================================================================

  function buildNav(host, handlers, opts) {
    injectStyles();
    var nav = document.createElement("div");
    nav.className = "fresco-nav";
    // `opts.navButtonEnabled` is the consumer's allowlist gate. Default
    // (no gate) keeps every button — back-compat with pre-0.6 callers.
    var enabled = (opts && typeof opts.navButtonEnabled === "function")
      ? opts.navButtonEnabled
      : function() { return true; };
    if (enabled("fullscreen")) nav.appendChild(makeButton(ICONS.expand, "Toggle fullscreen", handlers.onFullscreen));
    if (enabled("zoom_in"))    nav.appendChild(makeButton(ICONS.zoomIn,  "Zoom in",  handlers.onZoomIn));
    if (enabled("zoom_out"))   nav.appendChild(makeButton(ICONS.zoomOut, "Zoom out", handlers.onZoomOut));
    if (enabled("rotate") && handlers.onRotate) {
      nav.appendChild(makeButton(ICONS.rotate, "Rotate 90°", handlers.onRotate));
    }
    if (enabled("home"))       nav.appendChild(makeButton(ICONS.reset,   "Reset view", handlers.onFit));
    host.appendChild(nav);
    return nav;
  }

  // ===========================================================================
  // Apply opt-in constraint data-attributes to a freshly-mounted engine. Reads
  // `data-zoom-floor`, `data-zoom-ceiling`, `data-pan-locked` off the host
  // element; missing/empty attrs are no-ops. Used by both mountFrescoViewer
  // and mountFrescoCanvas. Consumers can also call the engine setters at
  // runtime via the handle.
  // ===========================================================================

  // Read all 0.5.1+/0.6.0 declarative data-attrs off the host element
  // and return them as a single opts object. Used by both mount
  // functions to pre-configure the engine BEFORE it builds the nav
  // overlay (so the nav allowlist is honored on first paint, not after
  // a flash of the full button set).
  function readConstraintAttrs(el) {
    var opts = {};
    var floor = parseFloat(el.dataset.zoomFloor);
    if (!isNaN(floor) && floor > 0) opts.zoomFloor = floor;
    var ceil = parseFloat(el.dataset.zoomCeiling);
    if (!isNaN(ceil) && ceil > 0) opts.zoomCeiling = ceil;
    if (el.dataset.panLocked === "true") opts.panLocked = true;
    // `data-gestures` mirrors the `data-nav-buttons` semantics
    // — see comment above the nav-buttons branch for the "none"
    // sentinel rationale.
    if (el.dataset.gestures === "none") {
      opts.gestures = [];
    } else if (el.dataset.gestures) {
      var gs = el.dataset.gestures.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
      if (gs.length > 0) opts.gestures = gs;
    }
    // `data-nav-buttons` semantics:
    //   - attribute absent (`undefined`) → default, all buttons enabled
    //   - `"none"` → explicit hide-all (consumer passed an empty list)
    //   - CSV of names → allowlist of just those buttons
    // The "none" sentinel lets the Elixir side encode the
    // "hide-everything" intent without overloading "empty string"
    // (Phoenix sometimes drops empty data-attrs in render).
    if (el.dataset.navButtons === "none") {
      opts.navButtons = [];
    } else if (el.dataset.navButtons) {
      var bs = el.dataset.navButtons.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
      if (bs.length > 0) opts.navButtons = bs;
    }
    var initRot = parseFloat(el.dataset.initialRotation);
    if (!isNaN(initRot)) opts.rotation = initRot;
    return opts;
  }

  // Apply attrs that take effect AFTER the engine + nav are constructed
  // (runtime overrides whose values are already set inside the engine
  // via createTransformEngine opts; the post-construct call is for
  // anything that needs `requestFrame` after fit, etc.). Kept for
  // back-compat shape; currently a no-op since readConstraintAttrs
  // covers everything.
  function applyConstraintAttrs(/* el, engine */) { /* no-op */ }

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
    // 0.6.0 — opt-in initial configuration from the host's data-attrs
    // (parsed by readConstraintAttrs). All optional / undefined-safe.
    var initialZoomFloor   = opts.zoomFloor;
    var initialZoomCeiling = opts.zoomCeiling;
    var initialPanLocked   = !!opts.panLocked;
    var initialGestures    = opts.gestures;     // array or undefined
    var initialNavButtons  = opts.navButtons;   // array or undefined
    var initialRotation    = opts.rotation;     // number or undefined

    // ── State ──────────────────────────────────────────────────────────────
    var tx = 0, ty = 0, s = 1;
    // Rotation around the canvas/image origin, in degrees, snapped to
    // {0, 90, 180, 270}. Composed with translate + scale as:
    //   screen = translate(tx, ty) · rotate(rot) · scale(s) · image
    // The CSS transform on the stage mirrors that order:
    //   `translate3d(tx, ty, 0) rotate(rot deg)`.
    // Image-pixel math (imageToScreen / screenToImage / fit / clamp)
    // applies the rotation analytically — see `rotationCosSin`.
    var rot = normalizeRotation(initialRotation || 0);
    var nw = 0, nh = 0;          // natural extent (image natural for viewer; canvas dims for canvas)
    var vw = 0, vh = 0;          // viewport
    var sFit = 1, sMin = 1, sMax = 8;
    var frameRequested = false;
    var ready = false;
    var bus = createEventBus();
    var pointers = new Map();
    var gestureStart = null;

    // ── Consumer-controlled overrides (opt-in; null/false = engine defaults) ─
    // `customSMin` / `customSMax` shadow sMin / sMax in recomputeBounds.
    // `panLocked` ignores single-pointer pan (drag + arrow-key); pinch
    // still works for zoom. `customPanBounds` clamps pan to a custom rect
    // in canvas-pixel coords (overrides infiniteCanvas's no-clamp).
    // `customHome` overrides the reset-button / `0`-key behavior with a
    // consumer-supplied function. `enabledGestures` / `enabledNavButtons`
    // are allowlists for gestures and built-in nav buttons (null = all
    // enabled).
    //
    // All defaults preserve pre-0.6 behavior — consumers opt in explicitly.
    var customSMin = (typeof initialZoomFloor === "number") ? initialZoomFloor : null;
    var customSMax = (typeof initialZoomCeiling === "number") ? initialZoomCeiling : null;
    var panLocked = initialPanLocked;
    var customPanBounds = null;      // {x, y, width, height} / null
    var customHome = null;           // function / null
    // Deadline (ms since epoch) until which the next `tap` event
    // emission is swallowed. Set by `suppressNextTap(ms?)` — peer
    // libraries (Etcher, ML overlays) call it after committing a
    // gesture that would otherwise race the OS-synthesized
    // mousedown/mouseup → tap pipeline. Default window 250 ms is
    // a comfortable margin for iOS Safari's synthesized events.
    var suppressTapUntil = 0;
    var enabledGestures = Array.isArray(initialGestures) ? new Set(initialGestures) : null;
    var enabledNavButtons = Array.isArray(initialNavButtons) ? new Set(initialNavButtons) : null;

    // ── Math ───────────────────────────────────────────────────────────────
    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

    // Effective natural dims accounting for rotation. At 90° / 270°
    // the content's screen-space width and height swap, so the
    // fit-to-viewport scale must compare viewport against the
    // swapped dims — otherwise a rotated portrait image would fit
    // against its unrotated landscape and end up too small.
    function effectiveNaturalSize() {
      return (rot === 90 || rot === 270) ? { w: nh, h: nw } : { w: nw, h: nh };
    }

    // Bounding box of the canvas content in stage-local coords
    // (post-rotation + scale, pre-translate), assuming canvas is
    // (0, 0)–(nw, nh). For 90°-snapped rotations this is a swap +
    // flip, no trig at runtime.
    function rotatedContentBBox() {
      switch (rot) {
        case 0:   return { minX: 0,        minY: 0,        maxX: nw * s, maxY: nh * s };
        case 90:  return { minX: -nh * s,  minY: 0,        maxX: 0,      maxY: nw * s };
        case 180: return { minX: -nw * s,  minY: -nh * s,  maxX: 0,      maxY: 0 };
        default:  return { minX: 0,        minY: -nw * s,  maxX: nh * s, maxY: 0 }; // 270
      }
    }

    function recomputeBounds() {
      var eff = effectiveNaturalSize();
      if (eff.w > 0 && eff.h > 0 && vw > 0 && vh > 0) {
        sFit = Math.min(vw / eff.w, vh / eff.h);
      } else {
        sFit = 1;
      }
      var defaultSMin = infiniteCanvas ? sFit * 0.05 : sFit;
      sMin = (typeof customSMin === "number") ? customSMin : defaultSMin;
      // Cap on the rendered CSS size in either axis. Most browsers
      // refuse to lay out elements larger than ~32767 px (signed
      // 16-bit); we use 30000 as a safe floor across Chrome / Safari
      // / Firefox. The 0.4.x-era 8192 cap was a GPU-layer-texture
      // safety for the transform-scale engine; the width/height
      // engine in 0.5.x doesn't have that constraint, so the only
      // real ceiling is the browser's max element size.
      var MAX_RENDERED_PX = 30000;
      var renderedCap = MAX_RENDERED_PX / Math.max(nw || 1, nh || 1);
      // Default ceiling is 8× natural pixel ratio (matches OSD's
      // legacy `maxZoomPixelRatio: 8`). Take whichever of {8, renderedCap}
      // is smaller for browser safety, but never go below sFit
      // (otherwise the user can't zoom in at all).
      var defaultSMax = Math.min(8, renderedCap);
      if (defaultSMax < sFit) defaultSMax = sFit;
      sMax = (typeof customSMax === "number") ? customSMax : defaultSMax;
      if (sMax < sMin) sMax = sMin;
    }

    // Rotate + scale an unrotated canvas rect to its stage-local
    // bounding box (post-rotation, pre-translate). Used by clampPan
    // for both the canvas content rect (rotatedContentBBox) and any
    // consumer-supplied custom pan bounds — keeps the math in one
    // place regardless of which rect we're clamping against.
    function rotatedRectBBox(rect) {
      var cs = rotationCosSin(rot);
      var x1 = rect.x, y1 = rect.y;
      var x2 = rect.x + rect.width, y2 = rect.y + rect.height;
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      var pts = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
      for (var i = 0; i < 4; i++) {
        var px = pts[i][0] * s * cs.c - pts[i][1] * s * cs.sn;
        var py = pts[i][0] * s * cs.sn + pts[i][1] * s * cs.c;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
    }

    function clampPan() {
      // setPanBounds takes precedence over infiniteCanvas. The consumer is
      // explicitly opting into clamping for a custom rect; the "no clamp"
      // contract of infinite_canvas only applies when no rect is set.
      // Both branches use the same rotated-bbox math so a rotated
      // viewer still clamps to "content covers the viewport" instead
      // of clamping against the unrotated rect (which would leak the
      // background past the rotated content's edges).
      var bbox;
      if (customPanBounds) {
        bbox = rotatedRectBBox(customPanBounds);
      } else {
        if (infiniteCanvas) return;
        bbox = rotatedContentBBox();
      }
      var bw = bbox.maxX - bbox.minX;
      var bh = bbox.maxY - bbox.minY;
      if (bw >= vw) {
        tx = clamp(tx, vw - bbox.maxX, -bbox.minX);
      } else {
        tx = (vw - bw) / 2 - bbox.minX;
      }
      if (bh >= vh) {
        ty = clamp(ty, vh - bbox.maxY, -bbox.minY);
      } else {
        ty = (vh - bh) / 2 - bbox.minY;
      }
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
      // Center the rotated bbox in the viewport. For rot=0 this
      // reduces to the previous formula; for 90 / 180 / 270 the
      // bbox extents are different and we'd otherwise frame the
      // wrong rect.
      var bbox = rotatedContentBBox();
      var bw = bbox.maxX - bbox.minX;
      var bh = bbox.maxY - bbox.minY;
      tx = (vw - bw) / 2 - bbox.minX;
      ty = (vh - bh) / 2 - bbox.minY;
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
      if (panLocked) return;
      tx += dx; ty += dy;
      clampPan();
      bus._emit("pan", { tx: tx, ty: ty });
      requestFrame();
    }

    function setTransform(nextTx, nextTy, nextS, nextRot) {
      // Any direct setTransform cancels an in-flight animation —
      // it's an explicit "go here now" command, not a "glide here"
      // request. Use animateTo() if you want the animated variant.
      cancelAnimation();
      tx = nextTx; ty = nextTy;
      s = clamp(nextS, sMin, sMax);
      // Optional 4th arg — keep 3-arg callers (pre-0.5.7) on their
      // current rotation. setRotation() is the dedicated API for
      // rotation-only changes; this lets composite ops set all four
      // values atomically without re-running fit math.
      if (typeof nextRot === "number") rot = normalizeRotation(nextRot);
      clampPan();
      requestFrame();
    }

    // ── Animated transitions (opt-in via handle.fitBounds(rect, {animate})) ─
    // rAF-driven interpolation between current and target (tx, ty, s).
    // Cancellable on user gesture (pointerdown / wheel / dblclick) so
    // the in-flight glide never blocks the user's intent.
    var anim = null;

    var easings = {
      linear:      function(t) { return t; },
      "ease-out":  function(t) { return 1 - Math.pow(1 - t, 3); },
      "ease-in":   function(t) { return t * t * t; },
      "ease-in-out": function(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      }
    };

    function cancelAnimation() {
      if (anim) {
        if (anim.rafId) {
          try { window.cancelAnimationFrame(anim.rafId); } catch (_) {}
        }
        anim = null;
      }
    }

    function animateTo(targetTx, targetTy, targetS, opts) {
      opts = opts || {};
      cancelAnimation();
      var duration = (typeof opts.duration === "number" && opts.duration > 0) ? opts.duration : 200;
      var easeFn = easings[opts.easing] || easings["ease-out"];
      var startTx = tx, startTy = ty, startS = s;
      var clampedTargetS = clamp(targetS, sMin, sMax);
      var t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();

      anim = { rafId: null };

      function step() {
        if (!anim) return;
        var now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        var t = Math.min(1, (now - t0) / duration);
        var k = easeFn(t);
        tx = startTx + (targetTx - startTx) * k;
        ty = startTy + (targetTy - startTy) * k;
        s = startS + (clampedTargetS - startS) * k;
        // Don't clampPan during animation — clamp would yank an in-flight
        // glide if the target lands inside the bounds but interpolation
        // briefly steps outside.
        apply();
        if (t >= 1) {
          // Final state: apply the engine's full clamp + zoom-event so
          // the rest pos is canonical.
          tx = targetTx; ty = targetTy; s = clampedTargetS;
          clampPan();
          apply();
          bus._emit("zoom", { scale: s });
          anim = null;
          return;
        }
        anim.rafId = window.requestAnimationFrame(step);
      }
      anim.rafId = window.requestAnimationFrame(step);
    }

    function apply() {
      applyChildren(s);
      // `translate3d(tx, ty, 0) rotate(rot deg)` — CSS reads right-
      // to-left, so rotate happens first (around the stage's own
      // 0,0 origin) then translate moves the rotated content into
      // place. Matches the image-pixel math in `rotatedContentBBox`
      // / `imageToScreen`.
      stage.style.transform =
        "translate3d(" + tx + "px, " + ty + "px, 0) rotate(" + rot + "deg)";
      bus._emit("animation", { tx: tx, ty: ty, scale: s, rotation: rot });
      bus._emit("update-viewport", { tx: tx, ty: ty, scale: s, rotation: rot });
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
          x: pts[0].x, y: pts[0].y,
          // `moved` flips true on the first pointermove beyond a 5px
          // threshold. Used to decide whether pointerup fires a "tap"
          // event (no movement) or just ends the pan gesture.
          moved: false,
          // Last-known client coords so onPointerUp can emit the tap
          // location even after release.
          lastClientX: pts[0].x,
          lastClientY: pts[0].y,
          // pointerType for the eventual tap payload.
          pointerType: "mouse"
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
      cancelAnimation();
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.classList.add("fresco--dragging");
      snapshotGesture();
      // Stash pointerType on the gesture snapshot so tap can report it.
      if (gestureStart && gestureStart.kind === "pan") {
        gestureStart.pointerType = e.pointerType || "mouse";
      }
    }

    function onPointerMove(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gestureStart) return;

      if (gestureStart.kind === "pan") {
        // Track tap-vs-drag: any movement past 5px disqualifies the
        // upcoming pointerup from firing a "tap" event.
        if (!gestureStart.moved) {
          var ddx = e.clientX - gestureStart.x;
          var ddy = e.clientY - gestureStart.y;
          if (ddx * ddx + ddy * ddy > 25) gestureStart.moved = true;
        }
        gestureStart.lastClientX = e.clientX;
        gestureStart.lastClientY = e.clientY;
        // panLocked suppresses single-pointer drag entirely. Two-pointer
        // pinch (handled below) still works for zoom. setZoomFloor /
        // setZoomCeiling are honored implicitly via zoomAt's clamp.
        if (panLocked) return;
        if (!gestureEnabled("pan")) return;
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
        if (!gestureEnabled("pinch")) return;
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
      // Capture tap snapshot before mutating pointer state. Tap fires
      // only when the gesture was single-pointer and stayed below the
      // 5px movement threshold throughout. Touch and pen taps also
      // qualify — useful for swipe-paged readers that need tap-to-turn
      // semantics without re-rolling drag-vs-tap detection.
      var tapCandidate = (
        pointers.size === 1 &&
        gestureStart && gestureStart.kind === "pan" && !gestureStart.moved
      ) ? gestureStart : null;

      pointers.delete(e.pointerId);
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      if (pointers.size >= 1) {
        snapshotGesture();
        return;
      }
      gestureStart = null;
      el.classList.remove("fresco--dragging");

      if (tapCandidate && e.type !== "pointercancel") {
        var rect = viewportRect();
        var localX = tapCandidate.lastClientX - rect.left;
        var localY = tapCandidate.lastClientY - rect.top;
        // Two suppression paths — either lets a consumer or peer
        // library (Etcher annotations, custom overlays) opt out of
        // the tap emit without forking fresco:
        //
        //   1. `suppressNextTap(ms?)` deadline. Useful when the
        //      caller knows it just emitted a synthetic gesture
        //      and wants to swallow the iOS-synthesized mousedown/
        //      mouseup that follows.
        //
        //   2. `[data-fresco-suppress-tap]` on any element under
        //      the tap point. Useful for static surfaces — Etcher
        //      stamps it on every `.etcher-shape` so tapping a
        //      pinned annotation never bubbles to the consumer's
        //      tap-zone navigation. `pointer-events: none` on the
        //      shape would have hidden it from us; the data attr
        //      lets us see it via `elementsFromPoint` regardless.
        var now = Date.now();
        if (suppressTapUntil > now) {
          return;
        }
        try {
          if (typeof document.elementsFromPoint === "function") {
            var hits = document.elementsFromPoint(
              tapCandidate.lastClientX, tapCandidate.lastClientY
            );
            for (var hi = 0; hi < hits.length; hi++) {
              var h = hits[hi];
              if (h && h.closest && h.closest("[data-fresco-suppress-tap]")) {
                return;
              }
            }
          }
        } catch (_) { /* defensive — never let probe errors swallow the tap */ }
        bus._emit("tap", {
          x: localX,
          y: localY,
          imageX: (localX - tx) / s,
          imageY: (localY - ty) / s,
          pointerType: tapCandidate.pointerType || e.pointerType || "mouse"
        });
      }
    }

    function onDragStart(e) { e.preventDefault(); }

    function onWheel(e) {
      if (isFromNav(e)) return;
      if (!gestureEnabled("wheel")) return;
      cancelAnimation();
      e.preventDefault();
      var rect = viewportRect();
      var px = e.clientX - rect.left;
      var py = e.clientY - rect.top;
      var k = Math.exp(-e.deltaY * 0.0015);
      zoomAt(px, py, k);
    }

    function onDblClick(e) {
      if (isFromNav(e)) return;
      if (!gestureEnabled("double_click")) return;
      cancelAnimation();
      var rect = viewportRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, 2);
    }

    function onKeyDown(e) {
      var t = e.target;
      if (t && t !== el && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (!gestureEnabled("keyboard")) return;
      var handled = true;
      switch (e.key) {
        case "ArrowUp":    panBy(0, 60);  break;
        case "ArrowDown":  panBy(0, -60); break;
        case "ArrowLeft":  panBy(60, 0);  break;
        case "ArrowRight": panBy(-60, 0); break;
        case "+": case "=": zoomAt(vw / 2, vh / 2, 1.4); break;
        case "-": case "_": zoomAt(vw / 2, vh / 2, 1 / 1.4); break;
        case "0": requestHome(); break;
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

    // Convenience zoom helpers that mirror the nav buttons' behavior
    // exactly — same step factor (1.4×), same anchor (viewport
    // center). Consumers wiring custom toolbars / keyboard shortcuts
    // / accessibility affordances call these instead of replicating
    // the math against `zoomAt` and `viewportRect`.
    function zoomIn(factor) {
      var rect = viewportRect();
      vw = rect.width; vh = rect.height;
      zoomAt(vw / 2, vh / 2, factor || 1.4);
    }
    function zoomOut(factor) {
      var rect = viewportRect();
      vw = rect.width; vh = rect.height;
      zoomAt(vw / 2, vh / 2, 1 / (factor || 1.4));
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
      onFit: function() { requestHome(); },
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
      onRotate: function() { rotateBy(90); },
      onFullscreen: toggleFullscreen
    }, {
      navButtonEnabled: function(name) { return navButtonEnabled(name); }
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

    // Override the engine's sMin (the zoom-out floor). Pass a positive
    // number to set; pass null/undefined/0 to revert to the engine
    // default (sFit for clamped mode, sFit*0.05 for infinite_canvas).
    // The new floor applies to all subsequent zoom paths (wheel, pinch,
    // double-click, fitBounds via setTransform) — consumers can't
    // accidentally bypass their own floor.
    function setZoomFloor(v) {
      customSMin = (typeof v === "number" && v > 0) ? v : null;
      recomputeBounds();
      if (s < sMin) {
        s = sMin;
        clampPan();
        bus._emit("zoom", { scale: s });
        requestFrame();
      }
    }

    // Symmetric ceiling override. Same semantics as setZoomFloor.
    function setZoomCeiling(v) {
      customSMax = (typeof v === "number" && v > 0) ? v : null;
      recomputeBounds();
      if (s > sMax) {
        s = sMax;
        clampPan();
        bus._emit("zoom", { scale: s });
        requestFrame();
      }
    }

    // When locked: panBy + single-pointer drag are no-ops; two-pointer
    // pinch still works for zoom. Consumers toggle this in response to
    // scale changes (e.g. paged readers lock pan at fit, unlock when
    // zoomed in).
    function setPanLocked(b) { panLocked = !!b; }

    // Clamp pan to a custom rect (canvas-pixel coords). Overrides
    // infinite_canvas's no-clamp contract. Pass null to revert.
    // Triggers an immediate re-clamp + frame so the new constraint
    // applies on the next paint.
    function setPanBounds(rect) {
      customPanBounds = (rect && typeof rect.x === "number" &&
                                  typeof rect.y === "number" &&
                                  typeof rect.width === "number" &&
                                  typeof rect.height === "number") ? rect : null;
      clampPan();
      requestFrame();
    }

    // Override the "home" action (nav reset button + `0` key). The
    // engine's fit() primitive is unaffected; only the user-triggered
    // home affordances route through the override when set. Pass null
    // to revert.
    function setHomeAction(fn) {
      customHome = (typeof fn === "function") ? fn : null;
    }

    // Swallow every `tap` event for the next `ms` (default 250).
    // Useful for peer libraries that just emitted a gesture which
    // will be followed by an OS-synthesized tap they want to
    // suppress (mobile Safari fires synthesized mousedown/mouseup
    // after touchend; the resulting tap would race the library's
    // own state mutations). Calls are additive — re-calling
    // extends the deadline to the later of the two.
    function suppressNextTap(ms) {
      var window = (typeof ms === "number" && ms > 0) ? ms : 250;
      var deadline = Date.now() + window;
      if (deadline > suppressTapUntil) suppressTapUntil = deadline;
    }

    // Snap any input to {0, 90, 180, 270}. Re-homes so the new
    // rotation lands on a centered, on-screen view (otherwise a 90°
    // rotation at the previous tx/ty would push the content off the
    // side, since the content's rotated bbox is shaped differently).
    // Fires `rotate` once on actual changes — no-op when the snapped
    // input equals the current rotation.
    //
    // The re-home routes through `requestHome()` instead of bare
    // `fit()` so any `customHome` set via `setHomeAction` runs too —
    // a paged manga reader that fits the current page on reset
    // should re-fit the current page after rotating, not the whole
    // multi-image canvas. Consumers without a customHome get the
    // engine's default fit (`fit()`).
    function setRotation(deg) {
      var next = normalizeRotation(deg);
      if (next === rot) return;
      var previous = rot;
      rot = next;
      requestHome();
      bus._emit("rotate", { rotation: rot, previous: previous });
    }

    function getRotation() { return rot; }

    // Convenience for "rotate by N degrees" toggle buttons. The
    // delta is added to the current rotation, then snapped + normalized
    // by `setRotation`.
    function rotateBy(delta) { setRotation(rot + (delta || 0)); }

    function requestHome() {
      if (customHome) {
        try { customHome(); } catch (e) {
          if (typeof console !== "undefined" && console.error) {
            console.error("[Fresco] customHome threw:", e);
          }
        }
      } else {
        fit();
      }
    }

    // Allowlists. Passing an array of strings limits which gestures
    // and nav buttons are enabled. null = all enabled (default).
    function setEnabledGestures(arr) {
      enabledGestures = Array.isArray(arr) ? new Set(arr) : null;
    }
    function setEnabledNavButtons(arr) {
      enabledNavButtons = Array.isArray(arr) ? new Set(arr) : null;
    }
    function gestureEnabled(name) {
      return enabledGestures == null || enabledGestures.has(name);
    }
    function navButtonEnabled(name) {
      return enabledNavButtons == null || enabledNavButtons.has(name);
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
      getTransform: function() {
        return { tx: tx, ty: ty, s: s, rotation: rot };
      },
      getViewportSize: function() { return { vw: vw, vh: vh }; },
      getNaturalSize: function() { return { w: nw, h: nh }; },
      isInfiniteCanvas: function() { return infiniteCanvas; },
      isReady: function() { return ready; },
      setReady: function(b) { ready = b; },
      setZoomFloor: setZoomFloor,
      setZoomCeiling: setZoomCeiling,
      setPanLocked: setPanLocked,
      setPanBounds: setPanBounds,
      setHomeAction: setHomeAction,
      suppressNextTap: suppressNextTap,
      setRotation: setRotation,
      getRotation: getRotation,
      rotateBy: rotateBy,
      // Programmatic equivalents of the built-in nav buttons so a
      // consumer hiding the chrome can still wire their own buttons,
      // keyboard shortcuts, or accessibility affordances to the same
      // behavior. Identical step factors + anchors as the built-in
      // buttons (1.4× / 1/1.4× zoom around viewport center;
      // requestHome flows through any active `customHome`).
      zoomIn: zoomIn,
      zoomOut: zoomOut,
      toggleFullscreen: toggleFullscreen,
      requestHome: requestHome,
      setEnabledGestures: setEnabledGestures,
      setEnabledNavButtons: setEnabledNavButtons,
      gestureEnabled: gestureEnabled,
      navButtonEnabled: navButtonEnabled,
      animateTo: animateTo,
      cancelAnimation: cancelAnimation,
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

    var attrOpts = readConstraintAttrs(el);
    var engine = createTransformEngine({
      el: el,
      stage: stage,
      infiniteCanvas: infiniteCanvas,
      zoomFloor: attrOpts.zoomFloor,
      zoomCeiling: attrOpts.zoomCeiling,
      panLocked: attrOpts.panLocked,
      gestures: attrOpts.gestures,
      navButtons: attrOpts.navButtons,
      rotation: attrOpts.rotation,
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

    function markReady() {
      // CSS rule `.fresco-viewer:not(.fresco--ready) .fresco-stage img`
      // hides the img until this class is on the host. Without it, a
      // high-res image renders at natural size in the DOM (clipped to
      // top-left by `overflow: hidden`) during the load window — the
      // user sees a chunk of the natural image and can't pan to the
      // rest. The class flips on the first successful fit or on error.
      el.classList.add("fresco--ready");
    }

    function doFit() {
      engine.fit();
      engine.setReady(true);
      markReady();
      engine.bus._emit("open", {
        src: currentSrc,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
      });
      // Kick off decode() AFTER fitting. The old code waited on decode
      // before fitting, which for huge images (multi-second decode)
      // left the image visible at natural size in the meantime. We
      // need the natural dimensions, not the decoded bitmap, to fit.
      // The browser will GPU-upload the bitmap asynchronously; the
      // worst case is a brief blur on the first frame.
      if (typeof img.decode === "function") {
        try { img.decode().catch(function() {}); } catch (_) {}
      }
    }

    function initEngineFromImg() { doFit(); }
    function onImgLoad() { initEngineFromImg(); }

    function onImgError() {
      // Image failed to load. Mark the engine ready anyway so the UI
      // is responsive — the host will show whatever the browser
      // renders for a broken image (usually a placeholder icon). A
      // bus "error" event lets consumers surface a friendlier
      // message of their own.
      engine.setReady(true);
      markReady();
      engine.bus._emit("error", { src: currentSrc });
    }

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
      el.classList.remove("fresco--ready");
      img.addEventListener("load", onImgLoad, { once: true });
      img.addEventListener("error", onImgError, { once: true });
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
        markReady();
        engine.bus._emit("open", {
          src: currentSrc,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight
        });
      }, { once: true });
      img.src = resolved.url;
    }

    // Init as soon as natural dimensions are available (which is
    // typically the moment the header bytes are decoded, well before
    // the full image is loaded). This avoids the long "top-left
    // clipped chunk" window for high-res images. If naturalWidth
    // isn't there yet, wait on `load` / `error`.
    if (img.naturalWidth > 0) {
      initEngineFromImg();
      // Re-run on load as well, in case naturalWidth wasn't final
      // when we ran the first fit (rare but possible for streaming
      // image formats).
      if (!img.complete) {
        img.addEventListener("load", onImgLoad, { once: true });
      }
    } else {
      img.addEventListener("load", onImgLoad, { once: true });
      img.addEventListener("error", onImgError, { once: true });
    }

    // Apply opt-in zoom/pan constraint attrs (data-zoom-floor /
    // data-zoom-ceiling / data-pan-locked from the Phoenix component).
    // No-op when absent so existing consumers see identical behavior.
    applyConstraintAttrs(el, engine);

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
      setZoomFloor: engine.setZoomFloor,
      setZoomCeiling: engine.setZoomCeiling,
      setPanLocked: engine.setPanLocked,
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

    // image-pixel → screen-pixel under composite transform
    //   screen = rect.{left,top} + translate(tx, ty) · rotate(rot) · scale(s) · image
    // For 90°-snapped rotations the cos/sin pair is exact (see
    // `rotationCosSin`) so the formula reduces to swaps + negations
    // — no trig at the hot path.
    function imageToScreen(pt) {
      var t = controller.getTransform();
      var rect = el.getBoundingClientRect();
      var cs = rotationCosSin(t.rotation || 0);
      var px = (pt.x || 0) * t.s;
      var py = (pt.y || 0) * t.s;
      return {
        x: rect.left + t.tx + px * cs.c - py * cs.sn,
        y: rect.top  + t.ty + px * cs.sn + py * cs.c
      };
    }

    // Inverse of imageToScreen — subtract translate, apply inverse
    // rotation (transpose of the rotation matrix), then divide by
    // scale to get image-pixel coords.
    function screenToImage(pt) {
      var t = controller.getTransform();
      var rect = el.getBoundingClientRect();
      var cs = rotationCosSin(t.rotation || 0);
      var dx = (pt.x || 0) - rect.left - t.tx;
      var dy = (pt.y || 0) - rect.top  - t.ty;
      return {
        x: ( dx * cs.c + dy * cs.sn) / t.s,
        y: (-dx * cs.sn + dy * cs.c) / t.s
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

    function fitBounds(rect, opts) {
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      var v = controller.getViewportSize();
      var t = controller.getTransform();
      var rot = t.rotation || 0;
      // The rect is in unrotated canvas-px (the consumer's natural
      // frame of reference). After rotation, its screen-space bbox
      // has different dims — for 90° / 270° the width and height
      // swap. Compute newS against the rotated bbox so the rotated
      // content actually fits the viewport.
      var fitW = (rot === 90 || rot === 270) ? rect.height : rect.width;
      var fitH = (rot === 90 || rot === 270) ? rect.width  : rect.height;
      var newS = Math.min(v.vw / fitW, v.vh / fitH);
      // Compute the rotated + scaled bbox of `rect` in stage-local
      // coords (pre-translate). The same math as `rotatedRectBBox`
      // but inlined since the engine's helper isn't exposed.
      var cs = rotationCosSin(rot);
      var x1 = rect.x, y1 = rect.y;
      var x2 = rect.x + rect.width, y2 = rect.y + rect.height;
      var pts = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var i = 0; i < 4; i++) {
        var px = pts[i][0] * newS * cs.c - pts[i][1] * newS * cs.sn;
        var py = pts[i][0] * newS * cs.sn + pts[i][1] * newS * cs.c;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      // Center the rotated bbox in the viewport.
      var newTx = (v.vw - (maxX - minX)) / 2 - minX;
      var newTy = (v.vh - (maxY - minY)) / 2 - minY;
      if (opts && opts.animate) {
        controller.animateTo(newTx, newTy, newS, {
          duration: opts.duration,
          easing: opts.easing
        });
      } else {
        controller.setTransform(newTx, newTy, newS);
      }
    }

    return {
      container: el,
      imageToScreen: imageToScreen,
      screenToImage: screenToImage,
      getViewportBounds: getViewportBounds,
      fitBounds: fitBounds,
      setSource: function(url) { controller.setSource(url); },
      swapSourcePreservingBounds: function(url) { controller.swapSourcePreservingBounds(url); },
      // Opt-in zoom + pan constraint controls (0.5.1+). All three are
      // no-ops at their defaults (null / null / false), so existing
      // consumers see identical behavior unless they call these. See
      // the engine's setZoomFloor / setZoomCeiling / setPanLocked
      // docstrings for semantics.
      setZoomFloor:   function(v) { controller.setZoomFloor(v); },
      setZoomCeiling: function(v) { controller.setZoomCeiling(v); },
      setPanLocked:   function(b) { controller.setPanLocked(b); },
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

    // Set of image ids the consumer has explicitly hidden via
    // setImageVisible(id, false). Hidden imgs are still in `imgs` and
    // still participate in layout / pan-bounds math; applyChildren just
    // sets visibility:hidden on them and skips position writes (cheap
    // optimization).
    var hiddenImageIds = new Set();

    // Memory windowing — 0/null disables. When > 0, the engine evicts
    // src for images whose canvas-pixel rect is more than `memoryWindow`
    // viewport-widths/heights away from the current viewport. Frame
    // counter throttles the recomputation to once every 8 animation
    // frames so pan doesn't tank.
    var memoryWindow = 0;
    var memoryFrameCounter = 0;

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

    var canvasAttrOpts = readConstraintAttrs(el);
    var engine = createTransformEngine({
      el: el,
      stage: stage,
      infiniteCanvas: infiniteCanvas,
      zoomFloor: canvasAttrOpts.zoomFloor,
      zoomCeiling: canvasAttrOpts.zoomCeiling,
      panLocked: canvasAttrOpts.panLocked,
      gestures: canvasAttrOpts.gestures,
      navButtons: canvasAttrOpts.navButtons,
      rotation: canvasAttrOpts.rotation,
      getNaturalSize: function() { return { w: canvasW, h: canvasH }; },
      applyChildren: function(s) {
        for (var i = 0; i < imgs.length; i++) {
          var im = imgs[i];
          var hidden = hiddenImageIds.has(im.dataset.imageId);
          if (hidden) {
            im.style.visibility = "hidden";
            continue;
          }
          if (im.style.visibility === "hidden") im.style.visibility = "";
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
    //
    // 0.6.0 — `:initial_fit_image_id` / `:initial_fit_bounds` data-attrs
    // override the canvas-wide fit at first paint. image-id wins if both
    // present. If image-id doesn't match any image, console.warn and
    // fall back to the canvas-wide fit.
    function initialFit() {
      var initialImageId = el.dataset.initialFitImageId || null;
      var initialBoundsJson = el.dataset.initialFitBounds || null;
      var initialBounds = null;
      if (initialBoundsJson) {
        try {
          initialBounds = JSON.parse(initialBoundsJson);
        } catch (_) {
          console.warn("[Fresco] data-initial-fit-bounds is not valid JSON; falling back to canvas fit");
        }
      }
      var fitDone = false;
      if (initialImageId) {
        var b = imageBoundsFor(initialImageId);
        if (b) {
          // Manual fitBounds (we can't call the handle method yet — handle
          // is constructed after this function).
          var v = engine.getViewportSize();
          var newS = Math.min(v.vw / b.width, v.vh / b.height);
          var newTx = (v.vw - newS * b.width) / 2 - newS * b.x;
          var newTy = (v.vh - newS * b.height) / 2 - newS * b.y;
          engine.setTransform(newTx, newTy, newS);
          fitDone = true;
        } else {
          console.warn(
            "[Fresco] data-initial-fit-image-id=\"" + initialImageId +
            "\" doesn't match any image; falling back to canvas fit"
          );
        }
      }
      if (!fitDone && initialBounds && typeof initialBounds.x === "number" &&
          typeof initialBounds.y === "number" &&
          typeof initialBounds.width === "number" &&
          typeof initialBounds.height === "number" &&
          initialBounds.width > 0 && initialBounds.height > 0) {
        var v2 = engine.getViewportSize();
        var newS2 = Math.min(v2.vw / initialBounds.width, v2.vh / initialBounds.height);
        var newTx2 = (v2.vw - newS2 * initialBounds.width) / 2 - newS2 * initialBounds.x;
        var newTy2 = (v2.vh - newS2 * initialBounds.height) / 2 - newS2 * initialBounds.y;
        engine.setTransform(newTx2, newTy2, newS2);
        fitDone = true;
      }
      if (!fitDone) engine.fit();
      engine.setReady(true);
      // CSS rule `.fresco-viewer:not(.fresco--ready) .fresco-stage img`
      // hides the imgs until first fit. Canvas knows dims at mount so
      // we apply the class right after initialFit — no flash window.
      el.classList.add("fresco--ready");
      engine.bus._emit("open", {
        canvasWidth: canvasW,
        canvasHeight: canvasH,
        imageCount: imgs.length
      });
    }
    initialFit();

    // 0.5.x leftover — runtime overrides applied after the initial fit so
    // the floor / lock take effect immediately. Currently a no-op (the
    // engine reads everything from opts at construction now); kept as a
    // safe extension point for future post-construct attrs.
    applyConstraintAttrs(el, engine);

    // 0.6.0 — auto-evict src for images far from the viewport. The attr
    // reading is here (not in readConstraintAttrs) because memory
    // windowing is canvas-only and depends on the canvas handle's
    // imgRect helper.
    var mw = parseInt(el.dataset.memoryWindow || "0", 10);
    if (!isNaN(mw) && mw > 0) {
      memoryWindow = mw;
      recomputeMemoryWindow();
    }

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

    // Toggle individual image visibility without removing it from the
    // layout (so pan-bounds, annotations, fit math stay anchored).
    // Emits `image-visibility-change` on the bus so extensions
    // (Etcher, ML overlays, comment threads) that pin DOM siblings
    // to a specific image can hide them in lockstep.
    function setImageVisible(id, visible) {
      var was = hiddenImageIds.has(id);
      if (visible) hiddenImageIds.delete(id);
      else hiddenImageIds.add(id);
      var now = hiddenImageIds.has(id);
      if (was !== now) {
        engine.bus._emit("image-visibility-change", {
          imageId: id,
          visible: visible
        });
      }
      engine.requestFrame();
    }

    // Snapshot of the currently-hidden image ids. Used by extensions
    // mounting after the host has already called `setImageVisible(...,
    // false)` — the `image-visibility-change` event is fire-and-forget,
    // so a late mounter needs a pull-API to seed its initial state.
    function getHiddenImageIds() {
      return Array.from(hiddenImageIds);
    }

    // Memory windowing. recomputeWindow() inflates the current viewport
    // rect (in canvas coords) by `memoryWindow` viewport sizes, then
    // evicts images outside that rect and restores those inside.
    function rectsIntersect(a, b) {
      return !(a.x + a.width <= b.x || b.x + b.width <= a.x ||
               a.y + a.height <= b.y || b.y + b.height <= a.y);
    }

    function recomputeMemoryWindow() {
      if (!memoryWindow || memoryWindow <= 0) return;
      var t = engine.getTransform();
      var v = engine.getViewportSize();
      if (t.s <= 0) return;
      // Viewport rect in canvas-pixel coords (same as getViewportBounds).
      var vp = {
        x: -t.tx / t.s,
        y: -t.ty / t.s,
        width: v.vw / t.s,
        height: v.vh / t.s
      };
      // Inflate by N viewport sizes.
      var padX = vp.width * memoryWindow;
      var padY = vp.height * memoryWindow;
      var window = {
        x: vp.x - padX,
        y: vp.y - padY,
        width: vp.width + 2 * padX,
        height: vp.height + 2 * padY
      };
      for (var i = 0; i < imgs.length; i++) {
        var im = imgs[i];
        var r = imgRect(im);
        var inside = rectsIntersect(window, r);
        if (inside) {
          // Restore if previously evicted.
          if (!im.getAttribute("src") && im.dataset.frescoSrc) {
            im.setAttribute("src", im.dataset.frescoSrc);
            engine.bus._emit("image-restored", { imageId: im.dataset.imageId });
          }
        } else {
          // Evict. Stash src into data-fresco-src.
          var src = im.getAttribute("src");
          if (src) {
            im.dataset.frescoSrc = src;
            im.removeAttribute("src");
            engine.bus._emit("image-evicted", { imageId: im.dataset.imageId });
          }
        }
      }
    }

    function setMemoryWindow(n) {
      memoryWindow = (typeof n === "number" && n > 0) ? n : 0;
      memoryFrameCounter = 0;
      recomputeMemoryWindow();
    }

    // Throttle: recompute every 8 animation frames (not every frame).
    // Also recompute on resize. Hooked here so it's automatic once
    // setMemoryWindow has been called.
    engine.bus.on("animation", function() {
      if (!memoryWindow || memoryWindow <= 0) return;
      if ((++memoryFrameCounter & 7) === 0) recomputeMemoryWindow();
    });
    engine.bus.on("resize", function() {
      if (memoryWindow && memoryWindow > 0) recomputeMemoryWindow();
    });

    // ── View tracker — dominant image + focus/blur events ───────────────
    // Computes the "focused" image as the one with the highest overlap
    // ratio between its canvas-pixel rect and the current viewport rect.
    // Honors `hiddenImageIds` (hidden imgs are never dominant). The
    // tracker handles settle-time gating, page-visibility pause, and
    // event emission — see createViewTracker for the state machine.
    function computeViewportRectInCanvas() {
      var t = engine.getTransform();
      var v = engine.getViewportSize();
      if (t.s <= 0) return null;
      return {
        x: -t.tx / t.s,
        y: -t.ty / t.s,
        width: v.vw / t.s,
        height: v.vh / t.s
      };
    }

    function computeDominantCanvasImage(threshold) {
      var vp = computeViewportRectInCanvas();
      if (!vp) return null;
      var bestId = null;
      var bestRatio = 0;
      for (var i = 0; i < imgs.length; i++) {
        var im = imgs[i];
        var id = im.dataset.imageId;
        if (!id) continue;
        if (hiddenImageIds.has(id)) continue;
        var r = imgRect(im);
        if (r.width <= 0 || r.height <= 0) continue;
        var ox  = Math.max(vp.x, r.x);
        var oy  = Math.max(vp.y, r.y);
        var ox2 = Math.min(vp.x + vp.width,  r.x + r.width);
        var oy2 = Math.min(vp.y + vp.height, r.y + r.height);
        if (ox2 <= ox || oy2 <= oy) continue;
        var ratio = ((ox2 - ox) * (oy2 - oy)) / (r.width * r.height);
        if (ratio < threshold) continue;
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestId = id;
        }
      }
      return bestId;
    }

    var viewTracker = createViewTracker({
      bus: engine.bus,
      getDominantImageId: computeDominantCanvasImage
    });

    // Drive the tracker off the engine's per-frame animation event.
    // tick() is cheap (one rect intersection per image); the settleMs
    // gate inside the tracker handles pan-throughs.
    engine.bus.on("animation", function() {
      if (viewTracker.isEnabled()) viewTracker.tick();
    });

    // Honor declarative `data-view-tracking` / `-settle-ms` / `-threshold`
    // attrs at mount. Default off.
    if (el.dataset.viewTracking === "true") {
      var trackOpts = {};
      var sm = parseInt(el.dataset.viewSettleMs || "", 10);
      if (!isNaN(sm) && sm >= 0) trackOpts.settleMs = sm;
      var th = parseFloat(el.dataset.viewThreshold || "");
      if (!isNaN(th) && th > 0 && th <= 1) trackOpts.threshold = th;
      viewTracker.enable(trackOpts);
    }

    // Tear down on the canvas's destroyed lifecycle — flush a final
    // view-blur with reason "destroyed" so consumers can persist a
    // pending duration. Wrap engine.teardown so consumers don't have
    // to remember a second cleanup call.
    var originalTeardown = engine.teardown;
    var teardownWithTracker = function() {
      if (viewTracker.isEnabled()) viewTracker.disable("destroyed");
      originalTeardown();
    };

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
      setZoomFloor: engine.setZoomFloor,
      setZoomCeiling: engine.setZoomCeiling,
      setPanLocked: engine.setPanLocked,
      setPanBounds: engine.setPanBounds,
      setHomeAction: engine.setHomeAction,
      suppressNextTap: engine.suppressNextTap,
      // 0.5.7+ rotation API. Without these re-exports, the canvas
      // handle's `handle.setRotation(...)` proxy at the next layer
      // up throws `TypeError: controller.setRotation is not a function`
      // even though the engine has the method.
      setRotation: engine.setRotation,
      getRotation: engine.getRotation,
      rotateBy: engine.rotateBy,
      // 0.5.7+ programmatic nav-button equivalents. Same leak
      // pattern — the engine has them, the handle proxies through,
      // the controller layer in between had to re-export.
      zoomIn: engine.zoomIn,
      zoomOut: engine.zoomOut,
      toggleFullscreen: engine.toggleFullscreen,
      requestHome: engine.requestHome,
      setImageVisible: setImageVisible,
      getHiddenImageIds: getHiddenImageIds,
      setMemoryWindow: setMemoryWindow,
      enableViewTracking: function(o) { viewTracker.enable(o || {}); },
      disableViewTracking: function() { viewTracker.disable("disabled"); },
      getFocusedImage: function() { return viewTracker.getFocused(); },
      refreshLayout: refreshLayout,
      teardown: teardownWithTracker
    };
  }

  // ===========================================================================
  // Canvas handle — public surface via window.Fresco.viewerFor(id) /
  // window.Fresco.onReady(id, cb).
  // ===========================================================================

  function makeCanvasHandle(controller) {
    var bus = controller.bus;
    var el = controller.el;

    // image-pixel → screen-pixel under composite transform
    //   screen = rect.{left,top} + translate(tx, ty) · rotate(rot) · scale(s) · image
    // For 90°-snapped rotations the cos/sin pair is exact (see
    // `rotationCosSin`) so the formula reduces to swaps + negations
    // — no trig at the hot path.
    function imageToScreen(pt) {
      var t = controller.getTransform();
      var rect = el.getBoundingClientRect();
      var cs = rotationCosSin(t.rotation || 0);
      var px = (pt.x || 0) * t.s;
      var py = (pt.y || 0) * t.s;
      return {
        x: rect.left + t.tx + px * cs.c - py * cs.sn,
        y: rect.top  + t.ty + px * cs.sn + py * cs.c
      };
    }

    // Inverse of imageToScreen — subtract translate, apply inverse
    // rotation (transpose of the rotation matrix), then divide by
    // scale to get image-pixel coords.
    function screenToImage(pt) {
      var t = controller.getTransform();
      var rect = el.getBoundingClientRect();
      var cs = rotationCosSin(t.rotation || 0);
      var dx = (pt.x || 0) - rect.left - t.tx;
      var dy = (pt.y || 0) - rect.top  - t.ty;
      return {
        x: ( dx * cs.c + dy * cs.sn) / t.s,
        y: (-dx * cs.sn + dy * cs.c) / t.s
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

    function fitBounds(rect, opts) {
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      var v = controller.getViewportSize();
      var t = controller.getTransform();
      var rot = t.rotation || 0;
      // The rect is in unrotated canvas-px (the consumer's natural
      // frame of reference). After rotation, its screen-space bbox
      // has different dims — for 90° / 270° the width and height
      // swap. Compute newS against the rotated bbox so the rotated
      // content actually fits the viewport.
      var fitW = (rot === 90 || rot === 270) ? rect.height : rect.width;
      var fitH = (rot === 90 || rot === 270) ? rect.width  : rect.height;
      var newS = Math.min(v.vw / fitW, v.vh / fitH);
      // Compute the rotated + scaled bbox of `rect` in stage-local
      // coords (pre-translate). The same math as `rotatedRectBBox`
      // but inlined since the engine's helper isn't exposed.
      var cs = rotationCosSin(rot);
      var x1 = rect.x, y1 = rect.y;
      var x2 = rect.x + rect.width, y2 = rect.y + rect.height;
      var pts = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var i = 0; i < 4; i++) {
        var px = pts[i][0] * newS * cs.c - pts[i][1] * newS * cs.sn;
        var py = pts[i][0] * newS * cs.sn + pts[i][1] * newS * cs.c;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      // Center the rotated bbox in the viewport.
      var newTx = (v.vw - (maxX - minX)) / 2 - minX;
      var newTy = (v.vh - (maxY - minY)) / 2 - minY;
      if (opts && opts.animate) {
        controller.animateTo(newTx, newTy, newS, {
          duration: opts.duration,
          easing: opts.easing
        });
      } else {
        controller.setTransform(newTx, newTy, newS);
      }
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
      // Per-image visibility on a multi-image canvas. Hidden images
      // stay in layout (pan-bounds + fit math are anchored) but
      // their <img> is `display: none`; the `image-visibility-change`
      // event lets extensions pinned to a specific image hide / re-
      // show in lockstep. `getHiddenImageIds` returns a snapshot for
      // late-mounting extensions that need to seed their initial state.
      setImageVisible: controller.setImageVisible,
      getHiddenImageIds: controller.getHiddenImageIds,
      getExtension: controller.getExtension,
      // Opt-in zoom + pan constraint controls (0.5.1+). Same semantics
      // as on the viewer handle — paged readers / wallpaper croppers
      // use these to fix the zoom-out floor and lock pan at fit. All
      // three default to no-op so consumers who don't opt in see
      // identical pre-0.5.1 behavior.
      setZoomFloor:   function(v) { controller.setZoomFloor(v); },
      setZoomCeiling: function(v) { controller.setZoomCeiling(v); },
      setPanLocked:   function(b) { controller.setPanLocked(b); },
      // Per-region pan clamp + custom home action (both 0.5.2+).
      // Paged readers narrow `setPanBounds` to the current page rect
      // so dragging never wanders into adjacent pages, and override
      // `setHomeAction` so the nav-column reset button (+ the `0`
      // keyboard shortcut) fits the active page instead of the
      // whole multi-image canvas. Both were on the controller from
      // the start but the canvas handle's surface never re-exported
      // them — a leak fixed here.
      setPanBounds:   function(b) { controller.setPanBounds(b); },
      setHomeAction:  function(fn) { controller.setHomeAction(fn); },
      // Suppress the next `tap` event for `ms` (default 250) —
      // peer libraries committing a gesture that races the OS-
      // synthesized tap pipeline call this to swallow it. See
      // `[data-fresco-suppress-tap]` for the static-element
      // counterpart that doesn't require a function call.
      suppressNextTap: function(ms) { controller.suppressNextTap(ms); },
      // Live transform getter for consumers building layered
      // overlays (annotation surfaces, diagnostic HUDs) that need
      // to mirror the canvas's `{tx, ty, s, rotation}` between
      // frames. The `rotation` field is in degrees, snapped to one
      // of {0, 90, 180, 270}.
      getTransform:   function() { return controller.getTransform(); },
      // 90°-snapped content rotation (0.5.7+). `setRotation(deg)`
      // re-fits + emits a `rotate` event when the snapped value
      // actually changes; `getRotation()` returns the current angle;
      // `rotateBy(delta)` is sugar for `setRotation(getRotation()+delta)`
      // — wire it to a toggle button. The host element + nav
      // overlay stay un-rotated; only the stage (and everything
      // inside it, including extension SVG overlays) rotates.
      setRotation:    function(deg) { controller.setRotation(deg); },
      getRotation:    function() { return controller.getRotation(); },
      rotateBy:       function(delta) { controller.rotateBy(delta); },
      // Programmatic equivalents of the built-in nav buttons —
      // identical step factors + anchors. Consumers hiding the
      // chrome (`:nav_buttons={[]}`) but wanting the same actions
      // wired to their own buttons / shortcuts call these.
      zoomIn:           function(f) { controller.zoomIn(f); },
      zoomOut:          function(f) { controller.zoomOut(f); },
      toggleFullscreen: function()  { controller.toggleFullscreen(); },
      requestHome:      function()  { controller.requestHome(); },
      // 0.5.2+ view-tracking — emits "view-focus" / "view-blur" on
      // the bus when the dominant image changes. Default off; enable
      // explicitly to start.
      enableViewTracking:  function(o) { controller.enableViewTracking(o || {}); },
      disableViewTracking: function() { controller.disableViewTracking(); },
      getFocusedImage:     function() { return controller.getFocusedImage(); },
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
})();
