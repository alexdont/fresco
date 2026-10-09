defmodule Fresco.DoubleClickTest do
  @moduledoc """
  A double click (or a double tap — phones send the same event) toggles:
  from the fitted view it zooms in on that spot, from anywhere zoomed in it
  goes back to the fitted view.

  It used to zoom in 2× every time. Tapping the same spot again to get back
  out only went further in, until the ceiling — reported from a phone.

  Back is zoom and pan only: a rotation the user chose stays, because that
  is "reset view"'s job, not a double tap's.

  The handler is the real one, read out of the bundle.
  """
  use ExUnit.Case, async: true

  @source Path.expand("../../priv/static/fresco.js", __DIR__)

  defp lift(src, head) do
    start = :binary.match(src, head) |> elem(0)
    rest = binary_part(src, start, byte_size(src) - start)
    binary_part(rest, 0, :binary.match(rest, "\n    }") |> elem(0)) <> "\n    }"
  end

  defp dbl(scale) do
    src = File.read!(@source)
    [threshold] = Regex.run(~r/    var DBL_ZOOMED = [\d.]+;/, src)

    js = """
    var log = [];
    var s = #{scale}, sFit = 0.5;
    #{threshold}
    function isFromNav() { return false; }
    function gestureEnabled() { return true; }
    function cancelAnimation() {}
    function viewportRect() { return { left: 10, top: 20 }; }
    function zoomAt(x, y, k) { log.push({ zoom: k, x: x, y: y }); }
    function requestHome() { log.push({ home: true }); }
    function resetView() { log.push({ reset: true }); }
    #{lift(src, "    function onDblClick(e) {")}
    onDblClick({ clientX: 110, clientY: 220 });
    console.log(JSON.stringify(log));
    """

    {out, 0} = System.cmd("node", ["-e", js], stderr_to_stdout: true)
    Jason.decode!(String.trim(out))
  end

  test "from the fitted view it zooms in on the spot" do
    assert [%{"zoom" => 2, "x" => 100, "y" => 200}] = dbl(0.5)
  end

  test "zoomed in, it goes back to the fitted view instead of further in" do
    assert [%{"home" => true}] = dbl(1.0)
  end

  test "back keeps the rotation: a re-fit, not a full reset" do
    refute Enum.any?(dbl(1.0), &Map.has_key?(&1, "reset"))
  end

  test "a view a wheel barely nudged still counts as fitted" do
    assert [%{"zoom" => 2}] = dbl(0.505)
  end

  test "zoomed out past the fit (an infinite canvas), it zooms in" do
    assert [%{"zoom" => 2}] = dbl(0.2)
  end
end
