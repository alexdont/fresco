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

  # The rates are dials, tuned by hand against real hardware, so the tests
  # read them rather than restate them — what is pinned is the shape of the
  # zoom and how far apart the two gains have to stay.
  defp rate(name) do
    [_, v] = Regex.run(~r/var #{name} = ([\d.]+);/, File.read!(@source))
    String.to_float(v)
  end

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
      var burstKind = null;
      var LINE_PX = 40;
      var PAGE_PX = 800;
      // A clock the test drives, so the burst window can be walked across
      // without waiting for it.
      var __now = 1000000;   // a real clock is never 0, and the latch's sentinel is
      var __times = #{Keyword.get(opts, :times, "null")};
      Date.now = function() { return __now; };
      var panLocked = #{Keyword.get(opts, :pan_locked, false)};
      var gestures = #{Keyword.get(opts, :gestures, "null")};
      function gestureEnabled(name) { return gestures === null || gestures.indexOf(name) !== -1; }
      function isFromNav() { return #{Keyword.get(opts, :from_nav, false)}; }
      function cancelAnimation() {}
      function viewportRect() { return { left: 0, top: 0 }; }
      function zoomAt(px, py, k) { log.push({ gesture: "zoom", px: px, py: py, k: k }); }
      function panRaw(dx, dy) { log.push({ gesture: "pan", dx: dx, dy: dy }); }
      function panBy(dx, dy) { if (panLocked) return; panRaw(dx, dy); }
      #{lift(src, "    function wheelPxY(e) {")}
      #{lift(src, "    function wheelPxX(e) {")}
      #{lift(src, "    function wheelIsFingers(e) {")}
      #{lift(src, "    function onWheel(e) {")}

      #{events |> Enum.with_index() |> Enum.map_join("\n      ", fn {e, i} -> "__now = __times ? 1000000 + __times[#{i}] : __now; onWheel(#{e});" end)}
      console.log(JSON.stringify(log));
    })();
    """

    {out, 0} = System.cmd("node", ["-e", js], stderr_to_stdout: true)
    Jason.decode!(String.trim(out))
  end

  defp evt(fields) do
    # `wheelDeltaY` defaults to 0, which is what a browser without the
    # legacy property reports — the reading then falls through to shape.
    defaults = %{
      "deltaX" => 0,
      "deltaY" => 0,
      "deltaMode" => 0,
      "wheelDeltaY" => 0,
      "clientX" => 100,
      "clientY" => 50,
      "ctrlKey" => false,
      "metaKey" => false
    }

    Jason.encode!(Map.merge(defaults, fields) |> Map.put("preventDefault", nil))
    |> String.replace("\"preventDefault\":null", "\"preventDefault\":function(){}")
  end

  describe "a mouse wheel" do
    test "zooms at full rate when it names itself a notch" do
      # The one that matters on a Mac, where the system hands a mouse
      # wheel over as small momentum-shaped deltas that look exactly like
      # fingers. `wheelDeltaY` is a whole multiple of 120 for a wheel
      # whatever the px delta, and three times the pixels for fingers.
      assert [%{"gesture" => "zoom", "k" => k}] =
               wheel([evt(%{"deltaY" => 4, "wheelDeltaY" => -120})])

      assert_in_delta k, :math.exp(-4 * rate("WHEEL_RATE")), 1.0e-12

      # …and the same small delta with no such claim is fingers.
      assert [%{"gesture" => "pan"}] = wheel([evt(%{"deltaY" => 4, "wheelDeltaY" => -12})])
    end

    test "a wheel's smoothed-out notch zooms all the way, not just its first event" do
      # The one that made the wheel feel broken. A Mac does not hand a
      # notch over as one event: it smooths it into a run of small deltas
      # shaped exactly like fingers, and only the first of them carries
      # the notch. Judged one by one, the first zoomed and the rest
      # panned — a whole notch of scrolling buying two percent of zoom.
      log =
        wheel(
          [
            evt(%{"deltaY" => 10, "wheelDeltaY" => -120}),
            evt(%{"deltaY" => 8, "wheelDeltaY" => -24}),
            evt(%{"deltaY" => 5, "wheelDeltaY" => -15}),
            evt(%{"deltaY" => 2, "wheelDeltaY" => -6})
          ],
          times: "[0, 30, 60, 90]"
        )

      assert Enum.map(log, & &1["gesture"]) == ["zoom", "zoom", "zoom", "zoom"],
             "the whole notch zooms, or the wheel moves a fraction of what it should"
    end

    test "a long run of notch-shaped events cannot outlast the flick that owns them" do
      # A finger held down sends events for as long as it moves. If a run
      # of them happens to land on 120 — a 40px push does — the latch has
      # to be held by each one, or the burst window lapses under a finger
      # that never stopped and the pan turns into a zoom mid-movement.
      log =
        wheel(
          [
            evt(%{"deltaY" => 6, "wheelDeltaY" => -18}),
            evt(%{"deltaY" => 40, "wheelDeltaY" => -120}),
            evt(%{"deltaY" => 40, "wheelDeltaY" => -120}),
            evt(%{"deltaY" => 40, "wheelDeltaY" => -120})
          ],
          times: "[0, 300, 600, 900]"
        )

      assert Enum.map(log, & &1["gesture"]) == ["pan", "pan", "pan", "pan"]
    end

    test "but a notch after the flick has died is a wheel again" do
      log =
        wheel(
          [
            evt(%{"deltaY" => 6, "wheelDeltaY" => -18}),
            evt(%{"deltaY" => 40, "wheelDeltaY" => -120})
          ],
          times: "[0, 900]"
        )

      assert Enum.map(log, & &1["gesture"]) == ["pan", "zoom"]
    end

    test "a coincidental 120 mid-flick does not interrupt a pan" do
      # Fingers report 3x their pixels, so a 40px push lands on 120 by
      # accident. Inside a flick the latch wins; that is what it is for.
      log =
        wheel([
          evt(%{"deltaY" => 6, "wheelDeltaY" => -18}),
          evt(%{"deltaY" => 40, "wheelDeltaY" => -120}),
          evt(%{"deltaY" => 52, "wheelDeltaY" => -156})
        ])

      assert Enum.map(log, & &1["gesture"]) == ["pan", "pan", "pan"]
    end

    test "zooms, as it always has" do
      assert [%{"gesture" => "zoom", "k" => k, "px" => 100, "py" => 50}] =
               wheel([evt(%{"deltaY" => 120})])

      assert k < 1, "a notch away from the user zooms out"
      assert_in_delta k, :math.exp(-120 * rate("WHEEL_RATE")), 1.0e-12

      assert [%{"gesture" => "zoom", "k" => up}] = wheel([evt(%{"deltaY" => -120})])
      assert up > 1, "and a notch toward them zooms in"
    end

    test "counted in lines rather than pixels is still a wheel" do
      # Firefox reports whole lines (deltaMode 1). Three lines is a small
      # number, and reading it as px would make every Firefox scroll a pan.
      assert [%{"gesture" => "zoom"}] = wheel([evt(%{"deltaY" => 3, "deltaMode" => 1})])
    end

    test "a wheel counting in lines zooms the same as one counting in pixels" do
      # The bug behind "the wheel is super slow", found in a log of real
      # events: this mouse reports SIX LINES a notch where another reports
      # 120 pixels, and everything here is priced in pixels. The notch
      # bought 0.9% of zoom instead of 20%.
      assert [%{"gesture" => "zoom", "k" => k}] =
               wheel([evt(%{"deltaY" => -6, "deltaMode" => 1, "wheelDeltaY" => 120})])

      assert_in_delta k, :math.exp(120 * rate("WHEEL_RATE")), 1.0e-12
    end

    test "…and a legacy value that is not in pixels is ignored" do
      # An event built by script carries the line count in `wheelDeltaY`
      # rather than the browser's 120-a-notch currency. Trusting a 6 there
      # is the bug this conversion exists to undo.
      assert [%{"gesture" => "zoom", "k" => k}] =
               wheel([evt(%{"deltaY" => -6, "deltaMode" => 1, "wheelDeltaY" => -6})])

      assert_in_delta k, :math.exp(6 * 40 * rate("WHEEL_RATE")), 1.0e-12
    end

    test "…and without the legacy field, a line is worth 40px" do
      assert [%{"gesture" => "zoom", "k" => k}] =
               wheel([evt(%{"deltaY" => -3, "deltaMode" => 1})])

      assert_in_delta k, :math.exp(3 * 40 * rate("WHEEL_RATE")), 1.0e-12
    end

    test "pages are pixels too" do
      assert [%{"gesture" => "zoom", "k" => k}] =
               wheel([evt(%{"deltaY" => -1, "deltaMode" => 2})])

      assert_in_delta k, :math.exp(800 * rate("WHEEL_RATE")), 1.0e-12
    end
  end

  describe "two fingers on a trackpad" do
    test "move the view, the way two fingers move a page" do
      assert [%{"gesture" => "pan", "dx" => -12, "dy" => 8}] =
               wheel([evt(%{"deltaX" => -12, "deltaY" => 8})])
    end

    test "the picture goes the opposite way to the fingers, as a page does" do
      # A trackpad that scrolls naturally has already inverted once: fingers
      # pushing down-right report negative deltas on both axes. Passing
      # those through moves the VIEW that way and the picture the other —
      # which is what a page does under the same fingers. Inverting again
      # made the picture follow the fingers, and it read as backwards to
      # everyone who tried it.
      assert [%{"gesture" => "pan", "dx" => dx, "dy" => dy}] =
               wheel([evt(%{"deltaX" => -18, "deltaY" => -24})])

      assert dx < 0 and dy < 0, "down-right fingers take the view down-right"
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
    test "zooms at the cursor, at a gain fingers can actually cross a level with" do
      assert [%{"gesture" => "zoom", "k" => k}] =
               wheel([evt(%{"deltaY" => -10, "ctrlKey" => true})])

      assert_in_delta k, :math.exp(10 * rate("PINCH_RATE")), 1.0e-12

      assert rate("PINCH_RATE") >= 10 * rate("WHEEL_RATE"),
             "a pinch measures a few px an event where a notch measures a " <>
               "hundred; at the wheel's gain it takes dozens of them to " <>
               "cross a zoom level"
    end

    test "but ctrl held on a MOUSE keeps the wheel's rate" do
      # The same gesture reaches here from both devices, and their deltas
      # are two orders of magnitude apart. One rate for both means either
      # a pinch that goes nowhere or a wheel that jumps two levels a click.
      assert [%{"gesture" => "zoom", "k" => k}] =
               wheel([evt(%{"deltaY" => -120, "wheelDeltaY" => 120, "ctrlKey" => true})])

      assert_in_delta k, :math.exp(120 * rate("WHEEL_RATE")), 1.0e-12
    end

    test "⌘ held is the same gesture, for a laptop whose fingers are spoken for" do
      # Two fingers pan now, so on a trackpad the keyboard is the steadier
      # way to zoom. ⌘+scroll is the one the platform leaves free —
      # ctrl+scroll is the browser's own page zoom, which is why a pinch
      # borrows it.
      assert [%{"gesture" => "zoom", "k" => k}] =
               wheel([evt(%{"deltaY" => -10, "metaKey" => true})])

      assert_in_delta k, :math.exp(10 * rate("PINCH_RATE")), 1.0e-12
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
