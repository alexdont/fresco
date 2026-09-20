defmodule Fresco.ClampPanTest do
  @moduledoc """
  Pins what `clampPan` centres when an axis is too small to pan.

  Custom pan bounds say how far the view may TRAVEL — a peer library
  widens them to reach content drawn outside the picture (Etcher does
  this for ink that spills past the image). They do not say the picture
  should move. Centring the custom rect did exactly that: a spill on one
  side shoved the picture the other way by half the spill, which looked
  like the image settling sideways the moment annotations loaded
  (measured at 80px on a real board).

  The lifted function is the real one: this reads it out of the bundle
  rather than restating its arithmetic, so a rewrite that changes the
  rule has to change this test too.
  """
  use ExUnit.Case, async: true

  @source Path.expand("../../priv/static/fresco.js", __DIR__)

  # `clampPan` closes over the engine's mutable state, so the test rebuilds
  # that scope: viewport, current translate, the two bbox helpers, and the
  # custom rect. The body itself is the shipped one.
  defp clamp(opts) do
    src = File.read!(@source)
    start = :binary.match(src, "    function clampPan() {") |> elem(0)
    rest = binary_part(src, start, byte_size(src) - start)
    body = binary_part(rest, 0, :binary.match(rest, "\n    }") |> elem(0))

    js = """
    (function() {
      var vw = #{opts[:vw]}, vh = #{opts[:vh]};
      var tx = #{opts[:tx]}, ty = #{opts[:ty]};
      var infiniteCanvas = false;
      var customPanBounds = #{opts[:bounds]};
      var content = #{opts[:content]};
      function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
      function rotatedRectBBox(r) {
        return { minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height };
      }
      function rotatedContentBBox() { return rotatedRectBBox(content); }
      #{body}
      }
      clampPan();
      console.log(JSON.stringify({ tx: tx, ty: ty }));
    })();
    """

    {out, 0} = System.cmd("node", ["-e", js])
    Jason.decode!(String.trim(out))
  end

  test "with no custom bounds, a too-small axis centres the content" do
    # The long-standing behaviour, unchanged: zoom out and the picture
    # sits in the middle.
    got =
      clamp(
        vw: 1000,
        vh: 800,
        tx: 0,
        ty: 0,
        bounds: "null",
        content: "{ x: 0, y: 0, width: 600, height: 400 }"
      )

    assert got["tx"] == 200.0
    assert got["ty"] == 200.0
  end

  test "custom bounds do not move the picture off centre" do
    # Ink spilling 400px to the LEFT of a 600px picture. The reachable
    # rect is wider, but the picture itself must stay centred.
    # The viewport is wider than the reachable rect, so this axis cannot
    # pan: the position is fixed, and the question is only what it is
    # fixed ON.
    got =
      clamp(
        vw: 1400,
        vh: 800,
        tx: 0,
        ty: 0,
        bounds: "{ x: -400, y: 0, width: 1000, height: 400 }",
        content: "{ x: 0, y: 0, width: 600, height: 400 }"
      )

    assert got["tx"] == 400.0,
           "the picture holds its place — centring the widened rect put it " <>
             "at 600 here, half the spill off to one side, which is what " <>
             "looked like the image settling sideways as annotations loaded"

    assert got["ty"] == 200.0, "an axis with no spill is untouched"
  end

  test "an axis big enough to pan still clamps to the custom rect" do
    # The whole point of the custom bounds: once the content is larger
    # than the viewport, the view may travel across the spill.
    got =
      clamp(
        vw: 500,
        vh: 800,
        tx: 9_999,
        ty: 0,
        bounds: "{ x: -400, y: 0, width: 1000, height: 400 }",
        content: "{ x: 0, y: 0, width: 600, height: 400 }"
      )

    # tx is clamped to -bbox.minX = 400: the far edge of the spill.
    assert got["tx"] == 400.0, "panning reaches the ink outside the picture"
  end
end
