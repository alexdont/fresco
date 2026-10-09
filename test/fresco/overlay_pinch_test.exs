defmodule Fresco.OverlayPinchTest do
  @moduledoc """
  What happens when a finger lands on an overlay that has claimed pointer
  input, and then a second one does.

  `[data-fresco-no-capture]` is a peer overlay saying "I handle pointer input
  in here" — Etcher stamps it on the layer it draws into. Honouring that is
  what keeps a stroke from also dragging the canvas out from under itself.

  But an overlay claims ONE pointer: a finger drawing a line, a cursor
  dragging a handle. Two fingers are a pinch, and a pinch is the canvas's
  gesture whatever the overlay is doing with the first finger. Reported from
  a phone: with the marker armed, a second finger fed the same stroke and the
  line whipped back and forth between the two fingers for as long as they
  both moved — because the viewer had been told to ignore the first one, so
  the second had nothing to pinch WITH. Panning a board meant switching to
  the pan tool, panning, and switching back.

  So the claimed first finger is COUNTED but starts no gesture: `gestureStart`
  stays null, nothing gets the dragging class, and no pan is emitted. The
  second finger is fresco's, and it pinches against the first. The same
  exemption the middle drag has always had, for the same reason — the lock
  exists to free the left drag for something else, not to forbid moving
  around.

  A mouse and a pen stay fully claimed: there is no second pointer coming.

  The lifted functions are the real ones, read out of the bundle, so a
  rewrite that changes the rule has to change this test too.
  """
  use ExUnit.Case, async: true

  import Fresco.Test.PointerHarness

  describe "one finger on an overlay that claimed it" do
    test "starts no gesture of the viewer's own" do
      out = press([down(1, 100, 100), move(1, 180, 140)])

      assert out["kind"] == nil, "the overlay is drawing with it — there is no gesture here"
      assert out["classes"] == [], "and nothing is being dragged"
      assert out["tx"] == 0 and out["ty"] == 0
      assert out["log"] == [], "no pan, no zoom, no tap"
    end

    test "but is counted, so a second finger has something to pinch against" do
      out = press([down(1, 100, 100)])

      assert out["counted"] == 1,
             "swallowing the press left the viewer holding no pointers at all, " <>
               "and the second finger fed the stroke instead of pinching"
    end

    test "and is let go of on release like any other" do
      out = press([down(1, 100, 100), up(1)])

      assert out["counted"] == 0,
             "a counted finger that outlived its release would pinch against the next one"
    end
  end

  describe "a second finger" do
    test "is the viewer's: it pinches, whatever the overlay is doing with the first" do
      out = press([down(1, 100, 100), down(2, 300, 100)])

      assert out["kind"] == "pinch"
      assert out["counted"] == 2
      assert out["classes"] == ["fresco--dragging"]
    end

    test "zooms as it spreads" do
      out =
        press([
          down(1, 200, 100),
          down(2, 300, 100),
          move(1, 150, 100),
          move(2, 350, 100)
        ])

      assert out["s"] == 2.0, "the gap doubled, so the picture doubled"
      assert Enum.any?(out["log"], &(&1["event"] == "zoom"))
    end

    test "pans as both fingers travel together" do
      out =
        press([
          down(1, 200, 100),
          down(2, 300, 100),
          move(1, 240, 160),
          move(2, 340, 160)
        ])

      assert out["s"] == 1.0, "the gap held, so the scale held"
      assert out["tx"] == 40 and out["ty"] == 60
    end

    test "pinches even while pan is locked, which is when a tool is armed" do
      # The lock is what stops a single finger panning while the marker is
      # out. If it stopped the pinch too, this whole exemption would buy
      # nothing: a tool is armed in exactly the case the user needs to move.
      out =
        press(
          [down(1, 200, 100), down(2, 300, 100), move(1, 150, 100), move(2, 350, 100)],
          pan_locked: true
        )

      assert out["s"] == 2.0
    end

    test "and the first finger keeps drawing if the overlay never let go" do
      # Fresco does not take the first finger over — it only counts it. The
      # overlay is still the one holding its capture, and what it does with
      # it is Etcher's business (it abandons the stroke; see its own tests).
      out = press([down(1, 100, 100), down(2, 300, 100)])

      assert out["counted"] == 2

      refute Enum.any?(out["log"], &(&1["event"] == "tap")),
             "a press the overlay owns is not a tap on the canvas"
    end
  end

  describe "what stays claimed" do
    test "a mouse press is not counted — no second pointer is coming" do
      out = press([down(1, 100, 100, type: "mouse"), move(1, 200, 200, type: "mouse")])

      assert out["counted"] == 0
      assert out["kind"] == nil
      assert out["tx"] == 0, "a left drag that draws must not also pan"
    end

    test "a pen press is not counted either" do
      # Two pens are not a pinch, and a pen is a drawing instrument before
      # it is anything else.
      out = press([down(1, 100, 100, type: "pen")])

      assert out["counted"] == 0
    end

    test "a middle press an overlay blocks stays blocked" do
      out = press([down(1, 100, 100, type: "mouse", button: 1)])

      assert out["counted"] == 0
      assert out["kind"] == nil
    end
  end

  describe "an unclaimed surface is untouched by any of this" do
    test "one finger pans, as it always has" do
      out = press([down(1, 100, 100), move(1, 160, 130)], claimed: false)

      assert out["kind"] == "pan"
      assert out["tx"] == 60 and out["ty"] == 30
      assert out["classes"] == ["fresco--dragging"]
    end

    test "and a locked pan still refuses it" do
      out = press([down(1, 100, 100), move(1, 160, 130)], claimed: false, pan_locked: true)

      assert out["kind"] == "pan"
      assert out["tx"] == 0 and out["ty"] == 0
    end

    test "a middle drag an overlay does not block still pans" do
      out =
        press(
          [
            down(1, 100, 100, type: "mouse", button: 1),
            move(1, 150, 100, type: "mouse")
          ],
          blocks_middle: false
        )

      assert out["tx"] == 50
    end
  end
end
