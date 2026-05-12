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

  See `Fresco.Viewer` for the component reference.
  """

  defdelegate viewer(assigns), to: Fresco.Viewer
end
