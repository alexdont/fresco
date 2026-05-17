// Fresco — polished pan-zoom image viewer for Phoenix apps.
//
// Wraps OpenSeadragon (lazy-loaded from jsDelivr) with a Phoenix LiveView
// hook, a Heroicons nav overlay, viewport clamping, and a small but
// deliberate extension surface so layered libraries (Tessera for deep zoom,
// future annotation packages, etc.) can plug in without forking.
//
// Public surface:
//
//   window.Fresco.viewerFor(domId)             // → viewer handle, or null
//   window.Fresco.onViewerReady(domId, cb)     // fires once when ready
//   window.Fresco.registerSourceProvider(predicate, factory)
//
// Viewer handle (returned by viewerFor):
//
//   { openSeadragon, container,
//     imageToScreen(pt), screenToImage(pt),
//     getViewportBounds(),
//     fitBounds(rect, immediately),
//     setSource(url, opts), swapSourcePreservingBounds(url, opts),
//     on(eventName, handler) → unsubscribe,
//     appendNavButton(svg, title, onClick) → unsubscribe (+ .setIcon/.setTitle/.el) }
//
// `handle.openSeadragon` is an escape hatch — the underlying OSD Viewer
// instance. Use it when Fresco doesn't expose the OSD API you need (custom
// constraints, raw event handlers, plugin registration). See the
// "Advanced: OSD escape hatch" section in README.md for the contract.
// `handle.viewer` is a back-compat alias for `openSeadragon` (it was the
// original name through 0.1.x); new code should prefer `openSeadragon`.
//
// Events fired through `handle.on(eventName, fn)`:
//   "zoom" / "pan" / "open" / "resize"           — bridged from OSD intent
//   "animation" / "update-viewport"              — per-frame OSD ticks
//   "fast-pan"                                   — synthetic; only when
//     the consumer opted into `:pan_optimized`. Three phases via
//     `e.phase`: "start" (overlay should add will-change: transform),
//     "delta" (apply `translate3d(e.x, e.y, 0)` to overlay container),
//     "end" (clear the transform; OSD's viewport is now committed).
//
// Parent app wiring:
//   import "../../deps/fresco/priv/static/fresco.js"
//   hooks: { ...window.FrescoHooks, ...colocatedHooks }

