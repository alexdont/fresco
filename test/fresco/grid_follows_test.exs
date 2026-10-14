defmodule Fresco.GridFollowsTest do
  @moduledoc """
  The dot grid is pinned to the canvas: a pan carries it along, a zoom
  spreads it out or draws it in, as if the board lay behind the picture.

  It cannot simply scale — zoomed far out the dots would crowd into a smear,
  zoomed far in thin out to nothing — so the lattice sits on canvas
  multiples of a power of two, chosen to keep the pitch on screen within
  [24, 48) px. A second lattice at half that pitch fades in as you zoom in;
  when it is fully in, it becomes the coarse one and a finer one starts at
  nothing, so no dot ever jumps.

  `syncGrid` is read out of the bundle and run in node against a stub
  element that records the custom properties it sets.
  """
  use ExUnit.Case, async: true

  @source Path.expand("../../priv/static/fresco.js", __DIR__)

  defp lift(src, head) do
    start = :binary.match(src, head) |> elem(0)
    rest = binary_part(src, start, byte_size(src) - start)
    [line | _] = String.split(rest, "\n", parts: 2)

    if String.ends_with?(String.trim_trailing(line), "}") and
         not String.ends_with?(String.trim_trailing(line), "{") do
      line
    else
      binary_part(rest, 0, :binary.match(rest, "\n    }") |> elem(0)) <> "\n    }"
    end
  end

  # `views` is a JS array of [tx, ty, s]; the result is one reading per view.
  defp run(views, opts \\ []) do
    src = File.read!(@source)

    js = """
    var props = {}, attrs = {};
    var el = { style: { setProperty: function(k, v) { props[k] = v; } },
               hasAttribute: function(k) { return k in attrs; },
               setAttribute: function(k, v) { attrs[k] = v; } };
    var tx = 0, ty = 0, s = 1, sHome = #{Keyword.get(opts, :home, 0.5)};
    var gridVisible = #{Keyword.get(opts, :visible, true)};
    var GRID_PITCH = #{Regex.run(~r/var GRID_PITCH = (\d+);/, src) |> Enum.at(1)};
    var gridKey = "";
    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    #{lift(src, "    function syncGrid() {")}
    #{lift(src, "    function mod(a, n) {")}
    var out = #{views}.map(function(v) {
      tx = v[0]; ty = v[1]; s = v[2]; props = {};
      gridKey = "";
      syncGrid();
      var px = function(k) { return k in props ? parseFloat(props[k]) : null; };
      return { pitch: px("--fresco-grid-pitch"), fine: px("--fresco-grid-fine"), r: px("--fresco-grid-r"),
               x: px("--fresco-grid-x"), y: px("--fresco-grid-y"),
               fx: px("--fresco-grid-fx"), fy: px("--fresco-grid-fy"), tagged: "data-fresco-grid" in attrs };
    });
    console.log(JSON.stringify(out));
    """

    {out, 0} = System.cmd("node", ["-e", js], stderr_to_stdout: true)
    Jason.decode!(String.trim(out))
  end

  test "on screen the pitch stays between 24 and 48 px, from 1% to 2000%" do
    scales = for e <- -60..40, do: :math.pow(2, e / 10)
    out = run(Jason.encode!(Enum.map(scales, &[0, 0, &1])))

    for g <- out do
      assert g["pitch"] >= 24 and g["pitch"] < 48.001, inspect(g)
      assert g["tagged"]
    end
  end

  test "the dots sit on fixed canvas points, so a pan carries them exactly" do
    [a, b] = run("[[10, 20, 0.7], [110, -30, 0.7]]")
    assert a["pitch"] == b["pitch"]
    # 100 px right and 50 px up, wrapped at the pitch.
    assert_in_delta mod(b["x"] - a["x"], a["pitch"]), mod(100, a["pitch"]), 0.02
    assert_in_delta mod(b["y"] - a["y"], a["pitch"]), mod(-50, a["pitch"]), 0.02
  end

  test "a coarse dot lies on the canvas origin's lattice, whatever the pan and zoom" do
    for [tx, ty, s] <- [[0, 0, 1], [37.5, -12.25, 0.3], [-900, 410, 3.7]] do
      [g] = run(Jason.encode!([[tx, ty, s]]))
      # Dot centres are at x + pitch/2 + n·pitch; the canvas origin is at tx.
      assert_in_delta mod(g["x"] + g["pitch"] / 2 - tx, g["pitch"]) |> min_wrap(g["pitch"]),
                      0,
                      0.02

      assert_in_delta mod(g["y"] + g["pitch"] / 2 - ty, g["pitch"]) |> min_wrap(g["pitch"]),
                      0,
                      0.02

      # …and the fine lattice includes every coarse dot.
      assert_in_delta mod(g["fx"] + g["pitch"] / 4 - tx, g["pitch"] / 2)
                      |> min_wrap(g["pitch"] / 2),
                      0,
                      0.02
    end
  end

  test "the fine dots fade in with the zoom and hand over without a jump" do
    # Pitch 24 at s = 24/32 = 0.75; just under 48 at s just under 1.5.
    [lo, mid, hi, past] = run("[[0, 0, 0.75], [0, 0, 1.0], [0, 0, 1.4999], [0, 0, 1.5001]]")
    assert lo["fine"] == 0
    assert mid["fine"] > 0 and mid["fine"] < 100
    assert hi["fine"] == 100
    # Past the hand-over the coarse lattice is the fine one that was fully in.
    assert_in_delta past["pitch"], hi["pitch"] / 2, 0.01
    assert past["fine"] == 0
  end

  test "dots grow as you zoom in and shrink as you zoom out, about a pixel at home" do
    [home, near, far, way_in, way_out] =
      run("[[0,0,0.5],[0,0,1],[0,0,0.25],[0,0,500],[0,0,0.0001]]")

    assert home["r"] == 1.0
    assert near["r"] > 1.0
    assert far["r"] < 1.0
    assert way_in["r"] == 2.2, "never enough to blot"
    assert way_out["r"] == 0.6, "never vanishing"
  end

  test "a hidden grid is left alone" do
    [g] = run("[[0, 0, 1]]", visible: false)
    assert g["pitch"] == nil
    refute g["tagged"]
  end

  test "every frame resyncs it, and so does turning it back on" do
    src = File.read!(@source)
    apply_fn = lift(src, "    function apply() {")
    assert apply_fn =~ "syncGrid();", "apply() paints the grid with the picture"
    assert lift(src, "    function setGridVisible(on) {") =~ "syncGrid();"
    # And the stylesheet reads what syncGrid writes, only where it has run.
    assert src =~ ~s(.fresco-viewer[data-fresco-grid] {)
    assert src =~ ~s(.fresco-viewer[data-fresco-grid].fresco--no-grid { background-image: none; })
  end

  defp mod(a, n), do: a - n * Float.floor(a / n)
  defp min_wrap(v, n), do: min(v, n - v)
end
