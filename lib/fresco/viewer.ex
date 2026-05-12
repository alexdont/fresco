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
    required: true,
    doc: """
    URL of the image to display. Default behavior treats it as a plain image
    (`.jpg`, `.png`, `.webp`, etc.). Source providers registered via
    `window.Fresco.registerSourceProvider/2` can intercept specific URL
    patterns (e.g., Tessera handles `.dzi` manifests).
    """
  )

  attr(:class, :string, default: "w-full h-96", doc: "CSS classes for the viewer container.")
  attr(:rest, :global)

  @doc """
  Renders a Fresco viewer for the given image source.

  Companion JS hook lazy-loads OpenSeadragon, mounts the viewer, attaches
  the nav overlay, and publishes the handle for peer extensions.
  """
  def viewer(assigns) do
    ~H"""
    <div
      id={@id}
      phx-hook="FrescoViewer"
      data-src={@src}
      class={@class}
      {@rest}
    >
    </div>
    """
  end
end
