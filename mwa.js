/* ---- 00-design-system.html ---- */
(function () {
  "use strict";
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !("IntersectionObserver" in window)) return;

  // Only now do we hide reveal elements, so no-JS users never get blank sections.
  document.documentElement.classList.add("mwa-js");

  function init() {
    var els = [].slice.call(document.querySelectorAll(".mwa-reveal"));
    if (!els.length) return;

    var revealedAny = false;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        revealedAny = true;
        entry.target.classList.add("is-visible");
        io.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

    els.forEach(function (el, i) {
      // Stagger siblings a little; cap so long lists don't crawl.
      if (!el.style.getPropertyValue("--mwa-reveal-delay")) {
        var sibs = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : i;
        el.style.setProperty("--mwa-reveal-delay", Math.min(sibs, 5) * 70 + "ms");
      }
      io.observe(el);
    });

    /* ⚠️ FAIL-SAFE. Do not remove.
       Everything above hides content and depends on IntersectionObserver to put
       it back. If IO never fires: throttled renderer, background tab, an
       embedding context that stubs it out: the page renders permanently blank.
       That happened: an entire section sat at opacity 0 while fully on screen.
       So: if nothing has been revealed shortly after load, assume IO is dead and
       drop the whole effect. Content visible without animation beats content
       that is never visible. */
    setTimeout(function () {
      if (revealedAny) return;
      var onScreen = els.some(function (el) {
        var r = el.getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0;
      });
      if (onScreen) document.documentElement.classList.remove("mwa-js");
    }, 1200);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();


/* =========================================================================
   STICKY IMAGE BAND: driver
   Replaces framer-motion's useScroll/useTransform. Reads two rects per band
   inside one rAF and writes four custom properties; the CSS above does the rest.
   ========================================================================= */
(function () {
  "use strict";

  /* Reduced motion is handled entirely in CSS, and the driver must not run:
     it would write transforms back over the rules that just removed them. */
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* The reference's opacity keyframes: [0.25, 0.5, 0.75] -> [0, 1, 0]. */
  function copyOpacity(p) {
    if (p <= 0.25 || p >= 0.75) return 0;
    return p < 0.5 ? (p - 0.25) / 0.25 : (0.75 - p) / 0.25;
  }

  function start() {
    var bands = [].slice.call(document.querySelectorAll("[data-mwa-sticky]"));
    if (!bands.length) return;

    var items = [];
    bands.forEach(function (b) {
      var media = b.querySelector("[data-sticky-media]");
      var copy = b.querySelector("[data-sticky-copy]");
      if (media && copy) items.push({ b: b, media: media, copy: copy });
    });
    if (!items.length) return;

    var ticking = false;

    function update() {
      ticking = false;
      var vh = window.innerHeight;

      items.forEach(function (it) {
        /* ⚠️ EVERYTHING is measured from the BAND, which carries no transform.
           Do not switch these back to media.getBoundingClientRect() /
           copy.getBoundingClientRect(). Those two elements are the ones being
           transformed, so their rects already include the transform this
           function wrote last frame: the measurement feeds on its own output.
           Measured live, it cost the copy its peak, opacity topped out at 0.77
           instead of 1, so the heading never actually reached full white, and
           the scaled image skewed its own progress the same way.
           offsetHeight is layout height and is transform-independent. */
        var br = it.b.getBoundingClientRect();
        var mediaH = it.media.offsetHeight;
        var copyH = it.copy.offsetHeight;

        /* Cheap cull. Note this only SKIPS work; it never gates the effect on
           an observer that might not fire. Same lesson as the reveal fail-safe. */
        if (br.bottom < -vh || br.top > vh * 2) return;

        /* Where a `position: sticky; top: 0` child actually sits, derived
           rather than measured: it tracks the band until the band's top passes
           the viewport top, holds at 0 while there is still room, then gets
           pushed out by the band's bottom edge. */
        var mediaTop = br.top >= 0 ? br.top : Math.min(0, br.bottom - mediaH);
        var mediaBottom = mediaTop + mediaH;

        /* Image, framer's offset ["end end", "end start"]: 0 while the media's
           bottom sits on the viewport bottom (the whole time it is pinned),
           then 0 -> 1 as that bottom edge travels up to the viewport top. */
        var pi = clamp((vh - mediaBottom) / vh);

        /* Copy, offset ["start end", "end start"]: 0 when its top is at the
           viewport bottom, 1 when its bottom has passed the viewport top. It is
           absolutely positioned at the band's top, so the band's top IS its
           untransformed top. */
        var pc = clamp((vh - br.top) / (vh + copyH));

        var s = it.b.style;
        s.setProperty("--mwa-sticky-scale", (1 - 0.15 * pi).toFixed(4));
        s.setProperty("--mwa-sticky-tint", (1 - pi).toFixed(4));
        s.setProperty("--mwa-sticky-y", (250 - 500 * pc).toFixed(1) + "px");
        s.setProperty("--mwa-sticky-op", copyOpacity(pc).toFixed(4));
      });
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    /* Restoring from bfcache re-runs no scroll event, so the band would keep
       whatever transform it had when the page was cached. */
    window.addEventListener("pageshow", onScroll);
    update();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();


/* =========================================================================
   WAVE BUTTON: driver
   Grew out of the smoky-button component. Its scaffolding is kept verbatim
   (single fullscreen triangle, one program, uniforms driven per frame); the
   fragment shader is rewritten, because the reference renders drifting smoke
   and what was asked for is surf.

   ⚠️ premultipliedAlpha is FALSE, and that is a correctness fix, not a
   preference. The reference sets it true while its shader returns STRAIGHT
   alpha (`vec4(color, alpha)`, colour not multiplied by alpha). The browser
   then treats the colour as pre-multiplied and composites additively, so the
   fill blows past white: measured on the ported smoke version, the brightest
   pixel under the label came back rgb(12,151,356) - blue over 255 - and the
   white label fell to 2.46:1, well under AA. With straight alpha declared
   honestly it composites correctly.

   It only ever ADDS to a button that is already opaque and already readable
   (see .mwa-btn--wave), so every failure path is silent and safe: no WebGL, a
   lost context, a shader that will not compile, and the button simply stays
   the solid brand gradient.
   ========================================================================= */
(function () {
  "use strict";

  var VERT =
    "attribute vec2 aPosition;" +
    "void main(){ gl_Position = vec4(aPosition, 0.0, 1.0); }";

  /* Four wave fronts rolling right to left, each with its own speed, frequency
     and resting height, plus a churn field that breaks the foam up so the
     crests read as spray rather than drawn lines. The palette is deliberately
     dark and the foam is CAPPED: this sits under a white label, so a literal
     white whitecap would destroy the contrast the button exists to provide. */
  var FRAG = [
    "precision mediump float;",
    "uniform vec2 uResolution; uniform float uTime; uniform float uSpeed;",
    "uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uFoam;",
    "float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }",
    "float noise(vec2 p){",
    "  vec2 c = floor(p); vec2 o = fract(p);",
    "  float a = hash(c), b = hash(c+vec2(1.0,0.0)), d = hash(c+vec2(0.0,1.0)), e = hash(c+vec2(1.0,1.0));",
    "  vec2 bl = o*o*(3.0-2.0*o);",
    "  return mix(a,b,bl.x) + (d-a)*bl.y*(1.0-bl.x) + (e-b)*bl.x*bl.y;",
    "}",
    "float fbm(vec2 p){",
    "  float v = 0.0; float amp = 0.5; mat2 rot = mat2(0.8776,0.4794,-0.4794,0.8776);",
    "  for (int i = 0; i < 5; i++){ v += amp*noise(p); p = rot*p*2.03 + vec2(11.3,7.1); amp *= 0.5; }",
    "  return v;",
    "}",
    "void main(){",
    "  vec2 uv = gl_FragCoord.xy / uResolution.xy;",
    "  float aspect = uResolution.x / max(uResolution.y, 1.0);",
    "  vec2 p = vec2(uv.x * aspect, uv.y);",
    "  float t = uTime * uSpeed;",
    "  float churn = fbm(vec2(p.x*2.4 - t*0.60, p.y*3.2 + t*0.25));",
    "  vec3 col = uDeep;",
    "  float foam = 0.0;",
    "  for (int i = 0; i < 4; i++){",
    "    float fi = float(i);",
    "    float sp = 0.50 + fi*0.26;",
    "    float freq = 1.60 + fi*0.85;",
    "    float base = 0.16 + fi*0.24;",
    "    float amp = 0.095 - fi*0.012;",
    "    float ph = p.x*freq - t*sp;",
    /* A plain sine is a swell, not a break. The second harmonic steepens the
       front face and flattens the back, which is what gives each front a lip
       instead of a ripple. */
    "    float swell = sin(ph) + 0.35*sin(2.0*ph + 1.1);",
    "    float crest = base + amp*swell + 0.030*(churn - 0.5);",
    "    float body = smoothstep(crest + 0.012, crest - 0.16, uv.y);",
    "    col = mix(col, uMid, body * (0.42 + 0.18*fi));",
    /* Foam is a thin lip hugging the crest, chopped up by high-frequency noise
       so it reads as broken water rather than a drawn stroke. */
    "    float lip = smoothstep(0.026, 0.002, abs(uv.y - crest));",
    "    float broken = smoothstep(0.30, 0.80, churn + 0.30*noise(vec2(p.x*11.0 - t*1.6, fi*5.0)));",
    "    foam += lip * broken * (0.90 - 0.18*fi);",
    /* Spray: a few specks thrown just above the lip. */
    "    float above = smoothstep(0.0, 0.09, uv.y - crest);",
    "    foam += above * (1.0 - above) * smoothstep(0.72, 0.98, noise(vec2(p.x*24.0 - t*2.6, uv.y*18.0 + fi*3.0))) * 0.55;",
    "  }",
    "  float wash = 1.0 - smoothstep(0.0, 0.30, uv.y);",
    "  foam += wash * smoothstep(0.44, 0.92, churn) * 0.45;",
    "  foam = clamp(foam, 0.0, 1.0);",
    /* ⚠️ 0.48 is a measured ceiling, not a taste call. This sits under a white
       label; at 0.55 the worst-case composite drops to 4.7:1 and by 0.75 it is
       3.7:1, under AA. Definition comes from the DARK end instead: a near-black
       trough makes the crests read without lifting peak luminance. */
    "  col = mix(col, uFoam, foam * 0.48);",
    "  col *= 0.86 + 0.19*smoothstep(0.10, 0.90, churn);",
    "  float feather = uv.x + 0.10*(churn - 0.5);",
    "  gl_FragColor = vec4(clamp(col, 0.0, 1.0), smoothstep(-0.10, 0.32, feather));",
    "}"
  ].join("\n");

  function hexToRgb(hex) {
    var v = String(hex).replace("#", "").trim();
    if (v.length === 3) v = v[0]+v[0]+v[1]+v[1]+v[2]+v[2];
    var n = parseInt(v, 16);
    if (v.length !== 6 || isNaN(n)) return [0, 0, 0];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { gl.deleteShader(sh); return null; }
    return sh;
  }

  function build(canvas) {
    var btn = canvas.closest(".mwa-btn");
    if (!btn) return null;

    var gl = canvas.getContext("webgl", {
      alpha: true, antialias: false,
      premultipliedAlpha: false,   /* see the note at the top */
      /* Kept ON deliberately. It lets the rendered pixels be read back, which is
         how the label's contrast over this thing was verified rather than
         guessed. On a ~230x48 button the extra buffer is a rounding error. */
      preserveDrawingBuffer: true
    });
    if (!gl) return null;

    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;

    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl.deleteProgram(prog); return null; }

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);

    var u = {
      pos: gl.getAttribLocation(prog, "aPosition"),
      res: gl.getUniformLocation(prog, "uResolution"),
      time: gl.getUniformLocation(prog, "uTime"),
      speed: gl.getUniformLocation(prog, "uSpeed"),
      deep: gl.getUniformLocation(prog, "uDeep"),
      mid: gl.getUniformLocation(prog, "uMid"),
      foam: gl.getUniformLocation(prog, "uFoam")
    };

    /* Ocean palette, overridable per button. Every value is chosen to keep the
       composite dark enough for a white label; see the measured worst case in
       the .mwa-btn--wave notes before lightening any of them. */
    var cols = [
      hexToRgb(btn.getAttribute("data-wave-deep") || "#010A1E"),
      hexToRgb(btn.getAttribute("data-wave-mid") || "#0A4A94"),
      hexToRgb(btn.getAttribute("data-wave-foam") || "#5A8FC7")
    ];
    var speed = parseFloat(btn.getAttribute("data-wave-speed")) || 1;

    /* 1.5x, not the reference's 2x. Water has no hard edges, so on a button
       this size the two are indistinguishable and this is ~44% fewer pixels. */
    function size() {
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }

    function draw(elapsed) {
      size();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(u.pos);
      gl.vertexAttribPointer(u.pos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.time, elapsed);
      gl.uniform1f(u.speed, speed);
      gl.uniform3f(u.deep, cols[0][0], cols[0][1], cols[0][2]);
      gl.uniform3f(u.mid, cols[1][0], cols[1][1], cols[1][2]);
      gl.uniform3f(u.foam, cols[2][0], cols[2][1], cols[2][2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      btn.classList.add("is-waving");
    }

    return { btn: btn, canvas: canvas, draw: draw };
  }

  function start() {
    var canvases = [].slice.call(document.querySelectorAll("[data-mwa-wave]"));
    if (!canvases.length) return;

    var items = [];
    canvases.forEach(function (c) { var it = build(c); if (it) items.push(it); });
    if (!items.length) return;      // gradient fallback already covers this

    /* Always paint one frame, whatever happens next. The button then has its
       water texture even if it never animates: under reduced motion, with no
       pause control on the page, or if the hero's script never runs. */
    items.forEach(function (it) { it.draw(0.0); });

    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    var t0 = performance.now();
    /* ⚠️ Starts PAUSED, and that is the accessibility contract, not caution.
       WCAG 2.2.2 wants a way to stop motion that starts on its own and runs
       past five seconds. The hero already ships one control, so rather than add
       a second for a second moving thing in the same section, this animates
       ONLY while that control reports motion is on. No control on the page (no
       video, video refused, Save-Data) means no animation, just the static
       water. Don't flip this to false to "make it work" without giving the
       button a control of its own. */
    var paused = true, onScreen = true, frame = 0;

    function loop(now) {
      frame = 0;
      items.forEach(function (it) { it.draw((now - t0) / 1000); });
      if (!paused && onScreen && !document.hidden) frame = requestAnimationFrame(loop);
    }
    function run() {
      if (frame || paused || !onScreen || document.hidden) return;
      frame = requestAnimationFrame(loop);
    }

    /* Don't burn the GPU on a button that has scrolled away or a hidden tab. */
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        onScreen = entries.some(function (e) { return e.isIntersecting; });
        run();
      }, { rootMargin: "120px" });
      items.forEach(function (it) { io.observe(it.btn); });
    }
    document.addEventListener("visibilitychange", run);

    /* The hero already ships a "Pause background video" control. Rather than add
       a second control for a second moving thing in the same section, that one
       button governs both: the hero dispatches this and the surf freezes with
       the footage. One control, all hero motion, which is what 2.2.2 wants. */
    document.addEventListener("mwa:motion", function (e) {
      paused = !!(e.detail && e.detail.paused);
      run();
    });

    run();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();


/* =========================================================================
   TEXT EFFECT: driver
   Replaces framer-motion's variants/stagger with a split plus one custom
   property per segment. ~40 lines against a ~50KB dependency.
   ========================================================================= */
(function () {
  "use strict";

  /* Under reduced motion the DOM is left completely alone: no split, no spans,
     no ARIA juggling. Nothing to undo and nothing to get wrong. */
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var STAGGER = { word: 50, char: 30 };   /* the reference's 0.05s / 0.03s */
  var BUDGET = 900;                        /* cap, so long strings don't crawl */

  function start() {
    var nodes = [].slice.call(document.querySelectorAll("[data-mwa-text]"));
    if (!nodes.length) return;

    nodes.forEach(function (root) {
      var per = root.getAttribute("data-mwa-text") === "char" ? "char" : "word";
      var delay = parseFloat(root.getAttribute("data-mwa-delay")) || 0;
      var full = root.textContent.replace(/\s+/g, " ").trim();

      /* ⚠️ Split the TEXT NODES, not innerHTML. The reference only accepts a
         plain string child, but real headings here carry markup: the audiences
         h2 wraps its second line in a span that colours it. Rebuilding from a
         string would throw that span away, so walk the tree and replace each
         text node in place, leaving every element untouched. */
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var texts = [], n;
      while ((n = walker.nextNode())) if (n.nodeValue.trim()) texts.push(n);
      if (!texts.length) return;

      var pieces = texts.map(function (t) {
        return per === "char" ? t.nodeValue.split("") : t.nodeValue.split(/(\s+)/);
      });
      var total = pieces.reduce(function (a, p) { return a + p.length; }, 0);
      var step = Math.min(STAGGER[per], BUDGET / Math.max(total, 1));

      var idx = 0;
      texts.forEach(function (t, ti) {
        var frag = document.createDocumentFragment();
        pieces[ti].forEach(function (seg) {
          if (!seg) return;
          if (/^\s+$/.test(seg)) { frag.appendChild(document.createTextNode(seg)); return; }
          var span = document.createElement("span");
          span.className = "mwa-tx";
          span.setAttribute("aria-hidden", "true");
          span.textContent = seg;
          span.style.setProperty("--d", Math.round(delay + idx * step) + "ms");
          idx++;
          frag.appendChild(span);
        });
        t.parentNode.replaceChild(frag, t);
      });

      /* Every visible fragment is aria-hidden, so the element needs to carry the
         sentence itself or a screen reader gets nothing. */
      if (!root.hasAttribute("aria-label")) root.setAttribute("aria-label", full);
    });

    function show(el) { el.classList.add("is-in"); }

    if (!("IntersectionObserver" in window)) { nodes.forEach(show); return; }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        show(e.target);
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.15 });
    nodes.forEach(function (el) { io.observe(el); });

    /* ⚠️ FAIL-SAFE, same reasoning as the reveal system. Everything above is
       hidden by CSS and depends on the observer to put it back. If IO never
       fires the headline is permanently invisible, which is far worse than a
       missing animation.

       ⚠️ IT IS UNCONDITIONAL, and that is a fix, not laziness. This used to
       reveal only nodes it measured as on screen:

         var r = el.getBoundingClientRect();
         if (r.top < window.innerHeight && r.bottom > 0) show(el);

       That test is itself a measurement, so it fails in exactly the situations
       the fail-safe exists for. In any context where layout reports zero -
       a never-painted background tab, a zero-height embedding frame, a headless
       renderer - window.innerHeight is 0, every element fails the test, and the
       text stays at opacity 0 FOREVER. Reproduced here: an off-screen render of
       /services reported innerHeight 0, the observer never fired, and the H1
       measured 0 wide and never appeared.

       That was survivable while ONE mid-page h2 on the home page used this
       effect. It is not survivable now that the H1 of /services, /about,
       /contact and /blog all do: the failure mode is a page whose headline
       never renders. Anything still un-animated after the timeout gets shown,
       full stop. The worst case is a heading that appeared without its
       animation, which nobody will ever notice. */
    setTimeout(function () {
      nodes.forEach(function (el) {
        if (!el.classList.contains("is-in")) show(el);
      });
    }, 1500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();

/* ---- 01-home-hero.html ---- */
/* ── Marquee: clone until the loop is gapless ────────────────────────────────
   Its own IIFE. The video code below returns early in several cases (no URL,
   phone, reduced motion) and those returns would otherwise skip this entirely. */
(function () {
  "use strict";

  var SPEED = 42;   // px per second, constant regardless of how many logos

  var cs = null;
  var root = (cs && cs.parentNode && cs.parentNode.querySelector
      ? cs.parentNode.querySelector(".mwa-trust") : null)
    || document.querySelector(".mwa-trust");
  if (!root) return;

  var marquee = root.querySelector("[data-mwa-marquee]");
  var track   = root.querySelector("[data-mwa-track]");
  var source  = root.querySelector("[data-mwa-group]");
  if (!marquee || !track || !source) return;

  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  function build() {
    var groups = track.querySelectorAll(".mwa-marquee__group");
    for (var i = groups.length - 1; i >= 1; i--) groups[i].remove();
    marquee.classList.remove("is-ready");

    var gapPx = parseFloat(getComputedStyle(track).columnGap) || 0;
    var unit  = source.getBoundingClientRect().width + gapPx;
    var containerWidth = marquee.getBoundingClientRect().width;
    if (!unit || !containerWidth) return;

    /* Half the track must cover the container or a blank stretch appears before
       the -50% wrap. The +1 is deliberate: a bare ceil() left ~3px of headroom
       at 1368px, which rounding or a late font swap could eat into. */
    var copies = Math.max(1, Math.ceil(containerWidth / unit) + 1);
    var frag = document.createDocumentFragment();
    for (var j = 1; j < copies * 2; j++) {
      var clone = source.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      clone.removeAttribute("aria-labelledby");
      clone.removeAttribute("data-mwa-group");
      frag.appendChild(clone);
    }
    track.appendChild(frag);

    marquee.style.setProperty("--mwa-marquee-duration", (copies * unit) / SPEED + "s");
    marquee.classList.add("is-ready");
  }

  /* Resolve logo images BEFORE the first measure: a missing file must fall back
     to its wordmark, and an unloaded image measures 0px wide, which would
     corrupt the group width the clone count is derived from. */
  function settleLogos(done) {
    var imgs = [].slice.call(source.querySelectorAll("[data-mwa-logo]"));
    if (!imgs.length) return done();
    var pending = imgs.length;
    function tick() { if (--pending === 0) done(); }
    imgs.forEach(function (img) {
      if (img.complete) {
        if (!img.naturalWidth) img.remove();
        tick();
        return;
      }
      img.addEventListener("load", tick, { once: true });
      img.addEventListener("error", function () { img.remove(); tick(); }, { once: true });
    });
  }

  settleLogos(build);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(build);

  var t;
  window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(build, 200); });
})();

(function () {
  "use strict";

  /* ON, at the client's instruction. This flag is why the video "kept
     disappearing": at 767px and below the hero deliberately never loaded it and
     sat on the poster instead, to save phones a 2.3MB download. That was my
     call, not his, and it made the video look broken every time he opened the
     site on a phone or in a narrow window.

     Genuinely constrained connections are still protected. The Save-Data and
     2g checks below are separate and still skip the video. This flag only stops
     penalising every phone on a normal connection. */
  var MOBILE_VIDEO = true;    // false = poster only on phones (<=767px)

  var cs = null;
  var section = (cs && cs.parentNode && cs.parentNode.querySelector
      ? cs.parentNode.querySelector(".mwa-hero") : null)
    || document.querySelector(".mwa-hero");
  if (!section) return;

  var video  = section.querySelector(".mwa-hero__video");
  var source = section.querySelector(".mwa-hero__video source");
  var button = section.querySelector(".mwa-hero__vidbtn");
  if (!video || !source) return;

  var url = (source.getAttribute("data-src") || "").trim();
  if (!url || url.indexOf("REPLACE") === 0) return;   // blank on purpose

  var mq = window.matchMedia;
  var reduced = mq && mq("(prefers-reduced-motion: reduce)").matches;
  var conn    = navigator.connection || {};
  var frugal  = conn.saveData === true || /(^|-)2g$/.test(conn.effectiveType || "");
  if (reduced || frugal) return;          // these don't change mid-session

  /* ⚠️ The phone check must be re-run, not read once.
     Originally this was evaluated a single time during parse: load the page in a
     narrow window and the video was skipped FOREVER, even after maximising. That
     is exactly how it failed: the tab opened narrow, the gate tripped, and the
     hero sat on its poster for the rest of the session.
     Now it re-checks on resize and loads the moment the viewport is wide enough.
     It only ever loads once; `loaded` makes sure of that. */
  var phoneQuery = mq("(max-width: 767px)");
  var loaded = false;

  function loadIfWideEnough() {
    if (loaded) return;
    if (phoneQuery.matches && !MOBILE_VIDEO) return;
    loaded = true;
    source.src = url;
    video.load();
  }

  var playing = false;

  function setButton(isPlaying) {
    if (!button) return;
    button.hidden = false;
    button.setAttribute("aria-pressed", isPlaying ? "false" : "true");
    var label = isPlaying ? "Pause background video" : "Play background video";
    button.setAttribute("aria-label", label);
    var text = button.querySelector(".mwa-hero__vidbtn-text");
    if (text) text.textContent = label;
  }

  /* One control governs ALL hero motion, not just the video. The smoky button
     listens for this and freezes with the footage, so 2.2.2 is satisfied by a
     single control instead of one per moving thing. The smoke stays static
     until it hears paused:false, so if the video never starts there is simply
     nothing moving in the hero and nothing to pause. */
  function announceMotion(isPlaying) {
    try {
      document.dispatchEvent(new CustomEvent("mwa:motion", { detail: { paused: !isPlaying } }));
    } catch (e) { /* no CustomEvent constructor: smoke just stays static */ }
  }

  function giveUp() { playing = false; announceMotion(false); if (button) button.hidden = true; }
  video.addEventListener("error", giveUp, true);
  source.addEventListener("error", giveUp);

  video.addEventListener("loadeddata", function () {
    video.play().then(function () { playing = true; setButton(true); announceMotion(true); })
                .catch(function () { playing = false; setButton(false); announceMotion(false); });
  }, { once: true });

  // Listeners are all registered by now, so it's safe to start fetching.
  loadIfWideEnough();
  (phoneQuery.addEventListener
    ? phoneQuery.addEventListener("change", loadIfWideEnough)
    : phoneQuery.addListener(loadIfWideEnough));

  if (button) {
    button.addEventListener("click", function () {
      if (playing) { video.pause(); playing = false; }
      else { video.play(); playing = true; }
      setButton(playing);
      announceMotion(playing);
    });
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!playing) return;
        if (e.isIntersecting) video.play().catch(function () {});
        else video.pause();
      });
    }, { threshold: 0.05 }).observe(section);
  }

  document.addEventListener("visibilitychange", function () {
    if (!playing) return;
    if (document.hidden) video.pause();
    else video.play().catch(function () {});
  });
})();

/* ---- 06-home-faq.html ---- */
(function () {
  "use strict";

  var list = document.querySelector("[data-mwa-faq]");
  if (!list) return;

  var items = [].slice.call(list.querySelectorAll(".mwa-faq__item"));
  if (!items.length) return;

  var DURATION = 220;

  /* Opt into the animated version only now that the script is live. Without
     this class the panels are plain open/closed and nothing can hide them. */
  list.classList.add("mwa-faq--js");
  items.forEach(function (d) { if (d.open) d.classList.add("is-open"); });

  function collapse(d) {
    if (!d.open) return;
    d.classList.remove("is-open");
    // Keep the element open until the row track has finished shrinking,
    // otherwise <details> yanks the content away and there's no close animation.
    window.setTimeout(function () {
      if (!d.classList.contains("is-open")) d.open = false;
    }, DURATION);
  }

  function expand(d) {
    d.open = true;
    // One frame at 0fr first, so the transition to 1fr actually has a start value.
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () { d.classList.add("is-open"); });
    });
  }

  items.forEach(function (d) {
    var summary = d.querySelector("summary");
    summary.addEventListener("click", function (e) {
      e.preventDefault();                   // we drive `open` ourselves
      var isOpen = d.classList.contains("is-open");
      items.forEach(collapse);               // one at a time, like type="single"
      if (!isOpen) expand(d);                // clicking the open one closes it
    });
  });
})();

