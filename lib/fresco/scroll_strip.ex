defmodule Fresco.ScrollStrip do
  @moduledoc """
  Phoenix LiveView function component for vertical-image-strip scrolling.

  Use this for content that is **read by scrolling continuously** through
  a stack of full-width images: manhwa, long-form comics, IG-style feeds,
  documentation snapshots. For deep-zoom imagery (museum scans, single
  mega-images you pan/zoom around), use `Fresco.viewer` instead.

  ## Why a separate component?

  `Fresco.viewer` wraps OpenSeadragon, which redraws its `<canvas>` on
  every pan frame. For long-scroll content on mobile (especially iOS
  Safari) this burns 10-20ms per frame and chokes 60fps scroll. Native
  browser scroll on DOM `<img>` is GPU-composited and effectively free
  per frame.

  `ScrollStrip` skips OSD entirely: one `<img loading="lazy">` per
  source, native scroll, no canvas, no spring math, no per-frame JS.
  Memory windowing evicts off-screen image `src` attributes (preserving
  layout via `aspect-ratio`) so a 50-image chapter doesn't pin 600 MB of
  decoded pixels.

  ## Usage

      <Fresco.scrollStrip
        id="reader"
        sources={[
          %{url: "/img/page-01.jpg", width: 720, height: 9200},
          %{url: "/img/page-02.jpg", width: 720, height: 8800},
          %{url: "/img/page-03.jpg", width: 720, height: 9100}
        ]}
        class="w-full h-lvh"
      />

  Each source map MUST include `:width` and `:height` in source pixels —
  used to set inline `aspect-ratio` per `<img>`, which keeps the layout
  stable through memory-windowing evict/restore cycles. Omitting them
  raises `ArgumentError` at render time.

  ## Handle API

  Look up the strip handle once it's mounted:

      window.Fresco.onReady("reader", function (handle) {
        handle.scrollTo({imageIdx: 3, y: 0, behavior: "smooth"});
        handle.scrollBy({dy: 500, behavior: "instant"});
        handle.getScrollState(); // { scrollTop, scrollHeight, viewportH, currentImageIdx, fractionWithin }

        handle.on("viewport-change", function (e) {
          // e.currentImageIdx, e.fractionWithin
        });
        handle.on("image-loaded", function (e) { /* e.imageIdx */ });
        handle.on("image-evicted", function (e) { /* e.imageIdx */ });
        handle.on("scroll", function (e) { /* e.scrollTop, e.scrollHeight */ });
        handle.on("open", function (e) { /* e.sources */ });
      });

  See README "Strip mode for long-scroll content" for the full contract,
  including: the difference between viewer and strip handles, why
  `handle.openSeadragon` throws on strip (use feature detection like
  `"scrollTo" in handle`), and the Etcher >= 0.3 requirement for
  annotations on strip mode.

  ## Server-pushed scrolling

  Push `phx:scroll-to` from your LiveView to programmatically scroll —
  useful for chapter-resume restoration:

      push_event(socket, "phx:scroll-to", %{imageIdx: 5, y: 0, behavior: "smooth"})

  The hook forwards the payload straight to `handle.scrollTo/1`.
  """

  use Phoenix.Component

  alias Phoenix.Component

  attr(:id, :string, required: true, doc: "DOM id; must be unique on the page.")

  attr(:sources, :list,
    required: true,
    doc: """
    Ordered list of images to render as a vertical strip. Each entry is
    a map:

        %{
          url: "/uploads/page-01.jpg",  # required — image URL
          width: 720,                    # required — source pixel width
          height: 9000                   # required — source pixel height
        }

    `width` and `height` are mandatory so the component can emit
    `aspect-ratio: <w> / <h>` on each `<img>`. That preserves layout
    through memory-windowing evict/restore cycles (removing `src`
    doesn't collapse the slot to 0px → no scroll-position jumps) and
    avoids cumulative layout shift before images decode.
    """
  )

  attr(:class, :string,
    default: "w-full h-screen",
    doc: "CSS classes for the scroll container. Defaults to `w-full h-screen`."
  )

  attr(:theme, :atom,
    values: [:system, :light, :dark, :inherit],
    default: :system,
    doc: """
    Color scheme for the strip's container background and scrollbar.
    Same semantics as `Fresco.viewer`'s `:theme`. With `:inherit`,
    define the `--fresco-*` custom properties on `.fresco-strip[data-fresco-theme="inherit"]`
    in your CSS.
    """
  )

  attr(:window_before, :integer,
    default: 1,
    doc: """
    Memory windowing: how many images *before* the current dominant
    image to keep loaded. Default `1`. Images outside the
    `[current - window_before, current + window_after]` range get
    their `src` evicted to free decoded-image memory; they restore
    on re-entry.
    """
  )

  attr(:window_after, :integer,
    default: 3,
    doc: """
    Memory windowing: how many images *after* the current dominant
    image to keep loaded. Default `3` (skewed forward because scroll
    is typically downward and prefetching ahead avoids visible loads).
    """
  )

  attr(:gap_px, :integer,
    default: 0,
    doc: """
    Spacing between images, in CSS pixels. Default `0` (manhwa /
    long-comic convention — gutters live inside the image, not
    between images). Set to `8` or `16` for IG-feed-style layouts
    where each image is its own card.
    """
  )

  attr(:snap_to_image, :atom,
    values: [:off, :mandatory, :proximity],
    default: :off,
    doc: """
    CSS `scroll-snap` behavior for the container.

    - `:off` (default) — no snap; native scroll.
    - `:mandatory` — `scroll-snap-type: y mandatory`. Always locks the
      viewport to an image top. Right for short-image-per-screen
      content (IG-style feeds, slide decks).
    - `:proximity` — `scroll-snap-type: y proximity`. Snaps only if
      the user releases near a snap point.

    For tall continuous content (manhwa pages at 7-9k px), keep at
    `:off` — snap would either lock you to image tops (`:mandatory`)
    or yank mid-read (`:proximity`).
    """
  )

  attr(:rest, :global)

  @doc """
  Renders a vertical-image-strip scroll container.

  Each source becomes a `<img loading="lazy">` inside the scroll
  container, with inline `aspect-ratio` set from the source's
  `width`/`height`. The companion JS hook (`FrescoScrollStrip`) attaches
  on mount and wires the scroll bridge + memory windowing + handle
  registry.
  """
  def scroll_strip(assigns) do
    assigns =
      assigns
      |> validate_sources!()
      |> Component.assign(:sources_json, Jason.encode!(assigns.sources))
      |> Component.assign(:gap_px_int, assigns.gap_px)
      |> Component.assign(:snap_to_image, assigns.snap_to_image)

    ~H"""
    <div
      id={@id}
      phx-hook="FrescoScrollStrip"
      data-sources={@sources_json}
      data-window-before={Integer.to_string(@window_before)}
      data-window-after={Integer.to_string(@window_after)}
      data-gap-px={Integer.to_string(@gap_px_int)}
      data-snap={Atom.to_string(@snap_to_image)}
      data-fresco-theme={to_string(@theme)}
      class={["fresco-strip", "overflow-y-auto", scroll_snap_class(@snap_to_image), @class]}
      {@rest}
    >
      <%= for {src, idx} <- Enum.with_index(@sources) do %>
        <img
          src={src.url}
          data-src={src.url}
          data-fresco-strip-img=""
          data-image-idx={Integer.to_string(idx)}
          alt=""
          loading="lazy"
          decoding="async"
          style={img_style(src, idx, length(@sources), @gap_px_int)}
        />
      <% end %>
    </div>
    """
  end

  # ── validation ──────────────────────────────────────────────────────────

  defp validate_sources!(%{sources: []}) do
    raise ArgumentError,
          "Fresco.scrollStrip requires a non-empty :sources list"
  end

  defp validate_sources!(%{sources: sources} = assigns) when is_list(sources) do
    Enum.each(sources, fn src ->
      unless is_map(src) and is_integer(Map.get(src, :width)) and Map.get(src, :width) > 0 and
               is_integer(Map.get(src, :height)) and Map.get(src, :height) > 0 and
               is_binary(Map.get(src, :url)) do
        raise ArgumentError,
              "Fresco.scrollStrip :sources entries require :url (string), :width (positive integer), " <>
                "and :height (positive integer). Got: #{inspect(src)}"
      end
    end)

    assigns
  end

  defp validate_sources!(_),
    do: raise(ArgumentError, "Fresco.scrollStrip :sources must be a list")

  # ── rendering helpers ──────────────────────────────────────────────────

  defp img_style(src, idx, total, gap_px) do
    base = "display: block; width: 100%; aspect-ratio: #{src.width} / #{src.height};"

    if gap_px > 0 and idx < total - 1 do
      base <> " margin-bottom: #{gap_px}px;"
    else
      base
    end
  end

  defp scroll_snap_class(:off), do: nil
  defp scroll_snap_class(:mandatory), do: "fresco-strip--snap-mandatory"
  defp scroll_snap_class(:proximity), do: "fresco-strip--snap-proximity"
end
