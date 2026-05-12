# Fresco

Polished pan-zoom image viewer for Phoenix apps. The foundation for layered image experiences (deep zoom, annotations, ML overlays) — also useful standalone whenever you just need a *good* image viewer.

A *fresco* is the wet-plaster surface you paint on. Fresco the library is the surface every layered image experience sits on top of: extensions attach to the same viewer instance via a small extension API. Used alone, it's still a complete viewer with pan, zoom, fit-to-view, Heroicons nav, viewport clamping, and smooth animations.

---

## Install

```elixir
def deps do
  [
    {:fresco, "~> 0.1"}
  ]
end
```

Then in your `assets/js/app.js`, import the JS hook and spread it into your LiveSocket hooks:

```js
import "../../deps/fresco/priv/static/fresco.js"

let liveSocket = new LiveSocket("/live", Socket, {
  hooks: { ...window.FrescoHooks, ...colocatedHooks }
})
```

OpenSeadragon is lazy-loaded from jsDelivr on first viewer mount — no extra `<script>` tags needed.

---

## Use it standalone

```heex
<Fresco.viewer
  id="photo"
  src={~p"/uploads/photo.jpg"}
  class="w-full h-[80vh] rounded"
/>
```

You get:

- **Pan**: click-drag, touch-drag, keyboard arrows
- **Zoom**: mouse wheel, pinch, double-click, dedicated buttons, `+` / `-` keys
- **Fit-to-view** initial state regardless of image / container aspect ratio
- **Heroicons nav overlay**: zoom-in / zoom-out / reset / fullscreen
- **Viewport clamped** so the image can't be panned off-screen
- **Smooth animations** tuned snappy-but-not-jarring

---

## Use it as a foundation for extensions

Fresco publishes each live viewer to `window.Fresco.viewerFor(domId)`. Peer libraries (Tessera for deep zoom, future Etcher for annotations, etc.) look up the handle and attach without forking the viewer.

```js
// In another LiveView hook on the same page:
window.Fresco.onViewerReady("photo", function(handle) {
  // Coordinate adapters
  handle.imageToScreen({x: 100, y: 50});
  handle.screenToImage({x: 800, y: 400});

  // Viewport
  handle.getViewportBounds();
  handle.fitBounds(rect, /* immediately */ true);

  // Swap the source while preserving the user's zoom/pan
  handle.swapSourcePreservingBounds("/path/to/new-source");

  // Subscribe to viewer events
  const unsub = handle.on("zoom", function(e) { /* … */ });
});
```

### Source providers

Override Fresco's default "treat the URL as a plain image" behavior for specific URL patterns:

```js
window.Fresco.registerSourceProvider(
  function(url) { return url.toLowerCase().endsWith(".dzi"); },
  function(url) { return url; }    // OSD takes a DZI URL directly
);
```

This is how Tessera (the deep-zoom layer that builds on Fresco) attaches: it registers a `.dzi` source provider so DZI manifests automatically trigger tile loading.

---

## Family of packages

Fresco is the foundation. Related published packages:

- **[`tessera`](https://hex.pm/packages/tessera)** — deep zoom for very high-resolution images via DZI tile pyramids. Built on Fresco.
- **Etcher** *(planned)* — annotation + markup tools (drawing, arrows, text, comment threads on regions of an image). Will build on Fresco.

You can use Fresco entirely on its own; you don't need any of the related packages.

---

## License

MIT — see [LICENSE](./LICENSE).
