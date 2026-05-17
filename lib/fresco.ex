defmodule Fresco do
  @moduledoc """
  Fresco is a polished pan-zoom image viewer for Phoenix apps.

  The metaphor: a *fresco* is the wet-plaster surface you paint on. Fresco
  the library is the surface every layered image experience sits on top of —
  the deep-zoom tile pyramid (Tessera), the annotation tools (Etcher,
  forthcoming), the future ML / measurement / OCR overlays — all of them
  attach to the same Fresco viewer instance.

  Used on its own, Fresco is a complete viewer: pan, zoom (wheel, pinch,
  buttons, keyboard), fit-to-view, fullscreen, Heroicon nav overlay,
  viewport clamped so the image can't be panned off-screen, smooth
  animations tuned for "snappy but not jarring".

  Used as a host for extensions, Fresco exposes a coordinate adapter,
  event pub/sub, and a small extension registry so peer libraries can
  attach by `id` without needing to fork the viewer.

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

  Source providers transform a URL into an OpenSeadragon tile source:

      window.Fresco.registerSourceProvider(
        function(url) { return url.endsWith(".dzi"); },
        function(url) { return url; }   // OSD accepts a DZI URL directly
      );

  See `Fresco.Viewer` for the component reference, and `Fresco.ScrollStrip`
  for the long-scroll reader counterpart (`<Fresco.scroll_strip>`).

  ## Two component shapes

  - **`<Fresco.viewer>`** — OpenSeadragon-backed pan/zoom for deep-zoom
    imagery, museum scans, big single images. Use when the user is
    panning *around* a single image and may want to zoom in.
  - **`<Fresco.scroll_strip>`** — native DOM `<img>` + browser scroll for
    long-form vertical strips (manhwa, comics, IG feeds). Use when the
    user is reading by scrolling *through* a stack of images at one zoom
    level. No canvas redraw per frame; native 60fps on mobile.

  Both share the registry — `window.Fresco.onReady(domId, callback)` works
  for either, and the handle each one yields exposes a partly-shared
  surface (`container`, `on`, `appendNavButton`) plus its own kind-specific
  methods (viewer: `imageToScreen` / `fitBounds` / OSD; strip: `scrollTo`
  / `scrollBy` / `getScrollState`). Feature-detect with
  `"scrollTo" in handle` to dispatch between them.
  """

  defdelegate viewer(assigns), to: Fresco.Viewer
  defdelegate scroll_strip(assigns), to: Fresco.ScrollStrip
end
