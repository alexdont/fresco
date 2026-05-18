defmodule Fresco.Viewer do
  @moduledoc """
  Phoenix LiveView function component that mounts a Fresco viewer.

  Renders a host `<div>` containing a stage `<div>` and an `<img>`. The
  companion JS hook (`FrescoViewer` in `priv/static/fresco.js`) attaches
  Pointer Events for unified mouse/touch/pen gestures, applies
  `transform: translate3d(tx, ty, 0) scale(s)` on the stage element, and
  publishes a handle to `window.Fresco.viewerFor(id)` so peer extensions
  (Tessera, future Etcher) can attach.

  The image is server-rendered inside the host so it appears immediately —
  the hook reads `naturalWidth/Height` on mount and fits the image into
  the viewport without any "blank box" flash.

  ## Usage

      <Fresco.viewer
        id="photo"
        src={~p"/uploads/photo.jpg"}
        class="w-full h-[80vh] rounded"
      />

  ## Interactions

  - **Pan**: click/touch drag, arrow keys (after focusing the viewer)
  - **Zoom**: mouse wheel (centered on cursor), pinch (two-finger on touch
    or trackpad), double-click (2× centered on cursor), `+`/`-` keys
  - **Reset**: nav button, `0` key — fits the image to the viewport
  - **Fullscreen**: nav button, `f` key — toggles native browser fullscreen

  ## Parent app setup

  Import the JS hook and spread `FrescoHooks` into your LiveSocket hooks:

      import "../../deps/fresco/priv/static/fresco.js"

      let liveSocket = new LiveSocket("/live", Socket, {
        hooks: { ...window.FrescoHooks, ...colocatedHooks }
      })
  """

  use Phoenix.Component

  attr(:id, :string, required: true, doc: "DOM id; must be unique on the page.")

  attr(:src, :string,
    required: true,
    doc: """
    URL of the image to display.

    The default behavior treats `src` as a plain image URL. Extensions can
    register source providers via `window.Fresco.registerSourceProvider/2`
    to intercept specific URL patterns; the bundled engine handles
    `{type: "image"}` sources and throws a clear error for anything else
    (Tessera-style tile sources are planned for a later release).
    """
  )

  attr(:class, :string, default: "w-full h-96", doc: "CSS classes for the viewer container.")

  attr(:infinite_canvas, :boolean,
    default: false,
    doc: """
    When `true`, drops the default "image must cover viewport" clamp so the
    user can pan freely beyond the image edges and zoom out until the image
    is a thumbnail in the middle of an empty canvas. The viewer's
    background dot-grid (always present) becomes visible in the void around
    the image so it reads as "canvas," not "broken layout." Default
    `false` keeps the stock single-image viewer behavior — pan stays
    location-locked inside the image, zoom-out floor is fit-to-viewport.

    Pairs naturally with future layered overlays (e.g. Etcher annotations)
    that need to draw shapes, callouts, or labels in the white space
    around the image, Figma/Miro/Excalidraw style.
    """
  )

  attr(:theme, :atom,
    values: [:system, :light, :dark, :inherit],
    default: :system,
    doc: """
    Color scheme for the viewer host background, dot grid, and nav
    buttons.

    - `:system` (default) — follow the OS / browser `prefers-color-scheme`.
    - `:light` — force light palette regardless of OS preference.
    - `:dark` — force dark palette regardless of OS preference.
    - `:inherit` — emit only the host structure; the parent app's CSS
      supplies the six `--fresco-*` custom properties. Use this to wire
      Fresco to a parent theme system (daisyUI, custom palettes, …).

    Theming is implemented as CSS custom properties on `.fresco-viewer`
    (`--fresco-bg`, `--fresco-grid-dot`, `--fresco-nav-bg`,
    `--fresco-nav-bg-hover`, `--fresco-nav-fg`, `--fresco-nav-focus`).
    """
  )

  attr(:rest, :global)

  @doc """
  Renders a Fresco viewer for the given image source.

  Companion JS hook attaches gesture handlers, fits the image to the
  viewport, and publishes the handle for peer extensions.
  """
  def viewer(assigns) do
    ~H"""
    <div
      id={@id}
      phx-hook="FrescoViewer"
      phx-update="ignore"
      data-src={@src}
      data-infinite-canvas={to_string(@infinite_canvas)}
      data-fresco-theme={to_string(@theme)}
      class={[
        "fresco-viewer",
        @class,
        @infinite_canvas && "fresco-viewer--infinite"
      ]}
      tabindex="0"
      {@rest}
    >
      <div class="fresco-stage" data-fresco-stage>
        <img src={@src} alt="" draggable="false" data-fresco-img />
      </div>
    </div>
    """
  end
end
