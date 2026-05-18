defmodule Fresco do
  @moduledoc """
  Fresco is a polished pan-zoom image viewer for Phoenix apps.

  The metaphor: a *fresco* is the wet-plaster surface you paint on. Fresco
  the library is the surface every layered image experience sits on top of
  — annotation tools, ML overlays, measurement widgets, and so on. They
  attach to the same Fresco viewer instance through a small extension
  registry.

  Used on its own, Fresco is a complete viewer: pan, zoom (wheel, pinch,
  buttons, keyboard), fit-to-view, fullscreen, Heroicons nav overlay,
  smooth gestures on mobile.

  Used as a host for extensions, Fresco exposes a coordinate adapter,
  event pub/sub, and a small extension registry so peer libraries can
  attach by DOM id without needing to fork the viewer.

  ## Quick start

      <Fresco.viewer
        id="photo"
        src={~p"/uploads/photo.jpg"}
        class="w-full h-[80vh] rounded"
      />

  ## Extending

  Extensions look up the live viewer handle by DOM id:

      // In another LiveView hook on the same page:
      window.Fresco.onViewerReady("photo", function(handle) {
        handle.on("zoom", function(e) { /* … */ });
        handle.swapSourcePreservingBounds("/path/to/different-source");
      });

  Annotation-style overlays can also attach as children of the
  `.fresco-stage` element to inherit the transform automatically — no
  per-frame coordinate math required for the common case.

  Source providers transform a URL into a Fresco tile source:

      window.Fresco.registerSourceProvider(
        function(url) { return url.endsWith(".my-format"); },
        function(url) { return { type: "image", url: rewrite(url) }; }
      );

  See `Fresco.Viewer` for the component reference, and `Fresco.ScrollStrip`
  for the long-scroll reader counterpart (`<Fresco.scroll_strip>`).

  ## Two component shapes

  - **`<Fresco.viewer>`** — pan/zoom for a single image. Hand-rolled
    CSS-transform engine; native Pointer Events; smooth on iOS Safari.
    Use when the user is panning *around* a single image and may want to
    zoom in.
  - **`<Fresco.scroll_strip>`** — native DOM `<img>` + browser scroll for
    long-form vertical strips (manhwa, comics, IG feeds). Use when the
    user is reading by scrolling *through* a stack of images at one zoom
    level.

  Both share the registry — `window.Fresco.onReady(domId, callback)` works
  for either, and the handle each yields exposes a partly-shared surface
  (`container`, `on`, `appendNavButton`) plus its own kind-specific
  methods (viewer: `imageToScreen` / `fitBounds`; strip: `scrollTo` /
  `scrollBy` / `getScrollState`). Feature-detect with
  `"scrollTo" in handle` to dispatch between them.
  """

  defdelegate viewer(assigns), to: Fresco.Viewer
  defdelegate scroll_strip(assigns), to: Fresco.ScrollStrip
end
