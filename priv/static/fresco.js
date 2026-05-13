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
//   { viewer, container,
//     imageToScreen(pt), screenToImage(pt),
//     getViewportBounds(),
//     fitBounds(rect, immediately),
//     setSource(url, opts), swapSourcePreservingBounds(url, opts),
//     on(eventName, handler) → unsubscribe }
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
    expand:  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"/></svg>'
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
      "  background: rgba(0, 0, 0, 0.55); color: #fff;",
      "  border-radius: 8px;",
      "  transition: background 120ms ease;",
      "}",
      ".fresco-nav button:hover { background: rgba(0, 0, 0, 0.78); }",
      ".fresco-nav button:focus-visible {",
      "  outline: 2px solid rgba(255, 255, 255, 0.7); outline-offset: 1px;",
      "}",
      ".fresco-nav svg { width: 18px; height: 18px; }",
      // Subtle dot grid on every Fresco viewer's host element. In
      // the default clamped mode the image fills the viewport and
      // the dots are invisible (OSD paints over them); in
      // `infinite_canvas` mode the dots show through the void
      // around the image so users can tell they're on a canvas,
      // not in empty space. Fixed at 24×24 screen pixels so the
      // spacing stays constant regardless of zoom — same approach
      // Figma / Miro use. Override `.fresco-viewer` in your own
      // CSS for dark mode or a different accent.
      ".fresco-viewer {",
      "  background-color: #fafafa;",
      "  background-image: radial-gradient(circle, #d4d4d8 1px, transparent 1px);",
      "  background-size: 24px 24px;",
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

  function buildNav(viewer, container) {
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
        if (!src) {
          console.warn("[Fresco] Missing data-src on element", self.el);
          return;
        }

        self.currentSrc = src;

        // Infinite-canvas mode: caller asked for unclamped pan/zoom so
        // overlays (e.g. Etcher annotations) can extend beyond the
        // image into the surrounding void. Off by default — every
        // existing consumer keeps the stock "image fills viewport"
        // clamps.
        var infiniteCanvas = self.el.dataset.infiniteCanvas === "true";

        self.viewer = window.OpenSeadragon({
          element: self.el,
          tileSources: resolveTileSource(src),

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

        // Built-in nav overlay (zoom in/out/home/fullscreen).
        self.nav = buildNav(self.viewer, self.el);

        // Publish the handle so extensions can attach. The nav element is
        // passed through so extensions can append their own buttons via
        // `handle.appendNavButton(...)`.
        self.handle = makeHandle(self.viewer, self.el, self.nav);
        publishReady(self.el.id, self.handle);
      });
    },

    updated: function() {
      if (!this.viewer) return;
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
