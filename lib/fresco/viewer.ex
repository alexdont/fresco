defmodule Fresco.Viewer do
  @moduledoc """
  Phoenix LiveView function component that mounts a Fresco viewer.

  Renders a `<div>` with `phx-hook="FrescoViewer"`. The companion JS hook
  in `priv/static/fresco.js` lazy-loads OpenSeadragon from jsDelivr,
  initializes the viewer with sensible defaults (smooth animations,
  viewport clamped, Heroicons nav overlay), and publishes a handle to
  `window.Fresco.viewerFor(id)` so peer extensions can attach.

  ## Usage

      <Fresco.viewer
        id="photo"
        src={~p"/uploads/photo.jpg"}
        class="w-full h-[80vh] rounded"
      />

  ## Source detection

  The default behavior treats `src` as a plain image URL. Extensions can
  register source providers via `window.Fresco.registerSourceProvider/2`
  to handle other formats (e.g., a DZI manifest URL via Tessera).

  ## Interactions

  Wheel-zoom, pinch-zoom, click-drag pan, double-click zoom, Heroicons
  nav buttons (zoom in / zoom out / reset / fullscreen). All work out of
  the box; no parent configuration needed.

  ## Parent app setup

  Import the JS hook and spread `FrescoHooks` into your LiveSocket
  hooks:

      import "../../deps/fresco/priv/static/fresco.js"

      let liveSocket = new LiveSocket("/live", Socket, {
        hooks: { ...window.FrescoHooks, ...colocatedHooks }
      })
  """

  use Phoenix.Component

  attr(:id, :string, required: true, doc: "DOM id; must be unique on the page.")

  attr(:src, :string,
    default: nil,
    doc: """
    URL of a single image to display — shortcut for one-image viewers.
    Treated as a plain image (`.jpg`, `.png`, `.webp`, etc.) by default;
    source providers registered via `window.Fresco.registerSourceProvider/2`
    can intercept specific URL patterns (e.g., Tessera handles `.dzi`
    manifests).

    Exactly one of `:src` or `:sources` is required. If both are
    given, `:sources` wins and `:src` is ignored.
    """
  )

  attr(:sources, :list,
    default: [],
    doc: """
    List of images to lay out on a shared canvas. Each entry is a map:

        %{
          src: "/uploads/a.jpg",   # required — image URL
          x: 0.0,                  # optional — horizontal offset in viewport units (default 0)
          y: 0.0,                  # optional — vertical offset in viewport units (default 0)
          width: 1.0               # optional — width in viewport units (default 1)
        }

    Viewport units: the *first* image is conventionally placed at
    `x: 0, y: 0` with `width: 1`. So `x: 1.1` puts the next image just
    to the right with a 10% gap. Height is derived from the image's
    natural aspect ratio — you don't specify it.

    Each entry's `src` runs through the same source-provider chain as
    the single-image `:src`, so a multi-image viewer can mix plain
    images with DZI tile pyramids handled by Tessera.

    Typically paired with `:infinite_canvas` so the user can pan
    freely across the layout. Without it, OSD will fit-to-viewport
    over the bounding box of all sources at mount.

    Note: `handle.imageToScreen` / `screenToImage` currently operate
    on the first source only. Multi-image coordinate disambiguation
    is planned but not yet implemented.
    """
  )

  attr(:class, :string, default: "w-full h-96", doc: "CSS classes for the viewer container.")

  attr(:infinite_canvas, :boolean,
    default: false,
    doc: """
    When `true`, drops OSD's "keep the image filling the viewport" clamps
    so the user can pan freely beyond the image edges and zoom out until
    the image is a thumbnail in the middle of an empty canvas. The viewer
    background picks up a subtle dot-grid pattern in the void so it
    reads as "canvas," not "broken layout." Default `false` preserves
    the stock single-image viewer behavior — every existing call site
    keeps working unchanged.

    Layered overlays (e.g. Etcher) can draw annotations in the void
    around the image because their coordinate math already supports
    out-of-bounds image-pixel values.

    Pairs naturally with `:sources` to lay multiple images out on
    the same canvas, Figma/Miro style.
    """
  )

  attr(:rotate, :boolean,
    default: false,
    doc: """
    When `true`, appends a rotation button to the nav overlay that rotates
    the image 90° clockwise on each click. Rotation persists across
    "Reset view" — it's tracked independently of zoom/pan. Default
    `false` keeps the four-button stock nav layout. Opt-in like
    `:infinite_canvas` so existing consumers aren't surprised by an
    extra button.
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
      Fresco to a parent theme system (daisyUI, custom palettes, …) so
      its background, grid, and nav follow the parent theme. The
      variables flip automatically as the parent theme changes.

    Theming is implemented as CSS custom properties on `.fresco-viewer`
    (`--fresco-bg`, `--fresco-grid-dot`, `--fresco-nav-bg`,
    `--fresco-nav-bg-hover`, `--fresco-nav-fg`, `--fresco-nav-focus`).
    With `:system`/`:light`/`:dark`, Fresco supplies the values. With
    `:inherit`, the parent app does — see the Theming section of the
    README for the daisyUI mapping example.
    """
  )

  attr(:rest, :global)

  @doc """
  Renders a Fresco viewer for the given image source(s).

  Companion JS hook lazy-loads OpenSeadragon, mounts the viewer, attaches
  the nav overlay, and publishes the handle for peer extensions.
  """
  def viewer(assigns) do
    assigns =
      assigns
      |> validate_sources!()
      |> assign_sources_json()

    ~H"""
    <div
      id={@id}
      phx-hook="FrescoViewer"
      phx-update="ignore"
      data-src={@src}
      data-sources={@sources_json}
      data-infinite-canvas={to_string(@infinite_canvas)}
      data-rotate={to_string(@rotate)}
      data-fresco-theme={to_string(@theme)}
      class={[
        "fresco-viewer",
        @class,
        @infinite_canvas && "fresco-viewer--infinite"
      ]}
      {@rest}
    >
    </div>
    """
  end

  defp validate_sources!(%{src: nil, sources: []}) do
    raise ArgumentError,
          "Fresco.viewer requires either :src (single image) or a non-empty :sources list"
  end

  defp validate_sources!(assigns), do: assigns

  # JSON-encoded only when :sources is non-empty; otherwise nil so the
  # data-sources attribute is omitted from the rendered div and the JS
  # hook falls back to data-src.
  defp assign_sources_json(%{sources: []} = assigns),
    do: Phoenix.Component.assign(assigns, :sources_json, nil)

  defp assign_sources_json(%{sources: sources} = assigns) do
    Phoenix.Component.assign(assigns, :sources_json, Jason.encode!(sources))
  end
end