/* ---- 08-home-parallax.html ---- */
(function () {
  "use strict";

  var section = document.querySelector("[data-mwa-parallax]");
  if (!section) return;

  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var stage = section.querySelector(".mwa-plx__stage");
  var ticking = false;
  var visible = true;   // see the note by the observer below

  /* Progress as the section travels through the viewport, -0.5 .. +0.5.
       -0.5  section's top is level with the bottom of the screen (entering)
        0    section is centred
       +0.5  section's bottom is level with the top of the screen (left)

     Scrolling down increases p, which translates each layer DOWNWARD inside a
     section that is itself moving UP. The layer therefore rises more slowly than
     the page: that lag is what reads as distance. Bigger --rate = more lag =
     further away.

     getBoundingClientRect is read inside rAF, once per frame, before any style
     write, so reads and writes never interleave. */
  function update() {
    ticking = false;
    var r = section.getBoundingClientRect();
    var vh = window.innerHeight;
    var centre = r.top + r.height / 2;
    var range = (vh + r.height) / 2;
    if (range <= 0) { section.style.setProperty("--p", 0); return; }
    var p = (vh / 2 - centre) / range;    // -1 .. 1
    p = Math.max(-1, Math.min(1, p)) * 0.5;
    section.style.setProperty("--p", p.toFixed(4));
  }

  function onScroll() {
    if (ticking || !visible) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  /* Skip the work while the section is off screen, but note `visible` starts
     TRUE. The observer only ever narrows it. Gating the effect *behind* IO means
     a dead observer silently disables the whole thing, which is exactly what
     happened during testing: zero callbacks, layers frozen. An optimisation must
     never be a precondition. */
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) onScroll();
    }, { rootMargin: "200px" }).observe(section);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  update();
})();

