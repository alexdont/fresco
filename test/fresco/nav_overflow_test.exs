defmodule Fresco.NavOverflowTest do
  @moduledoc """
  The nav fits the room it has.

  On a phone the column of buttons ran most of the way down the picture and
  under the host's own controls (a close button, previous/next). Now the nav
  can be a row along the top (`nav_layout: :row`), and in either layout the
  buttons that do not fit move behind a "more" (⋯) button at the end and come
  back when there is room again.

  Which ones move is fixed: fullscreen, rotate left, rotate right, zoom out,
  zoom in, then reset view — least reached-for first. Buttons an extension
  appended (Etcher's pencil, a host's eye) never move: a host put them there
  to be seen.

  The real `buildNav` / `enhanceNav` / `attachNavButton` are read out of the
  bundle and run against a small fake DOM whose nav is as wide as the
  buttons showing in it, so a rewrite of the rule has to change this test.
  """
  use ExUnit.Case, async: true

  @source Path.expand("../../priv/static/fresco.js", __DIR__)

  # Top-level functions in the bundle are indented two spaces.
  defp lift(src, head) do
    start = :binary.match(src, head) |> elem(0)
    rest = binary_part(src, start, byte_size(src) - start)
    binary_part(rest, 0, :binary.match(rest, "\n  }") |> elem(0)) <> "\n  }"
  end

  defp run(script, build_opts \\ ~s({"layout": "row"})) do
    src = File.read!(@source)
    [collapse] = Regex.run(~r/  var NAV_COLLAPSE = \[[^\]]*\];/, src)

    js = """
    // A DOM just big enough: elements with children, attributes, `hidden`,
    // and a nav whose scrollWidth is its visible buttons at 42px each.
    function El(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {};
      this.style = {}; this.parentNode = null; this.hidden = false; this.listeners = {};
    }
    El.prototype.appendChild = function(c) { return this.insertBefore(c, null); };
    El.prototype.insertBefore = function(c, ref) {
      if (c.parentNode) c.parentNode.removeChild(c);
      var i = ref ? this.children.indexOf(ref) : -1;
      if (i === -1) this.children.push(c); else this.children.splice(i, 0, c);
      c.parentNode = this; return c;
    };
    El.prototype.removeChild = function(c) {
      this.children.splice(this.children.indexOf(c), 1); c.parentNode = null; return c;
    };
    Object.defineProperty(El.prototype, "firstChild", { get: function() { return this.children[0] || null; } });
    Object.defineProperty(El.prototype, "nextSibling", { get: function() {
      if (!this.parentNode) return null;
      var k = this.parentNode.children; return k[k.indexOf(this) + 1] || null;
    } });
    El.prototype.setAttribute = function(k, v) { this.attrs[k] = String(v); };
    El.prototype.getAttribute = function(k) { return k in this.attrs ? this.attrs[k] : null; };
    El.prototype.addEventListener = function(t, f) { this.listeners[t] = f; };
    El.prototype.contains = function(n) {
      for (; n; n = n.parentNode) if (n === this) return true; return false;
    };
    El.prototype.querySelector = function(sel) {
      var m = sel.match(/^\\[([\\w-]+)="([^"]*)"\\]$/);
      for (var i = 0; i < this.children.length; i++) {
        if (this.children[i].attrs[m[1]] === m[2]) return this.children[i];
      }
      return null;
    };
    El.prototype.click = function() {
      this.listeners.click && this.listeners.click({ preventDefault: function() {}, stopPropagation: function() {} });
    };
    var ROOM = 1000;   // the nav's max-width, in px — what the test turns
    function visible(el) { return el.children.filter(function(c) { return !c.hidden; }).length; }
    function navEl() {
      var nav = new El("div");
      Object.defineProperty(nav, "scrollWidth", { get: function() { return visible(nav) * 42; } });
      Object.defineProperty(nav, "clientWidth", { get: function() { return Math.min(ROOM, visible(nav) * 42); } });
      nav.offsetTop = 12; nav.offsetLeft = 12; nav.offsetHeight = 36; nav.offsetWidth = 0;
      return nav;
    }
    var document = {
      createElement: function(tag) { return tag === "div" && !document._made++ ? navEl() : new El(tag); },
      _made: 0, addEventListener: function() {}, removeEventListener: function() {}
    };
    var window = { requestAnimationFrame: function(f) { pending.push(f); } };
    var pending = [];
    function flush() { while (pending.length) pending.shift()(); }
    var ResizeObserver = undefined;
    function injectStyles() {}
    var ICONS = { expand: "", zoomIn: "", zoomOut: "", rotate: "", rotateLeft: "", reset: "", more: "" };
    #{collapse}
    #{lift(src, "  function makeButton(svg, title, onClick) {")}
    #{lift(src, "  function attachNavButton(navEl, svg, title, onClick, opts) {")}
    #{lift(src, "  function buildNav(host, handlers, opts) {")}
    #{lift(src, "  function enhanceNav(nav, host, pinned) {")}

    var host = new El("div"); host.clientWidth = 800; host.clientHeight = 600;
    var noop = function() {};
    var nav = buildNav(host, { onFullscreen: noop, onZoomIn: noop, onZoomOut: noop,
      onRotate: noop, onRotateLeft: noop, onFit: noop }, #{build_opts});
    var pop = host.children[1];
    function shown() {
      return nav.children.filter(function(c) { return !c.hidden; })
        .map(function(c) { return c.getAttribute("data-fresco-nav") || (c.title === "More" ? "more" : c.title); });
    }
    function waiting() { return pop.children.map(function(c) { return c.getAttribute("data-fresco-nav"); }); }
    var out = {};
    #{script}
    console.log(JSON.stringify(out));
    """

    {out, 0} = System.cmd("node", ["-e", js], stderr_to_stdout: true)
    Jason.decode!(String.trim(out))
  end

  test "a row with room shows every button and no ⋯" do
    out =
      run("""
      flush(); out.layout = nav.getAttribute("data-layout"); out.shown = shown(); out.waiting = waiting();
      """)

    assert out["layout"] == "row"
    assert out["shown"] == ~w(fullscreen zoom_in zoom_out rotate_left rotate home)
    assert out["waiting"] == []
  end

  test "squeezed, the least-used go behind ⋯ first, and the nav keeps its order" do
    # Room for four buttons: three of the six plus ⋯.
    out = run("ROOM = 4 * 42; flush(); out.shown = shown(); out.waiting = waiting();")

    assert out["shown"] == ~w(zoom_in zoom_out home more)
    assert out["waiting"] == ~w(fullscreen rotate_left rotate)
  end

  test "a little short, it is fullscreen and rotate-left that go — not zoom" do
    # ⋯ takes a slot of its own, so anything overflowing moves at least two.
    out = run("ROOM = 5 * 42; flush(); out.shown = shown(); out.waiting = waiting();")

    assert out["waiting"] == ~w(fullscreen rotate_left)
    assert out["shown"] == ~w(zoom_in zoom_out rotate home more)
  end

  test "an extension's buttons never move — the built-ins make room for them" do
    out =
      run("""
      attachNavButton(nav, "", "Annotate", noop);
      attachNavButton(nav, "", "Hide annotations", noop);
      ROOM = 4 * 42; flush(); out.shown = shown(); out.waiting = waiting();
      """)

    assert out["shown"] == ["home", "Annotate", "Hide annotations", "more"]
    assert out["waiting"] == ~w(fullscreen zoom_in zoom_out rotate_left rotate)
  end

  test "they come back, in place, when the room does" do
    out =
      run("""
      ROOM = 4 * 42; flush(); ROOM = 1000; nav._frescoNav.relayout(); flush();
      out.shown = shown(); out.waiting = waiting();
      """)

    assert out["shown"] == ~w(fullscreen zoom_in zoom_out rotate_left rotate home)
    assert out["waiting"] == []
  end

  test "a slotted extension button leads the row, in slot order, whoever attached first" do
    out =
      run("""
      attachNavButton(nav, "", "Eye", noop, { slot: 2 });
      attachNavButton(nav, "", "Late", noop);
      attachNavButton(nav, "", "Pencil", noop, { slot: 0 });
      attachNavButton(nav, "", "Chevron", noop, { slot: 1 });
      flush(); out.shown = shown();
      """)

    assert out["shown"] ==
             ["Pencil", "Chevron", "Eye"] ++
               ~w(fullscreen zoom_in zoom_out rotate_left rotate home) ++ ["Late"]
  end

  test "squeezed and given room again, the slotted ones stay first" do
    out =
      run("""
      attachNavButton(nav, "", "Pencil", noop, { slot: 0 });
      ROOM = 4 * 42; flush(); ROOM = 1000; nav._frescoNav.relayout(); flush();
      out.shown = shown();
      """)

    assert out["shown"] == ["Pencil" | ~w(fullscreen zoom_in zoom_out rotate_left rotate home)]
  end

  test "a hidden extension button takes no room" do
    # Etcher's chevron hides when the style panel cannot dock; the row
    # should close up behind it rather than keep its slot.
    out =
      run("""
      var chev = attachNavButton(nav, "", "Shrink the style panel", noop);
      chev.el.hidden = true;
      ROOM = 6 * 42; flush(); out.waiting = waiting();
      """)

    assert out["waiting"] == []
  end

  test "⋯ opens the popover, and closes it again" do
    out =
      run("""
      ROOM = 4 * 42; flush();
      var more = nav.children[nav.children.length - 1];
      more.click(); out.open = !pop.hidden; out.expanded = more.getAttribute("aria-expanded");
      more.click(); out.closed = pop.hidden;
      """)

    assert out["open"]
    assert out["expanded"] == "true"
    assert out["closed"]
  end

  test "an unlaid-out viewer leaves the nav alone rather than collapsing it all" do
    # A closed modal measures zero; folding every button away there would
    # greet the user with a lone ⋯ when it opens.
    out =
      run("""
      host.clientWidth = 0; ROOM = 0; flush(); out.waiting = waiting();
      """)

    assert out["waiting"] == []
  end

  test "nav_overflow keeps the listed buttons behind ⋯ even with room to spare" do
    out =
      run(
        "flush(); out.shown = shown(); out.waiting = waiting();",
        ~s({"layout": "row", "overflow": ["fullscreen", "rotate_left", "rotate", "home"]})
      )

    assert out["shown"] == ~w(zoom_in zoom_out more)
    assert out["waiting"] == ~w(fullscreen rotate_left rotate home)
  end

  test "nav_reverse mirrors the row, so the first buttons sit innermost" do
    src = File.read!(@source)

    assert src =~
             ~s|".fresco-nav[data-layout=\\"row\\"][data-reverse] { flex-direction: row-reverse; }",|

    out =
      run(
        ~s|flush(); out.reverse = nav.getAttribute("data-reverse");|,
        ~s({"layout": "row", "reverse": true})
      )

    assert out["reverse"] == ""
  end

  test "the default stays a column" do
    src = File.read!(@source)

    assert src =~
             ~s|nav.setAttribute("data-layout", opts && opts.layout === "row" ? "row" : "column");|
  end
end
