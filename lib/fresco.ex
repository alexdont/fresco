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

  See `Fresco.Viewer`, `Fresco.Canvas`, and `Fresco.ScrollStrip` for the
  per-component references.

  ## Three component shapes

  - **`<Fresco.viewer>`** — pan/zoom for a single image. Hand-rolled
    CSS-transform engine; native Pointer Events; smooth on iOS Safari.
    Use when the user is panning *around* a single image and may want to
    zoom in.
  - **`<Fresco.canvas>`** — N images laid out at absolute canvas-pixel
    coordinates on a virtual canvas, plus an open `extensions` map for
    annotation tools / overlays. Serializes to a single `.fresco` JSON
    file so an entire scene lives in one place instead of scattered DB
    tables. Single-image is just the N=1 case. Use when the user is
    building a layered scene they'll save.
  - **`<Fresco.scroll_strip>`** — native DOM `<img>` + browser scroll for
    long-form vertical strips (manhwa, comics, IG feeds). Use when the
    user is reading by scrolling *through* a stack of images at one zoom
    level.

  All three share the registry — `window.Fresco.onReady(domId, callback)`
  works for any of them, and the handle each yields exposes a
  partly-shared surface (`container`, `on`, `appendNavButton`) plus its
  own kind-specific methods (viewer: `imageToScreen` / `fitBounds`;
  canvas: same plus `getImages` / `imageBoundsFor` / `fitImage` /
  `getExtension`; strip: `scrollTo` / `scrollBy` / `getScrollState`).
  Feature-detect with `"scrollTo" in handle` (strip),
  `"getImages" in handle` (canvas), or assume viewer otherwise.
  """

  defdelegate viewer(assigns), to: Fresco.Viewer
  defdelegate canvas(assigns), to: Fresco.Canvas
  defdelegate scroll_strip(assigns), to: Fresco.ScrollStrip
end
