defmodule Fresco.CanvasTest do
  use ExUnit.Case
  doctest Fresco.Canvas

  alias Fresco.Canvas
  alias Fresco.Canvas.SchemaError

  describe "Fresco.Canvas.new/1" do
    test "returns sensible defaults" do
      canvas = Canvas.new()
      assert canvas.version == "1"
      assert canvas.canvas == %{width: 0, height: 0, background: nil, __extra__: %{}}
      assert canvas.images == []
      assert canvas.extensions == %{}
      assert canvas.__extra__ == %{}
    end

    test "applies width / height / background options" do
      canvas = Canvas.new(width: 4000, height: 3000, background: "#fafafa")
      assert canvas.canvas.width == 4000
      assert canvas.canvas.height == 3000
      assert canvas.canvas.background == "#fafafa"
    end
  end

  describe "Fresco.Canvas.add_image/2" do
    test "auto-assigns sequential ids when :id is omitted" do
      canvas =
        Canvas.new()
        |> Canvas.add_image(%{src: "/a.jpg", x: 0, y: 0, width: 100})
        |> Canvas.add_image(%{src: "/b.jpg", x: 200, y: 0, width: 100})

      assert Enum.map(canvas.images, & &1.id) == ["img-1", "img-2"]
    end

    test "preserves caller-provided ids" do
      canvas =
        Canvas.new()
        |> Canvas.add_image(%{id: "page-a", src: "/a.jpg", x: 0, y: 0, width: 100})

      assert hd(canvas.images).id == "page-a"
    end

    test "carries optional natural_width / natural_height / z_index" do
      canvas =
        Canvas.new()
        |> Canvas.add_image(%{
          src: "/a.jpg",
          x: 0,
          y: 0,
          width: 100,
          natural_width: 2000,
          natural_height: 1500,
          z_index: 3
        })

      [img] = canvas.images
      assert img.natural_width == 2000
      assert img.natural_height == 1500
      assert img.z_index == 3
    end

    test "raises ArgumentError on missing :src" do
      assert_raise ArgumentError, ~r/:src must be a non-empty string/, fn ->
        Canvas.add_image(Canvas.new(), %{x: 0, y: 0, width: 100})
      end
    end

    test "raises ArgumentError on non-positive :width" do
      assert_raise ArgumentError, ~r/:width must be a positive number/, fn ->
        Canvas.add_image(Canvas.new(), %{src: "/a.jpg", x: 0, y: 0, width: 0})
      end
    end

    test "raises ArgumentError on non-number coordinates" do
      assert_raise ArgumentError, ~r/:x must be a number/, fn ->
        Canvas.add_image(Canvas.new(), %{src: "/a.jpg", x: "0", y: 0, width: 100})
      end
    end
  end

  describe "Fresco.Canvas.put_extension/3" do
    test "stores extension data keyed by name (string)" do
      canvas =
        Canvas.new()
        |> Canvas.put_extension("etcher", %{"annotations" => []})

      assert canvas.extensions["etcher"] == %{"annotations" => []}
    end

    test "accepts atom keys and normalizes to string" do
      canvas = Canvas.put_extension(Canvas.new(), :etcher, %{"version" => "1"})
      assert canvas.extensions["etcher"] == %{"version" => "1"}
    end

    test "overwrites by key" do
      canvas =
        Canvas.new()
        |> Canvas.put_extension("etcher", %{"v" => 1})
        |> Canvas.put_extension("etcher", %{"v" => 2})

      assert canvas.extensions["etcher"] == %{"v" => 2}
    end
  end

  describe "JSON round-trip" do
    test "encode → decode returns an equivalent struct" do
      original =
        Canvas.new(width: 4000, height: 3000, background: "#fafafa")
        |> Canvas.add_image(%{src: "/a.jpg", x: 0, y: 0, width: 2000})
        |> Canvas.add_image(%{
          src: "/b.jpg",
          x: 2100,
          y: 0,
          width: 1800,
          natural_width: 1800,
          natural_height: 1200,
          z_index: 1
        })
        |> Canvas.put_extension("etcher", %{
          "version" => "1",
          "annotations" => [%{"image_id" => "img-1", "kind" => "arrow"}]
        })

      {:ok, json} = Canvas.to_json(original)
      {:ok, loaded} = Canvas.from_json(json)

      assert loaded.version == original.version
      assert loaded.canvas == original.canvas
      assert loaded.extensions == original.extensions
      assert length(loaded.images) == 2

      [a, b] = loaded.images
      assert a.id == "img-1"
      assert a.src == "/a.jpg"
      assert a.x == 0
      assert a.y == 0
      assert a.width == 2000

      assert b.id == "img-2"
      assert b.natural_width == 1800
      assert b.natural_height == 1200
      assert b.z_index == 1
    end

    test "unknown top-level keys round-trip via __extra__" do
      # Hand-crafted JSON with a v2-ish unknown key — a v1 reader must keep
      # it intact through encode → decode → encode so consumers don't lose
      # data they don't yet understand.
      json = """
      {
        "version": "1",
        "canvas": {"width": 100, "height": 100},
        "images": [],
        "extensions": {},
        "future_field": {"hello": "world"},
        "another_future": 42
      }
      """

      {:ok, loaded} = Canvas.from_json(json)
      assert loaded.__extra__["future_field"] == %{"hello" => "world"}
      assert loaded.__extra__["another_future"] == 42

      {:ok, reencoded} = Canvas.to_json(loaded)
      {:ok, decoded_again} = Jason.decode(reencoded)
      assert decoded_again["future_field"] == %{"hello" => "world"}
      assert decoded_again["another_future"] == 42
    end

    test "unknown per-image keys round-trip via __extra__" do
      json = """
      {
        "version": "1",
        "canvas": {"width": 100, "height": 100},
        "images": [{
          "id": "img-1",
          "src": "/a.jpg",
          "x": 0, "y": 0, "width": 50,
          "rotation": 90,
          "filter": "sepia"
        }],
        "extensions": {}
      }
      """

      {:ok, loaded} = Canvas.from_json(json)
      [img] = loaded.images
      assert img.__extra__["rotation"] == 90
      assert img.__extra__["filter"] == "sepia"

      {:ok, reencoded} = Canvas.to_json(loaded)
      {:ok, decoded_again} = Jason.decode(reencoded)
      [encoded_img] = decoded_again["images"]
      assert encoded_img["rotation"] == 90
      assert encoded_img["filter"] == "sepia"
    end

    test "extensions remain opaque — never inspected" do
      # A weird-looking extension blob still round-trips verbatim because
      # Fresco doesn't peer inside.
      weird_blob = %{
        "version" => "99",
        "nested" => %{"deeply" => %{"arrays" => [1, [2, [3]]], "null" => nil}},
        "booleans" => [true, false]
      }

      canvas = Canvas.put_extension(Canvas.new(width: 10, height: 10), "weird", weird_blob)
      {:ok, json} = Canvas.to_json(canvas)
      {:ok, loaded} = Canvas.from_json(json)

      assert loaded.extensions["weird"] == weird_blob
    end
  end

  describe "from_json/1 validation" do
    test "rejects missing :version" do
      json = ~s|{"canvas": {"width": 10, "height": 10}, "images": [], "extensions": {}}|
      assert {:error, %SchemaError{path: [:version], reason: :missing}} = Canvas.from_json(json)
    end

    test "rejects unsupported :version" do
      json =
        ~s|{"version": "99", "canvas": {"width": 10, "height": 10}, "images": [], "extensions": {}}|

      assert {:error, %SchemaError{path: [:version], reason: {:unsupported_version, "99"}}} =
               Canvas.from_json(json)
    end

    test "rejects non-positive canvas width" do
      json =
        ~s|{"version": "1", "canvas": {"width": 0, "height": 10}, "images": [], "extensions": {}}|

      assert {:error,
              %SchemaError{path: [:canvas, :width], reason: {:expected_positive_number, 0}}} =
               Canvas.from_json(json)
    end

    test "rejects image with non-string :src" do
      json = """
      {"version": "1", "canvas": {"width": 10, "height": 10},
       "images": [{"id": "x", "src": 42, "x": 0, "y": 0, "width": 1}],
       "extensions": {}}
      """

      assert {:error,
              %SchemaError{path: [:images, 0, :src], reason: {:expected_nonempty_string, 42}}} =
               Canvas.from_json(json)
    end

    test "rejects image with non-positive :width" do
      json = """
      {"version": "1", "canvas": {"width": 10, "height": 10},
       "images": [{"id": "x", "src": "/a.jpg", "x": 0, "y": 0, "width": -1}],
       "extensions": {}}
      """

      assert {:error,
              %SchemaError{path: [:images, 0, :width], reason: {:expected_positive_number, -1}}} =
               Canvas.from_json(json)
    end

    test "rejects duplicate ids" do
      json = """
      {"version": "1", "canvas": {"width": 10, "height": 10},
       "images": [
         {"id": "dup", "src": "/a.jpg", "x": 0, "y": 0, "width": 1},
         {"id": "dup", "src": "/b.jpg", "x": 0, "y": 0, "width": 1}
       ],
       "extensions": {}}
      """

      assert {:error, %SchemaError{path: [:images, 1, :id], reason: {:duplicate_id, "dup"}}} =
               Canvas.from_json(json)
    end

    test "rejects extensions that aren't a map" do
      json =
        ~s|{"version": "1", "canvas": {"width": 10, "height": 10}, "images": [], "extensions": []}|

      assert {:error, %SchemaError{path: [:extensions], reason: {:expected_map, []}}} =
               Canvas.from_json(json)
    end

    test "from_json! raises on invalid input" do
      assert_raise SchemaError, fn ->
        Canvas.from_json!(~s|{"not": "valid"}|)
      end
    end
  end

  describe "file I/O" do
    @tmp_dir System.tmp_dir!()

    test "write! then read! returns the same canvas" do
      path =
        Path.join(@tmp_dir, "fresco_canvas_test_#{:erlang.unique_integer([:positive])}.fresco")

      original =
        Canvas.new(width: 4000, height: 3000)
        |> Canvas.add_image(%{src: "/a.jpg", x: 0, y: 0, width: 2000})
        |> Canvas.put_extension("etcher", %{"a" => 1})

      try do
        assert :ok = Canvas.write!(path, original)
        assert loaded = Canvas.read!(path)
        assert loaded.canvas == original.canvas
        assert length(loaded.images) == 1
        assert loaded.extensions == original.extensions
      after
        File.rm(path)
      end
    end

    test "write/2 is atomic — overwrites cleanly via temp + rename" do
      path =
        Path.join(@tmp_dir, "fresco_canvas_atomic_#{:erlang.unique_integer([:positive])}.fresco")

      original = Canvas.new(width: 10, height: 10)

      try do
        # First write creates the file.
        assert {:ok, ^path} = Canvas.write(path, original)
        assert File.exists?(path)
        # The temp file should NOT exist after a successful write.
        refute File.exists?(path <> ".tmp")

        # Overwrite — same atomic dance, no stale .tmp left behind.
        updated = Canvas.add_image(original, %{src: "/a.jpg", x: 0, y: 0, width: 5})
        assert {:ok, ^path} = Canvas.write(path, updated)
        refute File.exists?(path <> ".tmp")

        # Reload and confirm the new state landed.
        loaded = Canvas.read!(path)
        assert length(loaded.images) == 1
      after
        File.rm(path)
        File.rm(path <> ".tmp")
      end
    end

    test "read/1 returns an error tuple for non-existent paths" do
      assert {:error, :enoent} = Canvas.read("/nonexistent/path/foo.fresco")
    end

    test "read/1 returns a SchemaError for malformed JSON" do
      path =
        Path.join(@tmp_dir, "fresco_canvas_bad_#{:erlang.unique_integer([:positive])}.fresco")

      try do
        File.write!(path, "not valid json")
        assert {:error, %SchemaError{reason: {:json, _}}} = Canvas.read(path)
      after
        File.rm(path)
      end
    end
  end
end
