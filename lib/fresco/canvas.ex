defmodule Fresco.Canvas do
  @moduledoc """
  `<Fresco.canvas>` — a layered scene of N images positioned at absolute
  coordinates on a virtual canvas, plus an open `extensions` map for
  annotation tools (future Etcher), ML overlays, and other peer packages.

  Single-image is just the N=1 case — use `Fresco.Viewer` when you want the
  bare "pan/zoom one image" component without the scene-document overhead.

  ## The `.fresco` file format

  Serializing a canvas yields a JSON document keyed by:

      {
        "version": "1",
        "canvas": { "width": 4000, "height": 3000, "background": null },
        "images": [
          {
            "id": "img-1",
            "src": "/uploads/a.jpg",
            "x": 0, "y": 0,
            "width": 2000,
            "z_index": 0,
            "natural_width": 2000,
            "natural_height": 1500
          }
        ],
        "extensions": {
          "etcher":     { "version": "1", "annotations": [...] },
          "ml-overlay": { ... }
        }
      }

  - **`canvas.width` / `canvas.height`** — the virtual canvas extent in
    canvas pixels. Reset-view fits this rectangle to the viewport.
  - **Images** are positioned at absolute canvas-pixel `(x, y)` with
    `width` in canvas pixels. Height is derived from natural aspect ratio
    if `natural_width` and `natural_height` are present (and saved into
    the file for forward compatibility).
  - **`extensions`** is an open map keyed by package name. Fresco never
    inspects the inside — each extension owns its own shape and version.
    Unknown extension keys are preserved verbatim across read/write so
    you can load → edit → save without losing data the current version
    doesn't understand.
  - **Read-time forward-compatibility:** any unknown top-level or
    per-image key is preserved through a private `__extra__` map and
    re-merged on write. A v1 reader of a future v2 file keeps the v2
    fields it doesn't understand and writes them back unchanged.

  ## Building a canvas

      iex> canvas =
      ...>   Fresco.Canvas.new(width: 4000, height: 3000)
      ...>   |> Fresco.Canvas.add_image(%{src: "/a.jpg", x: 0, y: 0, width: 2000})
      ...>   |> Fresco.Canvas.add_image(%{src: "/b.jpg", x: 2100, y: 0, width: 1800})
      ...>   |> Fresco.Canvas.put_extension("etcher", %{"version" => "1", "annotations" => []})
      iex> Enum.map(canvas.images, & &1.id)
      ["img-1", "img-2"]

  ## File I/O

      Fresco.Canvas.write!("/tmp/scene.fresco", canvas)
      canvas = Fresco.Canvas.read!("/tmp/scene.fresco")

  Writes are atomic: `write/2` writes to `<path>.tmp` then renames, so an
  interrupted save can't corrupt an existing file.

  ## Extension contract — passive Fresco

  Fresco is passive with respect to `extensions`. The file is the source
  of truth; updates flow consumer LiveView → `%Fresco.Canvas{}` in
  assigns → re-render. A peer package like the future Etcher reads its
  initial state via `handle.getExtension("etcher")` at mount, pushes
  edits to its own LiveView, which calls
  `Fresco.Canvas.put_extension(canvas, "etcher", new_data)` and
  re-assigns. Fresco's handle is intentionally read-only for extensions
  — no `setExtension` method exists, so save timing is never racing
  with annotation updates over channels.

  ## Replacing the image set in place — `handle.setSources/2`

  `handle.setSources(sources, opts)` swaps the canvas's whole image set
  without remounting the DOM, so state tied to the page session — Pointer
  Lock, audio/video pipelines, peer overlays bound via `handle.on(...)` —
  survives. It's the in-place alternative to a full navigation; consumers
  building paged readers use it for instant chapter transitions.

      await handle.setSources(images, {
        reset_view: true,                                  # fit-to-canvas after swap (default)
        extensions: %{ etcher: %{ annotations: shapes } }  # optional, replaced atomically
      })

  `sources` is an array of `%{src, x?, y?, width?, height?, id?, z_index?}`
  (the `getImages()` shape). `opts`:

    * `reset_view` (default `true`) — fit to the new canvas after the swap;
      `false` keeps the current pan/zoom (clamped to the new bounds).
    * `extensions` — replaces the canvas-level extension map atomically with
      the swap (omitted → the current map is left untouched).
    * `canvasWidth` / `canvasHeight` — explicit canvas extent; omitted →
      derived from the new images' bounding box.

  Returns a Promise that resolves after the first post-swap frame paints
  (the new images are positioned/sized), so `imageBoundsFor(...)` returns
  measurable rects on the next line; it rejects on empty/malformed input
  (so the consumer can fall back to a full navigation). It clears the
  hidden-image set (`setImageVisible` bookkeeping doesn't carry across a
  swap), fires `open` and a dedicated `sources-changed` event so overlays
  bound to those rebuild, and is programmatic-only — the consumer owns
  persistence, URL history, etc.

  ## Per-image helpers (paged readers)

  Paged readers that show one page at a time and cycle a "load window" of
  in-flight images use two companions, both on the canvas handle:

    * `handle.setImageVisible(id, visible)` — toggles one image's visibility.
      The inline style flips **synchronously**, so a `getBoundingClientRect`
      / `imageBoundsFor` read on the next line sees the new state.
    * `handle.setImageSrc(id, url)` — swaps a single image's `src` (real URL
      ↔ placeholder) without a full relayout, re-latching load tracking so
      `image-loaded` fires on the new source.

  After any such mutation, `await handle.whenLayoutSettled()` resolves once
  the next frame has painted, for consumers that need to measure between
  swaps.

  See `Fresco.Viewer` for the simpler single-image component, and
  `Fresco.ScrollStrip` for the long-scroll reader counterpart.
  """

  use Phoenix.Component

  defstruct version: "1",
            canvas: %{width: 0, height: 0, background: nil, __extra__: %{}},
            images: [],
            extensions: %{},
            __extra__: %{}

  @type image :: %{
          required(:id) => String.t(),
          required(:src) => String.t(),
          required(:x) => number(),
          required(:y) => number(),
          required(:width) => number(),
          optional(:z_index) => integer(),
          optional(:natural_width) => number(),
          optional(:natural_height) => number(),
          optional(:__extra__) => map()
        }

  @type t :: %__MODULE__{
          version: String.t(),
          canvas: %{
            required(:width) => number(),
            required(:height) => number(),
            optional(:background) => String.t() | nil
          },
          images: [image()],
          extensions: %{optional(String.t()) => any()},
          __extra__: map()
        }

  @known_top_level ~w(version canvas images extensions)
  @known_image_keys ~w(id src x y width z_index natural_width natural_height)

  # ──────────────────────────────────────────────────────────────────────
  # Builders
  # ──────────────────────────────────────────────────────────────────────

  @doc """
  Build a new empty canvas.

  Options:
    * `:width` — virtual canvas width in canvas pixels (default `0`)
    * `:height` — virtual canvas height (default `0`)
    * `:background` — optional CSS color string for the stage background
  """
  def new(opts \\ []) do
    %__MODULE__{
      canvas: %{
        width: Keyword.get(opts, :width, 0),
        height: Keyword.get(opts, :height, 0),
        background: Keyword.get(opts, :background),
        __extra__: %{}
      }
    }
  end

  @doc """
  Append an image to the canvas.

  Required attrs: `:src` (string URL/path), `:x`, `:y`, `:width` (numbers,
  width > 0). Optional: `:id` (auto-assigned `img-N` when omitted),
  `:z_index`, `:natural_width`, `:natural_height`.

  Raises `ArgumentError` on invalid attrs.
  """
  def add_image(%__MODULE__{} = canvas, attrs) when is_map(attrs) do
    image = build_image!(attrs, next_id(canvas))
    %{canvas | images: canvas.images ++ [image]}
  end

  def add_image(%__MODULE__{}, _),
    do: raise(ArgumentError, "Fresco.Canvas.add_image/2 expects a map of attrs")

  @doc """
  Put or overwrite an extension blob keyed by `name` (binary or atom).

  Fresco never inspects the contents — each peer package owns the inner
  shape and self-versions inside its own blob.
  """
  def put_extension(%__MODULE__{} = canvas, name, value)
      when is_binary(name) or is_atom(name) do
    %{canvas | extensions: Map.put(canvas.extensions, to_string(name), value)}
  end

  defp build_image!(attrs, default_id) do
    id = Map.get(attrs, :id) || Map.get(attrs, "id") || default_id
    src = Map.get(attrs, :src) || Map.get(attrs, "src")
    x = Map.get(attrs, :x) || Map.get(attrs, "x") || 0
    y = Map.get(attrs, :y) || Map.get(attrs, "y") || 0
    width = Map.get(attrs, :width) || Map.get(attrs, "width")

    unless is_binary(id) and id != "",
      do: raise(ArgumentError, "image :id must be a non-empty string, got #{inspect(id)}")

    unless is_binary(src) and src != "",
      do: raise(ArgumentError, "image :src must be a non-empty string, got #{inspect(src)}")

    unless is_number(x),
      do: raise(ArgumentError, "image :x must be a number, got #{inspect(x)}")

    unless is_number(y),
      do: raise(ArgumentError, "image :y must be a number, got #{inspect(y)}")

    unless is_number(width) and width > 0,
      do: raise(ArgumentError, "image :width must be a positive number, got #{inspect(width)}")

    base = %{id: id, src: src, x: x, y: y, width: width, __extra__: %{}}
    base = maybe_put_number(base, attrs, :z_index, "z_index")
    base = maybe_put_number(base, attrs, :natural_width, "natural_width")
    maybe_put_number(base, attrs, :natural_height, "natural_height")
  end

  defp maybe_put_number(map, attrs, key, str_key) do
    case Map.get(attrs, key) || Map.get(attrs, str_key) do
      nil -> map
      v when is_number(v) -> Map.put(map, key, v)
      v -> raise(ArgumentError, "image :#{key} must be a number, got #{inspect(v)}")
    end
  end

  defp next_id(%__MODULE__{images: images}) do
    "img-#{length(images) + 1}"
  end

  # ──────────────────────────────────────────────────────────────────────
  # Serialization — JSON in/out, atomic file I/O
  # ──────────────────────────────────────────────────────────────────────

  @doc """
  Serialize a canvas to a JSON string. Returns `{:ok, json}` or
  `{:error, reason}` (only on Jason encode failure — schema is validated
  at struct-construction time).
  """
  def to_json(%__MODULE__{} = canvas) do
    Jason.encode(canvas_to_jsonable(canvas))
  end

  @doc "Serialize a canvas to a JSON string. Raises on encode failure."
  def to_json!(%__MODULE__{} = canvas) do
    Jason.encode!(canvas_to_jsonable(canvas))
  end

  @doc """
  Parse a JSON string into a canvas struct. Returns `{:ok, canvas}` or
  `{:error, %Fresco.Canvas.SchemaError{}}`.

  Unknown top-level and per-image keys are preserved via a private
  `__extra__` map; round-tripping through `to_json/from_json` keeps them
  intact so v1 readers of a future v2 file don't lose v2-only data.
  """
  def from_json(json) when is_binary(json) do
    case Jason.decode(json) do
      {:ok, raw} when is_map(raw) -> map_to_canvas(raw)
      {:ok, _} -> {:error, %Fresco.Canvas.SchemaError{path: [], reason: :not_a_map}}
      {:error, reason} -> {:error, %Fresco.Canvas.SchemaError{path: [], reason: {:json, reason}}}
    end
  end

  @doc "Parse a JSON string into a canvas struct. Raises on invalid input."
  def from_json!(json) do
    case from_json(json) do
      {:ok, canvas} ->
        canvas

      {:error, %Fresco.Canvas.SchemaError{} = err} ->
        raise err
    end
  end

  @doc """
  Write a canvas to disk atomically. Writes to `<path>.tmp` first then
  renames so an interrupted save can't corrupt the existing file.

  Returns `{:ok, path}` or `{:error, reason}`.
  """
  def write(path, %__MODULE__{} = canvas) when is_binary(path) do
    with {:ok, json} <- to_json(canvas),
         tmp = path <> ".tmp",
         :ok <- File.write(tmp, json),
         :ok <- File.rename(tmp, path) do
      {:ok, path}
    else
      {:error, _} = err ->
        _ = File.rm(path <> ".tmp")
        err
    end
  end

  @doc "Write a canvas to disk atomically. Raises on failure."
  def write!(path, %__MODULE__{} = canvas) do
    case write(path, canvas) do
      {:ok, _} -> :ok
      {:error, reason} -> raise File.Error, reason: reason, action: "write to", path: path
    end
  end

  @doc "Read a canvas from disk. Returns `{:ok, canvas}` or `{:error, reason}`."
  def read(path) when is_binary(path) do
    with {:ok, json} <- File.read(path) do
      from_json(json)
    end
  end

  @doc "Read a canvas from disk. Raises on failure."
  def read!(path) when is_binary(path) do
    path |> File.read!() |> from_json!()
  end

  # ── JSON ↔ struct helpers (private) ───────────────────────────────────

  defp canvas_to_jsonable(%__MODULE__{} = c) do
    # Strict known-keys first, then merge __extra__ — base wins on conflicts
    # so structural fields can't be corrupted by garbage in extras.
    base = %{
      "version" => c.version,
      "canvas" => canvas_meta_to_jsonable(c.canvas),
      "images" => Enum.map(c.images, &image_to_jsonable/1),
      "extensions" => c.extensions
    }

    Map.merge(c.__extra__ || %{}, base)
  end

  defp canvas_meta_to_jsonable(canvas) do
    base = %{
      "width" => Map.get(canvas, :width, 0),
      "height" => Map.get(canvas, :height, 0),
      "background" => Map.get(canvas, :background)
    }

    Map.merge(Map.get(canvas, :__extra__, %{}) || %{}, base)
  end

  defp image_to_jsonable(img) do
    base =
      img
      |> Map.delete(:__extra__)
      |> Enum.into(%{}, fn {k, v} -> {Atom.to_string(k), v} end)

    Map.merge(Map.get(img, :__extra__, %{}) || %{}, base)
  end

  defp map_to_canvas(raw) when is_map(raw) do
    with :ok <- validate_version(raw),
         {:ok, canvas_meta} <- validate_canvas_meta(raw),
         {:ok, images} <- validate_images(raw),
         :ok <- validate_extensions(raw) do
      extras = Map.drop(raw, @known_top_level)

      canvas = %__MODULE__{
        version: raw["version"],
        canvas: canvas_meta,
        images: images,
        extensions: raw["extensions"] || %{},
        __extra__: extras
      }

      {:ok, canvas}
    end
  end

  defp validate_version(%{"version" => "1"}), do: :ok

  defp validate_version(%{"version" => v}),
    do: {:error, %Fresco.Canvas.SchemaError{path: [:version], reason: {:unsupported_version, v}}}

  defp validate_version(_),
    do: {:error, %Fresco.Canvas.SchemaError{path: [:version], reason: :missing}}

  defp validate_canvas_meta(%{"canvas" => canvas}) when is_map(canvas) do
    width = Map.get(canvas, "width")
    height = Map.get(canvas, "height")

    cond do
      not (is_number(width) and width > 0) ->
        {:error,
         %Fresco.Canvas.SchemaError{
           path: [:canvas, :width],
           reason: {:expected_positive_number, width}
         }}

      not (is_number(height) and height > 0) ->
        {:error,
         %Fresco.Canvas.SchemaError{
           path: [:canvas, :height],
           reason: {:expected_positive_number, height}
         }}

      true ->
        extras = Map.drop(canvas, ["width", "height", "background"])

        {:ok,
         %{
           width: width,
           height: height,
           background: Map.get(canvas, "background"),
           __extra__: extras
         }}
    end
  end

  defp validate_canvas_meta(_),
    do: {:error, %Fresco.Canvas.SchemaError{path: [:canvas], reason: :missing_or_not_a_map}}

  defp validate_images(%{"images" => images}) when is_list(images) do
    case do_validate_images(images, [], MapSet.new(), 0) do
      {:ok, normalized} -> {:ok, Enum.reverse(normalized)}
      {:error, _} = err -> err
    end
  end

  defp validate_images(%{"images" => other}),
    do: {:error, %Fresco.Canvas.SchemaError{path: [:images], reason: {:expected_list, other}}}

  defp validate_images(_), do: {:ok, []}

  defp do_validate_images([], acc, _ids, _idx), do: {:ok, acc}

  defp do_validate_images([raw | rest], acc, ids, idx) when is_map(raw) do
    with {:ok, img} <- validate_image(raw, idx),
         :ok <- check_unique_id(img.id, ids, idx) do
      do_validate_images(rest, [img | acc], MapSet.put(ids, img.id), idx + 1)
    end
  end

  defp do_validate_images([_other | _], _acc, _ids, idx),
    do: {:error, %Fresco.Canvas.SchemaError{path: [:images, idx], reason: :not_a_map}}

  defp validate_image(raw, idx) do
    id = Map.get(raw, "id")
    src = Map.get(raw, "src")
    x = Map.get(raw, "x")
    y = Map.get(raw, "y")
    width = Map.get(raw, "width")

    cond do
      not (is_binary(id) and id != "") ->
        {:error,
         %Fresco.Canvas.SchemaError{
           path: [:images, idx, :id],
           reason: {:expected_nonempty_string, id}
         }}

      not (is_binary(src) and src != "") ->
        {:error,
         %Fresco.Canvas.SchemaError{
           path: [:images, idx, :src],
           reason: {:expected_nonempty_string, src}
         }}

      not is_number(x) ->
        {:error,
         %Fresco.Canvas.SchemaError{path: [:images, idx, :x], reason: {:expected_number, x}}}

      not is_number(y) ->
        {:error,
         %Fresco.Canvas.SchemaError{path: [:images, idx, :y], reason: {:expected_number, y}}}

      not (is_number(width) and width > 0) ->
        {:error,
         %Fresco.Canvas.SchemaError{
           path: [:images, idx, :width],
           reason: {:expected_positive_number, width}
         }}

      true ->
        extras = Map.drop(raw, @known_image_keys)

        img = %{id: id, src: src, x: x, y: y, width: width, __extra__: extras}
        img = maybe_carry_number(img, raw, :z_index, "z_index", idx)
        img = maybe_carry_number(img, raw, :natural_width, "natural_width", idx)
        img = maybe_carry_number(img, raw, :natural_height, "natural_height", idx)
        {:ok, img}
    end
  end

  defp maybe_carry_number(img, raw, key, str_key, idx) do
    case Map.get(raw, str_key) do
      nil ->
        img

      v when is_number(v) ->
        Map.put(img, key, v)

      v ->
        raise Fresco.Canvas.SchemaError,
          path: [:images, idx, key],
          reason: {:expected_number, v}
    end
  end

  defp check_unique_id(id, ids, idx) do
    if MapSet.member?(ids, id),
      do:
        {:error,
         %Fresco.Canvas.SchemaError{path: [:images, idx, :id], reason: {:duplicate_id, id}}},
      else: :ok
  end

  defp validate_extensions(%{"extensions" => ext}) when is_map(ext), do: :ok

  defp validate_extensions(%{"extensions" => other}),
    do: {:error, %Fresco.Canvas.SchemaError{path: [:extensions], reason: {:expected_map, other}}}

  defp validate_extensions(_), do: :ok

  # ──────────────────────────────────────────────────────────────────────
  # Phoenix.Component — <Fresco.canvas>
  # ──────────────────────────────────────────────────────────────────────

  attr(:id, :string, required: true, doc: "DOM id; must be unique on the page.")

  attr(:canvas, __MODULE__,
    required: true,
    doc: """
    A `%Fresco.Canvas{}` struct describing the scene: virtual canvas
    extent, the list of images with their canvas-pixel positions, and an
    open `extensions` map. Build one via `Fresco.Canvas.new/1` +
    `Fresco.Canvas.add_image/2`, or load one from a `.fresco` file via
    `Fresco.Canvas.read!/1`.
    """
  )

  attr(:class, :string,
    default: "w-full h-96",
    doc: "CSS classes for the canvas host container."
  )

  attr(:infinite_canvas, :boolean,
    default: false,
    doc: """
    When `true`, drops the default "canvas must cover viewport" clamp so
    the user can pan freely beyond the canvas edges and zoom out until
    the whole layout is a thumbnail in the middle of an empty workspace.
    """
  )

  attr(:theme, :atom,
    values: [:system, :light, :dark, :inherit],
    default: :system,
    doc: "Color scheme. Same semantics as `Fresco.viewer`'s `:theme`."
  )

  attr(:zoom_floor, :float,
    default: nil,
    doc: """
    Optional minimum zoom scale, in engine units (screen-px-per-canvas-px).
    When set, the engine clamps every zoom path — wheel, pinch,
    double-click, `fitBounds` — at this floor. `nil` (default) falls
    through to the engine's normal floor (`sFit` clamped mode,
    `sFit * 0.05` infinite-canvas mode).

    Most often set at runtime via `handle.setZoomFloor(scale)` — paged
    readers recompute it each time the user navigates to a new page so
    the floor tracks the current page's fit-to-viewport scale, not the
    whole-canvas fit.
    """
  )

  attr(:zoom_ceiling, :float,
    default: nil,
    doc: """
    Optional maximum zoom scale. Symmetric to `:zoom_floor`. `nil`
    (default) uses the engine's default ceiling (8× canvas-pixel ratio
    capped by the 8192-px raster safety limit).
    """
  )

  attr(:pan_locked, :boolean,
    default: false,
    doc: """
    When `true`, single-pointer pan gestures (mouse drag, touch drag,
    arrow keys) are suppressed. Two-pointer pinch still works for
    zoom. Toggle at runtime via `handle.setPanLocked(true|false)`.
    """
  )

  attr(:initial_fit_image_id, :string,
    default: nil,
    doc: """
    If set, the engine lands at the fit-to-viewport position for the
    image with this `:id` at first paint instead of fitting the whole
    canvas. Avoids the brief flash of "whole-canvas visible" before an
    `onReady` callback re-fits.

    Falls back to canvas-wide fit (with a `console.warn`) if no image
    matches the id. If both `:initial_fit_image_id` and
    `:initial_fit_bounds` are provided, image-id wins.
    """
  )

  attr(:initial_fit_bounds, :map,
    default: nil,
    doc: """
    Like `:initial_fit_image_id` but for a custom rect. Map of
    `%{x: number, y: number, width: number, height: number}` in
    canvas-pixel coords. Serialized to JSON onto a `data-*` attr and
    parsed by the JS engine at mount.
    """
  )

  attr(:memory_window, :integer,
    default: nil,
    doc: """
    Auto-evict `src` for images more than this many viewport-widths/
    heights from the current viewport. Same memory-saving trick
    `<Fresco.scroll_strip>` uses, generalized to 2D canvas layouts.

    A value of `2` keeps a 5×5 viewport-rect window of images loaded
    around the current view (1 viewport in the center + 2 viewports of
    padding on each side). Default `nil` = disabled. Evicted images can
    be detected via `handle.on("image-evicted", e => ...)` /
    `image-restored` events.
    """
  )

  attr(:gestures, :list,
    default: nil,
    doc: """
    Allowlist of enabled gestures. Atom list:
    `[:pan, :pinch, :wheel, :double_click, :keyboard]`. Default `nil`
    enables all. Omitted entries are disabled.

    Useful for kiosks (drop `:keyboard`), swipe-paged readers that handle
    their own page-turn taps (drop `:double_click`), embedded viewers
    that defer scroll to the page (drop `:wheel`).

    `:wheel` covers everything that arrives as a wheel event, which is
    three gestures on modern hardware: a notch of a mouse wheel zooms,
    two fingers on a trackpad move the picture, and a pinch zooms (the
    browser reports it as a wheel with `ctrlKey` set, no key held). The
    trackpad pan also needs `:pan` — a host that turned panning off means
    it, whichever device asks — and, like a middle drag and a pinch, it
    keeps working while `pan_locked` is set, because that lock exists to
    free the left drag for a marquee or a drawing tool rather than to
    forbid panning.
    """
  )

  attr(:nav_buttons, :list,
    default: nil,
    doc: """
    Allowlist of enabled built-in nav buttons. Atom list:
    `[:home, :zoom_in, :zoom_out, :rotate, :rotate_left, :fullscreen]`.

    `:rotate` rotates clockwise (+90); `:rotate_left` is its
    counter-clockwise twin (-90), rendered just before it.

    - `nil` (default) — every button enabled (both rotate directions).
    - `[]` — every button **hidden**. Useful for consumers building
      their own chrome; wire your buttons to
      `handle.zoomIn()` / `handle.zoomOut()` /
      `handle.rotateRight()` / `handle.rotateLeft()` (or
      `handle.rotateBy(±90)`) / `handle.toggleFullscreen()` /
      `handle.requestHome()` to get identical behavior to the built-ins.
    - A subset list — only those buttons render (e.g. `[:rotate,
      :rotate_left]` for just the two rotate controls).
    """
  )

  attr(:initial_rotation, :integer,
    default: 0,
    doc: """
    Initial rotation in degrees, snapped to one of `{0, 90, 180, 270}`
    at mount time. Pre-0.5.7 behavior (no rotation) corresponds to
    `0`. Consumers persisting a per-canvas rotation choice (a
    rotated single panel inside a paged reader, for example) pass
    it here so the first paint already shows the rotated content
    — no flash of unrotated → rotated.

    Runtime control via `handle.setRotation(deg)` /
    `handle.rotateBy(delta)`, or the named quarter-turn helpers
    `handle.rotateRight()` (+90) / `handle.rotateLeft()` (-90) —
    the twins of the `:rotate` / `:rotate_left` nav buttons. Every
    one fires the `rotate` event, so with `persist_rotation` they all
    save the same way. Only the stage rotates — host element, nav
    overlay, and any consumer overlays outside the stage stay
    unrotated.
    """
  )

  attr(:persist_rotation, :boolean,
    default: false,
    doc: """
    Forwards the client-side `rotate` event to the server so a host can
    **persist** the user's chosen rotation. When `true`, the `FrescoCanvas`
    hook pushes a `"fresco:rotate"` LiveView event on every rotation change
    (rotate button, `handle.setRotation/rotateBy`, and the Reset-view snap
    back to home). Defaults to `false` so consumers who don't persist pay
    nothing — this is the only server round-trip Fresco makes.

    The event routes to whichever LiveView or LiveComponent owns the canvas
    element (standard hook `pushEvent` targeting). Payload:

        # handle_event("fresco:rotate", %{"id" => id, "rotation" => deg,
        #                                 "previous" => prev}, socket)

    `id` is the canvas element id (disambiguates multiple canvases);
    `rotation`/`previous` are degrees in `{0, 90, 180, 270}`. Pair with
    `:initial_rotation` (seed the saved angle on mount) to round-trip a
    persisted rotation.
    """
  )

  attr(:view_tracking, :boolean,
    default: false,
    doc: """
    Enables the `view-focus` / `view-blur` event channel for reading-
    time / engagement analytics. When `true`, the engine watches which
    image is dominant in the viewport and emits paired focus/blur
    events on the bus when that image changes. Defaults to `false` so
    consumers who don't subscribe pay zero cost.

    Consumer-side:

        handle.on("view-focus", e => {
          // e.imageId, e.previousImageId, e.atMs
        })

        handle.on("view-blur", e => {
          // e.imageId, e.durationMs, e.atMs, e.reason
          // e.reason ∈ "viewport-change" | "page-hidden" | "disabled" | "destroyed"
        })

    Runtime alternatives if you want to toggle tracking on/off without
    a re-render: `handle.enableViewTracking(opts)` /
    `handle.disableViewTracking()` / `handle.getFocusedImage()`.
    """
  )

  attr(:view_settle_ms, :integer,
    default: 150,
    doc: """
    Milliseconds the viewport must stay on a new dominant image before
    `view-focus` fires. Filters out pan-throughs and momentum-scroll
    fly-bys so analytics events only fire on actual reads. Only
    consulted when `:view_tracking` is `true`. Default `150`.
    """
  )

  attr(:view_threshold, :float,
    default: 0.5,
    doc: """
    Fraction of an image's area that must intersect the viewport for
    it to qualify as "dominant". Lower values make focus changes more
    eager; higher values make focus stickier. Only consulted when
    `:view_tracking` is `true`. Default `0.5`.
    """
  )

  attr(:rest, :global)

  @doc """
  Renders a Fresco canvas — N images positioned at absolute coordinates
  on a virtual canvas, with pan/zoom/fit/fullscreen identical to
  `Fresco.viewer`. Hooks the FrescoCanvas JS controller.

  ## Coordinate space

  Everything addressed through the canvas handle — `fitBounds`,
  `screenToImage` / `imageToScreen`, the canvas extent reported by
  `getCanvasSize()`, and any geometry persisted by peer libraries
  (Etcher shape geometry, ML overlay boxes) — is in **canvas-pixel
  space**: a single coordinate system that spans every image on the
  canvas, sized in the canvas's internal pixels (the `:width` /
  `:height` of the `:canvas` field on the `%Fresco.Canvas{}` struct).

  This is distinct from the per-image source-pixel space used by
  `<Fresco.scroll_strip>` / `<FrescoStrip.viewer>`, where geometry
  lives in each image's natural-pixel grid. Code consuming geometry
  off either viewer should know which space it's working in.
  """
  def canvas(assigns) do
    # Phoenix.Component's `attr :canvas, __MODULE__, required: true` enforces
    # that a `%Fresco.Canvas{}` struct is passed — nil mismatches the guard
    # before this body runs, so we don't need our own nil check.
    canvas_struct = assigns.canvas

    sorted_images =
      Enum.sort_by(canvas_struct.images, fn img -> Map.get(img, :z_index, 0) end)

    assigns =
      assigns
      |> assign(:canvas_struct, canvas_struct)
      |> assign(:sorted_images, sorted_images)
      |> assign(:extensions_json, Jason.encode!(canvas_struct.extensions))
      |> assign(:bg_style, background_style(canvas_struct.canvas))
      |> assign(:prefit?, prefit?(canvas_struct.canvas, sorted_images))
      |> assign(:initial_fit_bounds_json, encode_initial_bounds(assigns[:initial_fit_bounds]))
      |> assign(:gestures_csv, atoms_to_csv(assigns[:gestures]))
      |> assign(:nav_buttons_csv, atoms_to_csv(assigns[:nav_buttons]))

    ~H"""
    <div
      id={@id}
      phx-hook="FrescoCanvas"
      phx-update="ignore"
      data-canvas-width={canvas_dim(@canvas_struct.canvas, :width)}
      data-canvas-height={canvas_dim(@canvas_struct.canvas, :height)}
      data-extensions={@extensions_json}
      data-infinite-canvas={to_string(@infinite_canvas)}
      data-fresco-theme={to_string(@theme)}
      data-zoom-floor={@zoom_floor && to_string(@zoom_floor)}
      data-zoom-ceiling={@zoom_ceiling && to_string(@zoom_ceiling)}
      data-pan-locked={@pan_locked && "true"}
      data-initial-fit-image-id={@initial_fit_image_id}
      data-initial-fit-bounds={@initial_fit_bounds_json}
      data-memory-window={@memory_window && Integer.to_string(@memory_window)}
      data-gestures={@gestures_csv}
      data-nav-buttons={@nav_buttons_csv}
      data-initial-rotation={@initial_rotation != 0 && to_string(@initial_rotation)}
      data-persist-rotation={@persist_rotation && "true"}
      data-view-tracking={@view_tracking && "true"}
      data-view-settle-ms={@view_tracking && Integer.to_string(@view_settle_ms)}
      data-view-threshold={@view_tracking && to_string(@view_threshold)}
      class={[
        "fresco-viewer",
        @class,
        @infinite_canvas && "fresco-viewer--infinite"
      ]}
      tabindex="0"
      {@rest}
    >
      <div class="fresco-stage" data-fresco-stage style={stage_style(@bg_style, @prefit?)}>
        <%= for img <- @sorted_images do %>
          <img
            src={img.src}
            data-fresco-canvas-img
            data-image-id={img.id}
            data-canvas-x={img.x}
            data-canvas-y={img.y}
            data-canvas-width={img.width}
            data-canvas-height={canvas_image_height(img)}
            data-z-index={Map.get(img, :z_index, 0)}
            data-fresco-prefit={@prefit? && "true"}
            style={image_style(img, @prefit?)}
            draggable="false"
            alt=""
          />
        <% end %>
      </div>
    </div>
    """
  end

  defp canvas_dim(canvas, key), do: "#{Map.get(canvas, key, 0)}"

  # JSON-encode the :initial_fit_bounds map for the data attr. Nil maps
  # through to nil (attr omitted).
  defp encode_initial_bounds(nil), do: nil
  defp encode_initial_bounds(bounds) when is_map(bounds), do: Jason.encode!(bounds)

  # Turn a list of atoms (`[:pan, :pinch]`) into a CSV string the JS
  # engine can split (`"pan,pinch"`). Nil passes through so the attr is
  # omitted entirely, meaning "no allowlist; everything enabled."
  defp atoms_to_csv(nil), do: nil
  # Explicit empty list → "none" sentinel. Lets consumers pass
  # `nav_buttons: []` (or `gestures: []`) to hide the whole group;
  # the JS side reads `data-*="none"` and seeds an empty allowlist
  # (vs the omitted-attr case which defaults to "all enabled").
  defp atoms_to_csv([]), do: "none"

  defp atoms_to_csv(list) when is_list(list) do
    list
    |> Enum.map(&Atom.to_string/1)
    |> Enum.join(",")
  end

  defp background_style(%{background: nil}), do: nil

  defp background_style(%{background: color}) when is_binary(color),
    do: "background-color: #{color};"

  defp background_style(_), do: nil

  # If natural dims are known, set explicit height so the pre-mount paint
  # doesn't shift when the image decodes. Returns nil otherwise — the JS
  # engine will set height once the image loads.
  defp canvas_image_height(img) do
    nw = Map.get(img, :natural_width)
    nh = Map.get(img, :natural_height)
    w = img.width

    cond do
      is_number(nw) and is_number(nh) and nw > 0 ->
        w * nh / nw

      true ->
        nil
    end
  end

  # The pre-fit paint. The server cannot know the viewport, so it cannot
  # compute the fit the engine will apply — but it CAN paint something that
  # looks like a fit, using CSS alone, for the gap between the static render
  # and the hook mounting. That gap is not small: the JS bundle is fetched and
  # parsed after the HTML paints, and on a cold load it can run a second or
  # more behind. A page that opens with a viewer already on screen (deep link,
  # refresh) shows whatever this markup says for that whole time.
  #
  # What it used to say was the canvas-pixel box — `width:4984px;
  # height:2957px` for a 5K photo. Untransformed, that is the top-left corner
  # of a hugely magnified picture; and under a CSS reset that clamps width but
  # not height (Tailwind preflight's `img { max-width: 100% }`) it is also
  # squashed to the wrong aspect ratio. Reported as "a very strange stretched
  # image" on refresh.
  #
  # Contained against the viewer box instead, the first paint is the picture,
  # whole and in proportion — soft, because the rung on hand is small, which
  # reads as loading rather than as broken. The engine overwrites left/top/
  # width/height/max-* on mount and clears these hints (`object-fit` here, the
  # stage's size below) in `applyImgResets`, so nothing survives into the real
  # per-frame math.
  #
  # Only for a lone image that IS the canvas. On a multi-image board, "contain
  # each image in the viewer" would stack them all on top of each other, which
  # is worse than the magnified corner it replaces; and a single image placed
  # inside a larger canvas would be painted filling the viewer, then jump when
  # the engine fits the whole canvas instead. Both keep the canvas-pixel box.
  defp prefit?(canvas, [img]) do
    cw = Map.get(canvas, :width)
    ch = Map.get(canvas, :height)
    ih = canvas_image_height(img)

    Map.get(img, :x, 0) == 0 and Map.get(img, :y, 0) == 0 and
      is_number(cw) and cw > 0 and img.width == cw and
      (is_nil(ih) or (is_number(ch) and abs(ch - ih) <= 1))
  end

  defp prefit?(_canvas, _images), do: false

  defp stage_style(bg_style, true) do
    [bg_style, "width:100%; height:100%;"] |> Enum.reject(&is_nil/1) |> Enum.join(" ")
  end

  defp stage_style(bg_style, _), do: bg_style

  defp image_style(img, true) do
    base = [
      "position:absolute;",
      "left:0; top:0;",
      "width:100%; height:100%;",
      "max-width:100%; max-height:100%;",
      "object-fit:contain;"
    ]

    case Map.get(img, :z_index) do
      nil -> Enum.join(base, " ")
      z -> Enum.join(base ++ ["z-index:#{z};"], " ")
    end
  end

  defp image_style(img, _multi) do
    base = [
      "position:absolute;",
      "left:#{img.x}px;",
      "top:#{img.y}px;",
      "width:#{img.width}px;"
    ]

    base =
      case canvas_image_height(img) do
        nil -> base
        h -> base ++ ["height:#{h}px;"]
      end

    base =
      case Map.get(img, :z_index) do
        nil -> base
        z -> base ++ ["z-index:#{z};"]
      end

    Enum.join(base, " ")
  end
end