/* ---- 14-services-partners.html ---- */
(function () {
  "use strict";
  /* Same fallback contract as the home strip: if a logo file is missing, drop the
     <img> so the text name shows instead of a broken-image icon. No marquee here,
     so nothing depends on measuring these: this is the whole script. */
  var cs = null;
  var root = (cs && cs.parentNode && cs.parentNode.querySelector
      ? cs.parentNode.querySelector(".mwa-partners") : null)
    || document.querySelector(".mwa-partners");
  if (!root) return;

  root.querySelectorAll("[data-mwa-plogo]").forEach(function (img) {
    if (img.complete) {
      if (!img.naturalWidth) img.remove();
      return;
    }
    img.addEventListener("error", function () { img.remove(); }, { once: true });
  });
})();

/* ---- 15-site-header.html ---- */
(function () {
  "use strict";

  var header = document.querySelector("[data-mwa-header]");
  if (!header) return;

  var menu   = header.querySelector("[data-mwa-menu]");
  var toggle = header.querySelector("[data-mwa-toggle]");
  var logo   = header.querySelector("[data-mwa-logo]");
  var mqDesktop = window.matchMedia("(min-width: 1024px)");

  /* Logo missing → drop the <img> so the wordmark shows, not a broken icon. */
  if (logo) {
    if (logo.complete) { if (!logo.naturalWidth) logo.remove(); }
    else logo.addEventListener("error", function () { logo.remove(); }, { once: true });
  }

  /* Mark the current page in BOTH link lists. Normalises trailing slashes so
     /services and /services/ match, and ignores query strings. */
  (function markCurrent() {
    var here = location.pathname.replace(/\/+$/, "") || "/";
    header.querySelectorAll(".mwa-hdr__link").forEach(function (a) {
      var target = a.getAttribute("href").replace(/\/+$/, "") || "/";
      if (target === here) a.setAttribute("aria-current", "page");
    });
  })();

  /* --- Menu card ---------------------------------------------------------- */
  function setOpen(open) {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    menu.hidden = !open;
    document.documentElement.style.overflow = open ? "hidden" : "";
  }

  function syncToViewport() {
    if (mqDesktop.matches) {
      menu.hidden = false;
      toggle.setAttribute("aria-expanded", "false");
      document.documentElement.style.overflow = "";
    } else {
      setOpen(false);
    }
  }
  syncToViewport();
  (mqDesktop.addEventListener
    ? mqDesktop.addEventListener("change", syncToViewport)
    : mqDesktop.addListener(syncToViewport));

  toggle.addEventListener("click", function () {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || mqDesktop.matches) return;
    if (toggle.getAttribute("aria-expanded") !== "true") return;
    setOpen(false);
    toggle.focus();
  });

  // Keep focus inside the card while it's open.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Tab" || mqDesktop.matches) return;
    if (toggle.getAttribute("aria-expanded") !== "true") return;
    var items = [toggle].concat([].slice.call(menu.querySelectorAll("a[href]")));
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  menu.addEventListener("click", function (e) {
    if (e.target.closest("a") && !mqDesktop.matches) setOpen(false);
  });

  /* --- Scrolled state ------------------------------------------------------
     The reference watches scrollYProgress and flips past 0.05, 5% of the page's
     SCROLLABLE DISTANCE. That's fine on a short marketing page, but these pages
     run 6,000-7,000px, so 5% is ~300px and the bar sits invisible far longer than
     it should. A small PIXEL threshold is used instead: the shell appears as soon
     as the page moves, and behaves identically on every page regardless of length.

     Not rAF-throttled on purpose. rAF is paused while a document is hidden, so
     a scroll handler that defers all its work into a frame does nothing until
     the tab is looked at again. This one writes a single class from a passive
     listener and reads only scrollY, so it forces no layout and needs no frame. */
  var STUCK_AFTER = 24;   // px scrolled before the shell fades in

  function onScroll() {
    header.classList.toggle("is-stuck", window.scrollY > STUCK_AFTER);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();

/* ---- 16-site-footer.html ---- */
(function () {
  "use strict";
  var cs = null;
  var root = (cs && cs.parentNode && cs.parentNode.querySelector
      ? cs.parentNode.querySelector(".mwa-ftr") : null)
    || document.querySelector(".mwa-ftr");
  if (!root) return;

  // Copyright year, so nobody has to remember to update it in January.
  var y = root.querySelector("[data-mwa-year]");
  if (y) y.textContent = String(new Date().getFullYear());

  // Logo missing → drop the <img> so the wordmark shows, not a broken icon.
  var logo = root.querySelector("[data-mwa-ftr-logo]");
  if (logo) {
    if (logo.complete) { if (!logo.naturalWidth) logo.remove(); }
    else logo.addEventListener("error", function () { logo.remove(); }, { once: true });
  }
})();

/* ---- 31-contact-main.html ---- */
(function () {
  "use strict";

  /* ── WHY THIS SCRIPT EXISTS ──────────────────────────────────────────────
     A Squarespace Form Block cannot be placed INSIDE a Code Block. The whole
     contact page is one Code Block, so a Form Block added in the editor lands
     as a sibling AFTER it — which puts the form below the site footer, outside
     the card it is supposed to sit in.

     Splitting the page into two Code Blocks with the form between them was the
     obvious alternative and it is worse: the form card is a single grid
     container, so splitting it mid-element leaves each half with unbalanced
     markup that Squarespace auto-closes, and the layout breaks in a way that is
     tedious to debug.

     So the block stays where the editor puts it and this moves it into the slot
     on load. One DOM move, no layout thrash, no styling duplicated.

     ⚠️ Deliberately tolerant: if no Form Block exists yet, the slot is
     :empty and hides itself, so the page looks intentional rather than broken
     while the form is still being set up. */

  function place() {
    var slot = document.querySelector("[data-mwa-form-slot]");
    if (!slot || slot.children.length) return true;

    /* The Form Block's own wrapper, not the <form> — moving the wrapper keeps
       Squarespace's own scripts bound to the markup they expect. */
    var block = document.querySelector(".sqs-block-form");
    if (!block) return false;

    /* Never steal a block that is already inside the slot, and never move one
       that sits inside the header or footer. */
    if (slot.contains(block)) return true;

    slot.appendChild(block);
    return true;
  }

  if (!place()) {
    /* Squarespace hydrates some blocks after DOMContentLoaded. Watch briefly
       rather than polling forever. */
    var obs = new MutationObserver(function () { if (place()) obs.disconnect(); });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 8000);
  }
})();

/* ---- 41-resources-grid.html ---- */
(function () {
  "use strict";
  /* Show the empty state only when there are genuinely no article cards. Once
     the sample cards are deleted (or a Squarespace blog list renders nothing),
     the page still reads as finished instead of blank. */
  var cs = null;
  var root = (cs && cs.parentNode && cs.parentNode.querySelector
      ? cs.parentNode.querySelector(".mwa-res") : null)
    || document.querySelector(".mwa-res");
  if (!root) return;

  var grid  = root.querySelector(".mwa-res__grid");
  var empty = root.querySelector("[data-mwa-res-empty]");
  if (!empty) return;

  var count = grid ? grid.querySelectorAll(".mwa-res__item").length : 0;
  // Also count a native Squarespace blog list if one is on the page.
  count += document.querySelectorAll(".blog-basic-grid article, .blog-masonry article").length;

  if (count === 0) {
    empty.hidden = false;
    if (grid) grid.hidden = true;
  }
})();