(function() {
  if (window.FrescoLoaded) return;
  window.FrescoLoaded = true;

  // ===========================================================================
  // Lazy OSD load
  // ===========================================================================

  // OpenSeadragon — pinned to a known-good 4.1.x. Bump this version
  // string intentionally after validating against the new release;
  // the URL is a CDN, so a silent upstream change shouldn't surprise
  // viewers in the wild.
  var OSD_VERSION = "4.1.0";
  var OSD_CDN = "https://cdn.jsdelivr.net/npm/openseadragon@" + OSD_VERSION +
                "/build/openseadragon/openseadragon.min.js";
  var osdLoading = false;
  var osdLoadCallbacks = [];

  function loadOSD(callback) {
    if (window.OpenSeadragon) { callback(); return; }
    osdLoadCallbacks.push(callback);
    if (osdLoading) return;
    osdLoading = true;

    var script = document.createElement("script");
    script.src = OSD_CDN;
    script.onload = function() {
      osdLoadCallbacks.forEach(function(cb) { cb(); });
      osdLoadCallbacks = [];
    };
    script.onerror = function() {
      console.error("[Fresco] Failed to load OpenSeadragon from CDN");
    };
    document.head.appendChild(script);
  }

  // ===========================================================================
  // Extension surface
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

  // Build OSD's "positioned source" wrapper from a single :sources
  // entry. Each entry's `src` flows through the provider chain so
  // mixed-format layouts (plain image + DZI pyramid) work transparently.
  // Defaults match the Elixir attr docs: x=0, y=0, width=1 in viewport
  // units, with the first image conventionally anchoring the
  // coordinate system at width=1.
  function buildMultiSource(entry) {
    return {
      tileSource: resolveTileSource(entry.src),
      x: typeof entry.x === "number" ? entry.x : 0,
      y: typeof entry.y === "number" ? entry.y : 0,
      width: typeof entry.width === "number" ? entry.width : 1
    };
  }

  // Parse a JSON-encoded :sources payload into an OSD tileSources array.
  // Returns null if the payload is empty or malformed (JS falls back
  // to data-src in that case).
  function parseSourcesJson(json) {
    if (!json) return null;
    try {
      var parsed = JSON.parse(json);
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      return parsed.map(buildMultiSource);
    } catch (e) {
      console.warn("[Fresco] Malformed data-sources JSON", e);
      return null;
    }
  }

  window.Fresco = {
    viewerFor: function(domId) {
      return viewerRegistry[domId] || null;
    },

    onViewerReady: function(domId, callback) {
      var handle = viewerRegistry[domId];
      if (handle) { callback(handle); return; }
      readyCallbacks[domId] = readyCallbacks[domId] || [];
      readyCallbacks[domId].push(callback);
    },

    // Register a source provider. Predicate is called with the source URL
    // before the default provider; first match wins. Providers added later
    // take precedence over the default (which always matches).
    registerSourceProvider: function(predicate, factory) {
      // Insert at the front so it beats the default catch-all.
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
    expand:  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"/></svg>',
    rotate:  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 0 0-3.7-3.7 48.678 48.678 0 0 0-7.324 0 4.006 4.006 0 0 0-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 0 0 3.7 3.7 48.656 48.656 0 0 0 7.324 0 4.006 4.006 0 0 0 3.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3-3 3"/></svg>'
  };

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    var css = [
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
      // Subtle dot grid on every Fresco viewer's host element. In
      // the default clamped mode the image fills the viewport and
      // the dots are invisible (OSD paints over them); in
      // `infinite_canvas` mode the dots show through the void
      // around the image so users can tell they're on a canvas,
      // not in empty space. Fixed at 24×24 screen pixels so the
      // spacing stays constant regardless of zoom — same approach
      // Figma / Miro use.
      //
      // Theming: the six `--fresco-*` custom properties below are the
      // entire palette surface. Defaults are light (matches the
      // original look). The `prefers-color-scheme: dark` block flips
      // them when the host is in `theme: :system` mode (the default)
      // or `theme: :dark`. Explicit `[data-fresco-theme="light"]` /
      // `["dark"]` rules below force a fixed palette regardless of
      // OS preference.
      //
      // `theme: :inherit` mode opts the viewer OUT of Fresco's own
      // var declarations entirely — both the base rule and the
      // `@media` branch exclude it. The parent app's CSS supplies the
      // six `--fresco-*` values (typically mapped to daisyUI or other
      // theme tokens). The structural rule below (background-color +
      // dot grid) applies to every viewer regardless of theme, so an
      // `:inherit` viewer still renders the canvas backdrop using
      // whatever colors the parent provides.
      ".fresco-viewer:not([data-fresco-theme=\"inherit\"]) {",
      "  --fresco-bg: #fafafa;",
      "  --fresco-grid-dot: #d4d4d8;",
      "  --fresco-nav-bg: rgba(0, 0, 0, 0.55);",
      "  --fresco-nav-bg-hover: rgba(0, 0, 0, 0.78);",
      "  --fresco-nav-fg: #fff;",
      "  --fresco-nav-focus: rgba(255, 255, 255, 0.7);",
      "}",
      // Structural styles — apply to every viewer regardless of
      // theme mode. The vars are sourced from either Fresco's own
      // declarations (above + the branches below) or from the
      // parent app's CSS in `:inherit` mode.
      ".fresco-viewer {",
      "  background-color: var(--fresco-bg);",
      "  background-image: radial-gradient(circle, var(--fresco-grid-dot) 1px, transparent 1px);",
      "  background-size: 24px 24px;",
      "}",
      // System mode: follow OS preference. Excluded when the host
      // explicitly opts into light via data-fresco-theme="light", or
      // into inherit (parent-driven) via "inherit". A forced-light
      // viewer stays light on a dark-OS machine, and an inherit
      // viewer keeps the parent's palette regardless of OS.
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
      // Explicit dark: forces dark regardless of OS preference. The
      // attribute selector has the same specificity as the media
      // query rule above, but the media-query rule excludes
      // `[data-fresco-theme=\"light\"]`, so an explicit dark
      // override here also wins on a light-OS machine.
      ".fresco-viewer[data-fresco-theme=\"dark\"] {",
      "  --fresco-bg: #0a0a0a;",
      "  --fresco-grid-dot: #262626;",
      "  --fresco-nav-bg: rgba(255, 255, 255, 0.12);",
      "  --fresco-nav-bg-hover: rgba(255, 255, 255, 0.20);",
      "  --fresco-nav-fg: #fff;",
      "  --fresco-nav-focus: rgba(255, 255, 255, 0.7);",
      "}",
      // Explicit light: redundant with the base defaults, but spelled
      // out so the rule reads symmetrically and so future palette
      // tweaks don't accidentally desync the two.
      ".fresco-viewer[data-fresco-theme=\"light\"] {",
      "  --fresco-bg: #fafafa;",
      "  --fresco-grid-dot: #d4d4d8;",
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

  function buildNav(viewer, container, opts) {
    injectStyles();

    var nav = document.createElement("div");
    nav.className = "fresco-nav";

    var zoomFactor = 1.4;

    // Order matters — extensions append below this set via
    // `handle.appendNavButton(...)`, so anything they add lands at the
    // bottom of the column.
    nav.appendChild(makeButton(ICONS.expand, "Toggle fullscreen", function() {
      viewer.setFullPage(!viewer.isFullPage());
    }));

    // Opt-in rotation. 90° clockwise per click, tracked independently of
    // zoom/pan — "Reset view" deliberately doesn't undo rotation, so a
    // rotated image stays rotated when the user re-centers it. Sits
    // between fullscreen and zoom-in so rotation lives with "view
    // orientation" controls, not with "zoom level" controls.
    if (opts && opts.rotate) {
      nav.appendChild(makeButton(ICONS.rotate, "Rotate 90°", function() {
        var current = viewer.viewport.getRotation();
        viewer.viewport.setRotation((current + 90) % 360);
      }));
    }

    nav.appendChild(makeButton(ICONS.zoomIn, "Zoom in", function() {
      viewer.viewport.zoomBy(zoomFactor);
      viewer.viewport.applyConstraints();
    }));

    nav.appendChild(makeButton(ICONS.zoomOut, "Zoom out", function() {
      viewer.viewport.zoomBy(1 / zoomFactor);
      viewer.viewport.applyConstraints();
    }));

    nav.appendChild(makeButton(ICONS.reset, "Reset view", function() {
      viewer.viewport.goHome();
    }));

    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.appendChild(nav);

    return nav;
  }

  // ===========================================================================
  // Bounds-preserving source swap utility
  // ===========================================================================

  // Open a new tile source on an active viewer while preserving the
  // user's current viewport (pan + zoom). Used by extensions like Tessera
  // when swapping between resolution layers without jarring the user.
  function swapSourcePreservingBounds(viewer, url) {
    var keepBounds = viewer.viewport.getBounds();
    viewer.addOnceHandler("open", function() {
      try { viewer.viewport.fitBounds(keepBounds, true); } catch (_) {}
    });
    try { viewer.open(resolveTileSource(url)); } catch (_) { /* ignore */ }
  }

  // ===========================================================================
  // The viewer handle exposed via Fresco.viewerFor
  // ===========================================================================

  // ===========================================================================
  // Fast-pan CSS-transform module
  //
  // When the consumer opts into `:pan_optimized`, this module replaces OSD's
  // per-frame canvas redraw with a CSS-transform glide for the duration of
  // each pan gesture. The technique mirrors native browser scroll:
  //
  //   - On pan-start: snapshot zoom + canvas state, swap OSD's drawer for a
  //     no-op so per-tick redraws are skipped. Emit `fast-pan {phase:"start"}`.
  //   - Per pan tick: read OSD's current viewport, compute the screen-pixel
  //     delta from start, apply `transform: translate3d(dx, dy, 0)` to the
  //     canvas. Emit `fast-pan {phase:"delta", x: dx, y: dy}` so overlays
  //     (Etcher) can transform in lockstep.
  //   - On animation-finish (or zoom-change / overscan bail): restore OSD's
  //     drawer, clear the canvas transform, trigger one repaint so OSD
  //     paints at its committed viewport position. Emit `fast-pan {phase:"end"}`.
  //
  // Bails out (immediately committing and falling back to OSD's normal redraw
  // path) when:
  //   - Zoom changes mid-pan (transform math no longer holds)
  //   - The :rotate feature is active (rotation invalidates simple translate)
  //   - Cumulative delta crosses the overscan threshold (50% of viewport
  //     height) — beyond that, the painted canvas wouldn't cover the visible
  //     area, so we accept a redraw and reset.
  // ===========================================================================

  function installFastPan(viewer, handle, rotateActive) {
    if (rotateActive) {
      warn("pan_optimized + :rotate are mutually exclusive — fast-pan disabled");
      return;
    }
    if (!viewer || !viewer.drawer) {
      warn("viewer.drawer not present at install time — fast-pan disabled");
      return;
    }

    var state = null; // null when inactive; object when fast-pan in flight

    function warn(msg) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[Fresco] pan_optimized: " + msg);
      }
    }

    function canvas() {
      // OSD may swap drawer implementations between releases; treat the
      // canvas element as the only stable contract.
      return viewer.drawer && (viewer.drawer.canvas || (viewer.drawer.getCanvas && viewer.drawer.getCanvas()));
    }

    function viewportHeightPx() {
      var c = canvas();
      return c ? c.clientHeight || c.height : 0;
    }

    function startFastPan() {
      var c = canvas();
      if (!c) {
        warn("drawer has no canvas element — fast-pan disabled");
        return;
      }
      var drawer = viewer.drawer;
      var origUpdate = drawer.update;
      var origDraw = drawer.draw;

      // OSD 4.1's canvas drawer exposes `.update()`; older drawer APIs
      // (and some custom drawers) used `.draw()`. We need at least one
      // to suppress per-frame redraw. If neither exists, the consumer
      // is on an unfamiliar drawer and we can't safely no-op anything.
      if (typeof origUpdate !== "function" && typeof origDraw !== "function") {
        warn("drawer has neither .update nor .draw — fast-pan disabled (unknown OSD drawer)");
        return;
      }

      state = {
        canvas: c,
        origUpdate: origUpdate,
        origDraw: origDraw,
        startCenter: viewer.viewport.getCenter(true).clone(),
        startZoom: viewer.viewport.getZoom(true),
        dx: 0,
        dy: 0,
        watchdog: null
      };

      // Suppress per-frame redraw for the duration of the gesture. Override
      // whichever methods exist — being defensive about both shapes means
      // future OSD drawer revisions don't silently break the fast path.
      if (typeof origUpdate === "function") drawer.update = function() {};
      if (typeof origDraw === "function") drawer.draw = function() {};

      c.style.willChange = "transform";
      handle._emit("fast-pan", { phase: "start", x: 0, y: 0 });
      armWatchdog();
    }

    // Defensive backup: if no animation events arrive within the
    // watchdog window, commit anyway. The `immediately`-bail above
    // covers the known OSD callers that don't fire animation events,
    // but a custom OSD plugin or a future OSD release could pan
    // through some other code path; without this, fast-pan could
    // suppress the drawer indefinitely and the user would see stale
    // tiles. 1s is plenty for any reasonable spring animation; if a
    // legitimate spring tick comes in, we re-arm.
    function armWatchdog() {
      if (!state) return;
      if (state.watchdog) clearTimeout(state.watchdog);
      state.watchdog = setTimeout(function() {
        if (state) {
          warn("watchdog fired — committing without animation-finish (no spring ticks within 1s)");
          commitFastPan();
        }
      }, 1000);
    }

    function tickFastPan() {
      if (!state) return;
      // Bail to commit if zoom drifted mid-pan.
      if (viewer.viewport.getZoom(true) !== state.startZoom) {
        commitFastPan();
        return;
      }
      // Compute where the original center point sits on screen now that
      // OSD has moved the viewport. That delta IS the screen-pixel
      // distance we need to translate the canvas by so the existing
      // pixels visually follow OSD's intent without a redraw.
      var startPxNow = viewer.viewport.pixelFromPoint(state.startCenter, true);
      var startPxThen = new window.OpenSeadragon.Point(
        state.canvas.clientWidth / 2,
        state.canvas.clientHeight / 2
      );
      var dx = startPxNow.x - startPxThen.x;
      var dy = startPxNow.y - startPxThen.y;

      // Overscan bail: beyond half a viewport, the painted tiles can't
      // cover the visible area cleanly. Commit and let OSD repaint.
      var vh = viewportHeightPx();
      if (vh > 0 && Math.abs(dy) > vh * 0.5) {
        commitFastPan();
        return;
      }

      // dx/dy is where the original viewport center (image point at
      // pan-start) sits on screen NOW, relative to canvas center. When
      // the user drags down, OSD pans the viewport up, the original
      // center appears further down on screen → dy positive. We move
      // the canvas in the same direction so the existing pixels glide
      // with the user's gesture; an overlay that wants to stay anchored
      // to the same image-space coordinates applies the same transform.
      state.dx = dx;
      state.dy = dy;
      state.canvas.style.transform =
        "translate3d(" + dx + "px, " + dy + "px, 0)";
      handle._emit("fast-pan", { phase: "delta", x: dx, y: dy });
      armWatchdog();
    }

    function commitFastPan() {
      if (!state) return;
      if (state.watchdog) { clearTimeout(state.watchdog); state.watchdog = null; }
      var c = state.canvas;
      var drawer = viewer.drawer;

      // Restore whichever drawer methods we overrode in startFastPan.
      if (typeof state.origUpdate === "function") drawer.update = state.origUpdate;
      if (typeof state.origDraw === "function") drawer.draw = state.origDraw;

      // Clear the CSS transform — OSD's viewport already reflects the
      // pan (OSD's own pan handler updated it on every tick); the next
      // draw will paint at the correct position.
      c.style.transform = "";
      c.style.willChange = "";

      // Force one immediate redraw at the committed position via OSD's
      // public API. Works regardless of which drawer method names exist —
      // safer than calling drawer internals (`update` / `draw`) directly.
      try { viewer.forceRedraw(); } catch (_) {}

      state = null;
      handle._emit("fast-pan", { phase: "end" });
    }

    // OSD fires `pan` on user gesture or programmatic pan, `animation`
    // per spring tick, `animation-finish` when the spring settles. We
    // start on the first spring `pan`, follow each `animation` tick,
    // and commit on `animation-finish`.
    //
    // We deliberately skip pan events with `immediately === true`
    // (touch drag, wheel scroll, custom per-rAF `panBy(delta, true)`
    // loops): immediate panners don't fire `animation` or
    // `animation-finish`, so if we engaged fast-pan for them the
    // drawer would stay suppressed forever and the user would never
    // see new tiles paint. Native OSD redraw is already snappy
    // enough for those callers (it's the spring momentum that
    // benefits from the fast path — that's the slow case on iOS).
    viewer.addHandler("pan", function(e) {
      if (e && e.immediately) return;
      if (!state) startFastPan();
    });

    viewer.addHandler("animation", function() {
      if (state) tickFastPan();
    });

    viewer.addHandler("animation-finish", function() {
      if (state) commitFastPan();
    });

    // Bail aggressively on any zoom intent so the fast path doesn't
    // smear into zoom frames.
    viewer.addHandler("zoom", function() {
      if (state) commitFastPan();
    });
  }

  function makeHandle(viewer, container, navEl) {
    var subscribers = {};   // eventName → [handler, …]

    // Bridge OSD events to our subscriber list.
    function bridge(osdEvent, ourEvent) {
      viewer.addHandler(osdEvent, function(e) {
        var arr = subscribers[ourEvent] || [];
        for (var i = 0; i < arr.length; i++) {
          try { arr[i](e); } catch (_) {}
        }
      });
    }

    bridge("zoom", "zoom");
    bridge("pan", "pan");
    bridge("open", "open");
    bridge("resize", "resize");

    // Per-frame events. `zoom` and `pan` only fire on the *intent* to
    // zoom/pan (input or operation start). `animation` and `update-viewport`
    // fire on every animation tick, so extensions that render in lockstep
    // with the image (annotation overlays, measurement tools) get a chance
    // to redraw at frame rate rather than only at the endpoints of OSD's
    // spring interpolation.
    bridge("animation", "animation");
    bridge("update-viewport", "update-viewport");

    return {
      // Direct access to the underlying OpenSeadragon Viewer instance. Use
      // this when you need an OSD API that Fresco doesn't expose first-class
      // (custom zoom/pan constraints, raw event handlers like
      // `canvas-double-click`, OSD plugin registration, …). Advanced escape
      // hatch — file an issue if you find yourself reaching for it routinely;
      // common patterns should become first-class Fresco APIs. See the
      // "Advanced: OSD escape hatch" section in README.md for the stability
      // contract.
      openSeadragon: viewer,

      // Back-compat alias for `openSeadragon`. `viewer` was the original
      // (undocumented) name for this field through 0.1.x and Etcher already
      // depends on it; new code should prefer `openSeadragon`.
      viewer: viewer,

      container: container,

      imageToScreen: function(pt) {
        return viewer.viewport.viewportToWindowCoordinates(
          viewer.viewport.imageToViewportCoordinates(pt.x, pt.y)
        );
      },

      screenToImage: function(pt) {
        return viewer.viewport.viewportToImageCoordinates(
          viewer.viewport.windowToViewportCoordinates(new window.OpenSeadragon.Point(pt.x, pt.y))
        );
      },

      getViewportBounds: function() {
        return viewer.viewport.getBounds();
      },

      fitBounds: function(rect, immediately) {
        viewer.viewport.fitBounds(rect, !!immediately);
      },

      setSource: function(url) {
        try { viewer.open(resolveTileSource(url)); } catch (_) {}
      },

      swapSourcePreservingBounds: function(url) {
        swapSourcePreservingBounds(viewer, url);
      },

      on: function(eventName, handler) {
        subscribers[eventName] = subscribers[eventName] || [];
        subscribers[eventName].push(handler);
        return function unsubscribe() {
          var arr = subscribers[eventName] || [];
          var idx = arr.indexOf(handler);
          if (idx !== -1) arr.splice(idx, 1);
        };
      },

      // Internal: synchronous broadcast to subscribers. Used by the
      // fast-pan module (installed by the hook when `:pan_optimized` is
      // set) to emit `fast-pan` events without going through OSD's
      // addHandler bridge. Underscore-prefixed because consumers should
      // never call this — they listen via `on(eventName, fn)` and the
      // emit side is owned by Fresco's own modules.
      _emit: function(eventName, payload) {
        var arr = subscribers[eventName] || [];
        for (var i = 0; i < arr.length; i++) {
          try { arr[i](payload); } catch (_) {}
        }
      },

      // Append a button to Fresco's nav column (below the existing four:
      // zoom-in, zoom-out, reset, fullscreen). Used by extensions like
      // Etcher to add tool toggles. Returns an unsubscribe function that
      // removes the button on cleanup. The returned function carries a
      // few helpers as properties for callers that want to mutate the
      // button after creation:
      //
      //   .setIcon(svgString) — replace the inner SVG.
      //   .setTitle(text)     — update the tooltip + aria-label.
      //   .el                 — the underlying <button> element.
      appendNavButton: function(svg, title, onClick) {
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
    };
  }

  // ===========================================================================
  // FrescoViewer LiveView hook
  // ===========================================================================

  window.FrescoHooks = window.FrescoHooks || {};

  window.FrescoHooks.FrescoViewer = {
    mounted: function() {
      var self = this;
      loadOSD(function() {
        if (!self.el.isConnected) return;

        var src = self.el.dataset.src;
        var sourcesJson = self.el.dataset.sources;
        var multiSources = parseSourcesJson(sourcesJson);

        if (!multiSources && !src) {
          console.warn(
            "[Fresco] Element has neither data-src nor a valid data-sources payload",
            self.el
          );
          return;
        }

        // Track both shapes for the `updated` hook: live re-renders
        // may swap either single-source or multi-source payloads.
        self.currentSrc = src;
        self.currentSourcesJson = multiSources ? sourcesJson : null;

        // Infinite-canvas mode: caller asked for unclamped pan/zoom so
        // overlays (e.g. Etcher annotations) can extend beyond the
        // image into the surrounding void. Off by default — every
        // existing consumer keeps the stock "image fills viewport"
        // clamps.
        var infiniteCanvas = self.el.dataset.infiniteCanvas === "true";
        var rotateEnabled = self.el.dataset.rotate === "true";

        // data-sources wins when present, otherwise the legacy
        // single-image data-src path. resolveTileSource still flows
        // through provider chain for both.
        var tileSources = multiSources || resolveTileSource(src);

        self.viewer = window.OpenSeadragon({
          element: self.el,
          tileSources: tileSources,

          // Our Heroicons overlay replaces the built-in PNG-sprite nav.
          showNavigationControl: false,

          // Snappier than defaults (1.2s / 6.5) — tracks user input directly
          // without going fully instant.
          animationTime: 0.3,
          springStiffness: 10,

          // Reasonable headroom past native resolution for any consumer.
          // Extensions like Tessera can override per-layer if they want
          // tighter bounds.
          maxZoomPixelRatio: 8,

          // Clamp the image to the viewer rectangle — no off-screen drift,
          // no half-image floating in empty space. Infinite-canvas mode
          // releases both clamps and lowers the zoom-out floor so the
          // image can shrink to a thumbnail in the middle of empty
          // canvas.
          visibilityRatio: infiniteCanvas ? 0 : 1.0,
          constrainDuringPan: !infiniteCanvas,
          minZoomImageRatio: infiniteCanvas ? 0.05 : 0.9,

          gestureSettingsTouch: { pinchToZoom: true, dragToPan: true },
          gestureSettingsMouse: {
            scrollToZoom: true,
            dragToPan: true,
            // Single-click should select / annotate, not zoom. Zooming
            // by mouse is double-click (here) or scroll wheel.
            clickToZoom: false,
            dblClickToZoom: true
          }
        });

        // Built-in nav overlay (zoom in/out/home/fullscreen, plus
        // optional rotate when the host opted in).
        self.nav = buildNav(self.viewer, self.el, { rotate: rotateEnabled });

        // Publish the handle so extensions can attach. The nav element is
        // passed through so extensions can append their own buttons via
        // `handle.appendNavButton(...)`.
        self.handle = makeHandle(self.viewer, self.el, self.nav);
        publishReady(self.el.id, self.handle);

        // Opt-in CSS-transform fast path for pure-pan motion. Installs
        // a pan interceptor that swaps OSD's drawer for a no-op during
        // the gesture, applies `transform: translate3d` to the canvas
        // per frame, and emits a `fast-pan` event so overlays (Etcher)
        // can transform in lockstep. See README "Optimized pan for
        // long-scroll content" for the full contract.
        if (self.el.dataset.panOptimized === "true") {
          installFastPan(self.viewer, self.handle, !!rotateEnabled);
        }
      });
    },

    updated: function() {
      if (!this.viewer) return;

      // Multi-source swap takes precedence: if data-sources changed,
      // re-open with the new layout while preserving the current
      // viewport (same bounds-preservation trick as single-source).
      var newSourcesJson = this.el.dataset.sources;
      if (newSourcesJson && newSourcesJson !== this.currentSourcesJson) {
        var tileSources = parseSourcesJson(newSourcesJson);
        if (tileSources) {
          this.currentSourcesJson = newSourcesJson;
          var keepBounds = this.viewer.viewport.getBounds();
          var viewer = this.viewer;
          viewer.addOnceHandler("open", function() {
            try { viewer.viewport.fitBounds(keepBounds, true); } catch (_) {}
          });
          try { viewer.open(tileSources); } catch (_) {}
          return;
        }
      }

      var newSrc = this.el.dataset.src;
      if (newSrc && newSrc !== this.currentSrc) {
        this.currentSrc = newSrc;
        swapSourcePreservingBounds(this.viewer, newSrc);
      }
    },

    destroyed: function() {
      if (this.el && this.el.id) unpublish(this.el.id);
      if (this.nav && this.nav.parentNode) {
        this.nav.parentNode.removeChild(this.nav);
      }
      this.nav = null;
      if (this.viewer) {
        try { this.viewer.destroy(); } catch (_) {}
        this.viewer = null;
      }
    }
  };
})();
