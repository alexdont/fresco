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

  attr(:rest, :global)

  @doc """
  Renders a Fresco canvas — N images positioned at absolute coordinates
  on a virtual canvas, with pan/zoom/fit/fullscreen identical to
  `Fresco.viewer`. Hooks the FrescoCanvas JS controller.
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
      class={[
        "fresco-viewer",
        @class,
        @infinite_canvas && "fresco-viewer--infinite"
      ]}
      tabindex="0"
      {@rest}
    >
      <div class="fresco-stage" data-fresco-stage style={@bg_style}>
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
            style={image_style(img)}
            draggable="false"
            alt=""
          />
        <% end %>
      </div>
    </div>
    """
  end

  defp canvas_dim(canvas, key), do: "#{Map.get(canvas, key, 0)}"

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
        "#{w * nh / nw}"

      true ->
        nil
    end
  end

  defp image_style(img) do
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
