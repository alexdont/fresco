defmodule Fresco.WheelGesturesTest do
  @moduledoc """
  Pins what a `wheel` event means, which depends on what sent it.

  Three gestures arrive through this one event and nothing in it names the
  device: a notch of a mouse wheel (zoom, this viewer's oldest gesture),
  two fingers pushing a trackpad (move the picture), and a pinch (zoom,
  reported as a wheel with `ctrlKey` and no key held).

  Fingers and a wheel are told apart by shape — a wheel steps in whole,
  uniform notches and never sideways — and the reading is latched for the
  burst, because a pan that turns into a zoom halfway through a flick is
  worse than either gesture being wrong outright.

  The lifted functions are the real ones: this reads them out of the
  bundle rather than restating their arithmetic, so a rewrite that changes
  the rule has to change this test too.
  """
  use ExUnit.Case, async: true

  @source Path.expand("../../priv/static/fresco.js", __DIR__)

  defp lift(src, head) do
    start = :binary.match(src, head) |> elem(0)
    rest = binary_part(src, start, byte_size(src) - start)
    binary_part(rest, 0, :binary.match(rest, "\n    }") |> elem(0)) <> "\n    }"
  end

  # The handler closes over the engine's scope, so the test rebuilds it:
  # the two readings it routes with, and stubs that record where a gesture
  # went instead of moving anything.
  defp wheel(events, opts \\ []) do
    src = File.read!(@source)

    consts =
      Regex.scan(
        ~r/    var (TRACKPAD_STEP_MAX|TRACKPAD_BURST_MS|WHEEL_RATE|PINCH_RATE) = [\d.]+;/,
        src
      )
      |> Enum.map_join("\n", fn [line, _] -> line end)

    js = """
    (function() {
      var log = [];
      #{consts}
      var trackpadAt = 0;
      var panLocked = #{Keyword.get(opts, :pan_locked, false)};
      var gestures = #{Keyword.get(opts, :gestures, "null")};
      function gestureEnabled(name) { return gestures === null || gestures.indexOf(name) !== -1; }
      function isFromNav() { return #{Keyword.get(opts, :from_nav, false)}; }
      function cancelAnimation() {}
      function viewportRect() { return { left: 0, top: 0 }; }
      function zoomAt(px, py, k) { log.push({ gesture: "zoom", px: px, py: py, k: k }); }
      function panRaw(dx, dy) { log.push({ gesture: "pan", dx: dx, dy: dy }); }
      function panBy(dx, dy) { if (panLocked) return; panRaw(dx, dy); }
      #{lift(src, "    function wheelIsFingers(e) {")}
      #{lift(src, "    function onWheel(e) {")}

      #{Enum.map_join(events, "\n      ", fn e -> "onWheel(#{e});" end)}
      console.log(JSON.stringify(log));
    })();
    """

    {out, 0} = System.cmd("node", ["-e", js], stderr_to_stdout: true)
    Jason.decode!(String.trim(out))
  end

  defp evt(fields) do
    defaults = %{
      "deltaX" => 0,
      "deltaY" => 0,
      "deltaMode" => 0,
      "clientX" => 100,
      "clientY" => 50,
      "ctrlKey" => false
    }

    Jason.encode!(Map.merge(defaults, fields) |> Map.put("preventDefault", nil))
    |> String.replace("\"preventDefault\":null", "\"preventDefault\":function(){}")
  end

  describe "a mouse wheel" do
    test "zooms, as it always has" do
      assert [%{"gesture" => "zoom", "k" => k, "px" => 100, "py" => 50}] =
               wheel([evt(%{"deltaY" => 120})])

      assert k < 1, "a notch away from the user zooms out"
      assert_in_delta k, :math.exp(-120 * 0.0015), 1.0e-12

      assert [%{"gesture" => "zoom", "k" => up}] = wheel([evt(%{"deltaY" => -120})])
      assert up > 1, "and a notch toward them zooms in"
    end

    test "counted in lines rather than pixels is still a wheel" do
      # Firefox reports whole lines (deltaMode 1). Three lines is a small
      # number, and reading it as px would make every Firefox scroll a pan.
      assert [%{"gesture" => "zoom"}] = wheel([evt(%{"deltaY" => 3, "deltaMode" => 1})])
    end
  end

  describe "two fingers on a trackpad" do
    test "move the picture, and it follows them" do
      assert [%{"gesture" => "pan", "dx" => 12, "dy" => -8}] =
               wheel([evt(%{"deltaX" => -12, "deltaY" => 8})])
    end

    test "are recognised by a sideways component, a fraction, or a small step" do
      for e <- [
            %{"deltaX" => 4, "deltaY" => 0},
            %{"deltaY" => 2.5},
            %{"deltaY" => 12}
          ] do
        assert [%{"gesture" => "pan"}] = wheel([evt(e)]),
               "#{inspect(e)} should read as fingers"
      end
    end

    test "keep panning once the flick's momentum grows past the threshold" do
      # The latch. A flick ramps up: the first events are small, the ones
      # that follow are not, and switching to zoom mid-gesture is the
      # thing this exists to prevent.
      log = wheel([evt(%{"deltaY" => 6}), evt(%{"deltaY" => 220}), evt(%{"deltaY" => 180})])

      assert Enum.map(log, & &1["gesture"]) == ["pan", "pan", "pan"]
    end

    test "still pan while single-pointer pan is locked" do
      # The lock frees the LEFT DRAG for a marquee or a drawing tool — the
      # same reason a middle drag and a pinch are exempt from it. A board
      # you cannot pan while a tool is armed is the state the lock was
      # supposed to make usable.
      assert [%{"gesture" => "pan"}] = wheel([evt(%{"deltaY" => 6})], pan_locked: true)
    end

    test "but not when the host turned panning off" do
      assert [] = wheel([evt(%{"deltaY" => 6})], gestures: ~s(["wheel", "pinch"]))
    end
  end

  describe "a pinch" do
    test "zooms at the cursor, at its own rate" do
      assert [%{"gesture" => "zoom", "k" => k}] =
               wheel([evt(%{"deltaY" => -10, "ctrlKey" => true})])

      assert_in_delta k, :math.exp(10 * 0.01), 1.0e-12
      assert k > :math.exp(10 * 0.0015), "a pinch moves further per px than a wheel notch"
    end

    test "is a zoom even when it looks finger-shaped" do
      # Small, fractional, sideways — everything that says trackpad. With
      # ctrl held it is still a pinch, and pinching means zoom.
      assert [%{"gesture" => "zoom"}] =
               wheel([evt(%{"deltaX" => 3, "deltaY" => 1.5, "ctrlKey" => true})])
    end

    test "with no vertical component does nothing rather than zooming by 1" do
      assert [] = wheel([evt(%{"deltaX" => 4, "deltaY" => 0, "ctrlKey" => true})])
    end
  end

  describe "the host's own opt-outs" do
    test "no :wheel gesture, no wheel handling of any kind" do
      assert [] = wheel([evt(%{"deltaY" => 120})], gestures: ~s(["pan"]))
      assert [] = wheel([evt(%{"deltaY" => 6})], gestures: ~s(["pan"]))
      assert [] = wheel([evt(%{"deltaY" => -10, "ctrlKey" => true})], gestures: ~s(["pan"]))
    end

    test "a scroll over the nav rail belongs to the nav rail" do
      assert [] = wheel([evt(%{"deltaY" => 120})], from_nav: true)
    end
  end
end
