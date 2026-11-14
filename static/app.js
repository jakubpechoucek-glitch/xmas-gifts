(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const SVGNS = "http://www.w3.org/2000/svg";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // On plain hosts (AUTH_MODE=email) the viewer types their work e-mail; it is kept for this tab only.
  const EMAIL_KEY = "xmas-email";
  const emailStore = {
    get() { try { return sessionStorage.getItem(EMAIL_KEY) || ""; } catch (e) { return ""; } },
    set(v) { try { sessionStorage.setItem(EMAIL_KEY, v); } catch (e) { /* storage may be blocked */ } },
    clear() { try { sessionStorage.removeItem(EMAIL_KEY); } catch (e) { /* ignore */ } },
  };
  // The page's query string is forwarded for local testing (XMAS_DEV=1 only; ignored by the server otherwise).
  const api = (path) => {
    const headers = {};
    const email = emailStore.get();
    if (email) headers["X-Xmas-Email"] = email;
    return fetch(path + window.location.search, { cache: "no-store", headers });
  };

  function svgEl(name, attrs, parent) {
    const n = document.createElementNS(SVGNS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function starPoints(cx, cy, R, r, n = 5) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / n;
      const rad = i % 2 ? r : R;
      pts.push(`${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad).toFixed(1)}`);
    }
    return pts.join(" ");
  }

  // ------------------------------------------------------------------ music
  // A short "Jingle Bells" (public domain) synthesised with Web Audio, so no audio file is needed.
  const Music = (() => {
    let ctx = null;
    let master = null;
    let on = true;
    let timer = null;
    const F = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0 };
    const TUNE = [
      ["E4", 1], ["E4", 1], ["E4", 2], ["E4", 1], ["E4", 1], ["E4", 2],
      ["E4", 1], ["G4", 1], ["C4", 1.5], ["D4", 0.5], ["E4", 4],
      ["F4", 1], ["F4", 1], ["F4", 1.5], ["F4", 0.5], ["F4", 1], ["E4", 1], ["E4", 1], ["E4", 0.5], ["E4", 0.5],
      ["E4", 1], ["D4", 1], ["D4", 1], ["E4", 1], ["D4", 2], ["G4", 2],
    ];
    const BEAT = 0.42;

    function ensure() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
      }
      if (!master) {
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
      return true;
    }

    function tone(freq, t, dur, vol = 0.2) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.35);
      g.connect(master);
      [[freq, "sine", 1], [freq * 2, "sine", 0.35], [freq * 3.01, "sine", 0.1]].forEach(([f, type, k]) => {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.type = type;
        o.frequency.value = f;
        og.gain.value = k;
        o.connect(og).connect(g);
        o.start(t);
        o.stop(t + dur * 1.4);
      });
    }

    function loop() {
      if (!on || !ensure()) return;
      let t = ctx.currentTime + 0.05;
      for (const [n, beats] of TUNE) {
        tone(F[n] * 2, t, beats * BEAT);
        tone(F[n], t, beats * BEAT, 0.07);
        t += beats * BEAT;
      }
      timer = setTimeout(loop, (t - ctx.currentTime + 1.8) * 1000);
    }

    function arpeggio(freqs, gap, vol) {
      if (!on || !ensure()) return;
      const t = ctx.currentTime + 0.03;
      freqs.forEach((f, i) => tone(f, t + i * gap, 0.5, vol));
    }

    return {
      start() { on = true; clearTimeout(timer); loop(); },
      stop() {
        on = false;
        clearTimeout(timer);
        if (master) { master.disconnect(); master = null; }
      },
      toggle() { if (on) this.stop(); else this.start(); return on; },
      ding() { arpeggio([1046.5, 1318.5, 1568], 0.09, 0.16); },
      fanfare() { arpeggio([523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093], 0.11, 0.18); },
      get on() { return on; },
    };
  })();

  // ------------------------------------------------------------------ snow + confetti
  const FX = (() => {
    const cv = $("#fx");
    const c = cv.getContext("2d");
    let w = 0, h = 0;
    const flakes = [];
    const bits = [];
    const COLORS = ["#ffd54a", "#ff5e57", "#4fc3f7", "#ff8ad8", "#9be564", "#ffffff"];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const want = reduceMotion ? 30 : Math.round(Math.min(150, (w * h) / 9000));
      while (flakes.length < want) flakes.push({ x: Math.random() * w, y: Math.random() * h, r: 1 + Math.random() * 2.4, v: 0.3 + Math.random() * 0.9, p: Math.random() * 6.28 });
      flakes.length = want;
    }

    function frame() {
      c.clearRect(0, 0, w, h);
      c.fillStyle = "rgba(255,255,255,0.85)";
      for (const f of flakes) {
        f.y += f.v; f.p += 0.015; f.x += Math.sin(f.p) * 0.35;
        if (f.y > h + 4) { f.y = -4; f.x = Math.random() * w; }
        c.beginPath(); c.arc(f.x, f.y, f.r, 0, 6.283); c.fill();
      }
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i];
        b.vy += 0.14; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.rot += b.vr;
        if (b.y > h + 20) { bits.splice(i, 1); continue; }
        c.save(); c.translate(b.x, b.y); c.rotate(b.rot); c.fillStyle = b.color;
        c.fillRect(-b.s / 2, -b.s / 3, b.s, b.s * 0.6); c.restore();
      }
      requestAnimationFrame(frame);
    }

    function burst(x, y, n = 90) {
      const count = reduceMotion ? Math.min(n, 18) : n;
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const sp = 4 + Math.random() * 8;
        bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: 5 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, color: COLORS[(Math.random() * COLORS.length) | 0] });
      }
    }

    window.addEventListener("resize", resize);
    resize();
    requestAnimationFrame(frame);
    return { burst };
  })();

  // ------------------------------------------------------------------ small UI helpers
  let toastTimer = null;
  function toast(msg, ms = 3200) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }

  const cardWrap = $("#card-wrap");
  let onCardClose = null;
  function showCard({ icon, title, text }, afterClose) {
    $("#card-icon").textContent = icon || "🎁";
    $("#card-title").textContent = title || "";
    const p = $("#card-text");
    p.textContent = text || "";
    p.classList.toggle("short", (text || "").length < 110);
    onCardClose = afterClose || null;
    cardWrap.classList.remove("hidden");
    $("#card-close").focus();
  }
  function closeCard() {
    if (cardWrap.classList.contains("hidden")) return;
    cardWrap.classList.add("hidden");
    const cb = onCardClose;
    onCardClose = null;
    if (cb) cb();
  }
  $("#card-close").addEventListener("click", closeCard);
  cardWrap.addEventListener("click", (e) => { if (e.target === cardWrap) closeCard(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCard(); });

  function centerOf(node) {
    const r = node.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  // ------------------------------------------------------------------ scene
  const TIERS = [
    { tri: [[200, 62], [262, 174], [138, 174]], n: 8 },
    { tri: [[200, 108], [290, 252], [110, 252]], n: 12 },
    { tri: [[200, 168], [326, 352], [74, 352]], n: 16 },
    { tri: [[200, 238], [352, 442], [48, 442]], n: 20 },
  ];
  const LIGHT_COLORS = ["#ffd54a", "#ff5e57", "#4fc3f7", "#ff8ad8", "#9be564"];

  function pointIn([a, b, c], rnd) {
    let u = rnd(), v = rnd();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    return [a[0] + u * (b[0] - a[0]) + v * (c[0] - a[0]), a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1])];
  }

  function drawDecorations() {
    const rnd = mulberry32(2026);
    const lights = $("#lights");
    const orn = $("#ornaments");
    for (const tier of TIERS) {
      for (let i = 0; i < tier.n; i++) {
        const [x, y] = pointIn(tier.tri, rnd);
        const col = LIGHT_COLORS[(rnd() * LIGHT_COLORS.length) | 0];
        const dot = svgEl("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 3.2, fill: col, class: "light" }, lights);
        dot.style.animationDelay = `${(rnd() * 1.8).toFixed(2)}s`;
        dot.style.filter = `drop-shadow(0 0 3px ${col})`;
      }
    }
    const ballColors = ["#e53935", "#ffd54a", "#1e88e5", "#ec407a"];
    for (let i = 0; i < 13; i++) {
      const tier = TIERS[1 + ((i / 5) | 0) % 3];
      const [x, y] = pointIn(tier.tri, rnd);
      const col = ballColors[i % ballColors.length];
      svgEl("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 5.5, fill: col, stroke: "rgba(0,0,0,.25)", "stroke-width": 0.8 }, orn);
      svgEl("circle", { cx: (x - 1.8).toFixed(1), cy: (y - 1.8).toFixed(1), r: 1.5, fill: "rgba(255,255,255,.75)" }, orn);
    }
    // the star on top
    const star = $("#star");
    svgEl("polygon", { points: starPoints(200, 52, 21, 9.5), fill: "#ffd54a", stroke: "#f57f17", "stroke-width": 1.2, "stroke-linejoin": "round", filter: "url(#glow)" }, star);
    svgEl("polygon", { points: starPoints(200, 52, 11, 5), fill: "#fff3b0" }, star);
  }

  // Filipino parol (star lantern)
  function drawParol(parent, x, y, scale, alt) {
    // The outer group positions the parol; the inner one is animated (a CSS transform would
    // otherwise replace the SVG transform attribute and throw the lantern into the corner).
    const place = svgEl("g", { transform: `translate(${x} ${y}) scale(${scale})` }, parent);
    const g = svgEl("g", { class: "parol" + (alt ? " alt" : "") }, place);
    svgEl("line", { x1: 0, y1: -90, x2: 0, y2: -22, stroke: "rgba(255,255,255,.55)", "stroke-width": 1 }, g);
    const body = svgEl("g", { class: "parol-glow" }, g);
    svgEl("polygon", { points: starPoints(0, 0, 26, 12), fill: "url(#parolGrad)", stroke: "#ff8f00", "stroke-width": 1.2, "stroke-linejoin": "round" }, body);
    svgEl("polygon", { points: starPoints(0, 0, 13, 6), fill: "#fff8d6" }, body);
    svgEl("path", { d: "M-7 20 L-12 46 M0 24 L0 52 M7 20 L12 46", stroke: "#ff8f00", "stroke-width": 2, "stroke-linecap": "round", fill: "none" }, body);
  }

  function drawGift(parent, { cx, bottom, w, h, body, ribbon, id, label, personal, tag }) {
    const g = svgEl("g", { class: "gift" + (personal ? " personal" : ""), "data-id": id, tabindex: 0, role: "button", "aria-label": label }, parent);
    const inner = svgEl("g", { class: "gift-inner" }, g);
    const x = cx - w / 2, y = bottom - h, lidH = h * 0.28;
    svgEl("rect", { x, y: y + lidH, width: w, height: h - lidH, rx: 3, fill: body, stroke: "rgba(0,0,0,.22)" }, inner);
    svgEl("rect", { x: cx - w * 0.09, y: y + lidH, width: w * 0.18, height: h - lidH, fill: ribbon }, inner);
    if (tag) {
      svgEl("rect", { x: cx - w * 0.36, y: y + lidH + (h - lidH) * 0.28, width: w * 0.72, height: 14, rx: 2, fill: "#fffaf0", stroke: "rgba(0,0,0,.2)" }, inner);
      const t = svgEl("text", { x: cx, y: y + lidH + (h - lidH) * 0.28 + 10, class: "tag-text" }, inner);
      t.textContent = tag;
    }
    const lid = svgEl("g", { class: "lid" }, inner);
    svgEl("rect", { x: x - 3, y, width: w + 6, height: lidH, rx: 3, fill: body, stroke: "rgba(0,0,0,.22)" }, lid);
    svgEl("rect", { x: cx - w * 0.09, y, width: w * 0.18, height: lidH, fill: ribbon }, lid);
    const bw = w * 0.15, bh = h * 0.1;
    svgEl("ellipse", { cx: cx - bw, cy: y - bh * 0.4, rx: bw, ry: bh, fill: ribbon, transform: `rotate(-25 ${cx - bw} ${y - bh * 0.4})` }, lid);
    svgEl("ellipse", { cx: cx + bw, cy: y - bh * 0.4, rx: bw, ry: bh, fill: ribbon, transform: `rotate(25 ${cx + bw} ${y - bh * 0.4})` }, lid);
    svgEl("circle", { cx, cy: y - bh * 0.2, r: bh * 0.55, fill: ribbon, stroke: "rgba(0,0,0,.2)", "stroke-width": 0.6 }, lid);
    return g;
  }

  // ------------------------------------------------------------------ main
  async function main() {
    const introTitle = $("#intro-title");
    const introText = $("#intro-text");
    const introBtn = $("#intro-btn");

    function askEmail(errorMsg) {
      const form = $("#intro-form");
      const input = $("#email");
      introTitle.textContent = "Maligayang Pasko!";
      introText.textContent = "Enter your work e-mail to find your gift under the tree.";
      $("#form-error").textContent = errorMsg || "";
      form.hidden = false;
      input.value = "";
      input.focus();
      form.onsubmit = (e) => {
        e.preventDefault();
        const v = input.value.trim().toLowerCase();
        if (!input.checkValidity() || !v) {
          $("#form-error").textContent = "Please enter a valid e-mail address.";
          return;
        }
        emailStore.set(v);
        form.hidden = true;
        introText.textContent = "Wrapping your gift…";
        main();
      };
    }

    let state;
    try {
      const r = await api("/api/state");
      if (r.status === 400 || r.status === 403) {
        emailStore.clear();
        askEmail(r.status === 403 ? "Please use your work e-mail address." : "That doesn't look like an e-mail address.");
        return;
      }
      if (r.status === 429) {
        emailStore.clear();
        askEmail("Too many attempts. Please wait a minute and try again.");
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      state = await r.json();
    } catch (e) {
      $(".intro-emoji").textContent = "🎁";
      introTitle.textContent = "Oops!";
      introText.textContent = "The gifts could not be loaded.\nPlease check your connection and refresh the page.";
      return;
    }

    if (state.expired) {
      $(".intro-emoji").textContent = "🎁";
      introTitle.textContent = state.closing.title;
      introText.textContent = state.closing.text;
      return;
    }

    if (state.needs_email) { askEmail(); return; }

    // ---- build the scene
    const gifts = state.gifts.slice(0, 4);
    const total = gifts.length + 1;
    const storeKey = `xmas-gifts-v1:${state.name}`;
    const store = {
      load() { try { return new Set(JSON.parse(localStorage.getItem(storeKey) || "[]")); } catch (e) { return new Set(); } },
      save(set) { try { localStorage.setItem(storeKey, JSON.stringify([...set])); } catch (e) { /* storage may be blocked */ } },
    };
    const opened = store.load();

    drawDecorations();
    drawParol($("#parols"), 46, 118, 0.85, false);
    drawParol($("#parols"), 356, 150, 0.7, true);

    const giftLayer = $("#gifts");
    const slots = [80, 140, 262, 322];
    const bodies = ["#e53935", "#1e88e5", "#43a047", "#8e24aa"];
    const ribbons = ["#ffd54a", "#ffffff", "#ffd54a", "#ffd54a"];
    const nodes = {};
    gifts.forEach((gft, i) => {
      nodes[`g${i}`] = drawGift(giftLayer, { cx: slots[i], bottom: 506, w: 46, h: 40, body: bodies[i], ribbon: ribbons[i], id: `g${i}`, label: `Gift ${i + 1}` });
    });
    const shortName = state.name.length > 11 ? state.name.slice(0, 10) + "…" : state.name;
    nodes.me = drawGift(giftLayer, { cx: 200, bottom: 522, w: 70, h: 58, body: "#f9a825", ribbon: "#c62828", id: "me", label: `Your gift, ${state.name}`, personal: true, tag: shortName });

    const starNode = $("#star");
    const count = $("#count");
    const bar = $("#bar");

    function refreshHud() {
      const n = Object.keys(nodes).filter((id) => opened.has(id)).length;
      count.textContent = `${n} / ${total}`;
      bar.style.width = `${(n / total) * 100}%`;
      const all = n === total;
      starNode.classList.toggle("locked", !all && !opened.has("star"));
      starNode.classList.toggle("ready", all && !opened.has("star"));
      starNode.classList.toggle("claimed", opened.has("star"));
      return all;
    }
    for (const id of Object.keys(nodes)) if (opened.has(id)) nodes[id].classList.add("open");
    refreshHud();

    // ---- interactions
    let busy = false;
    let hintTimer = null;

    async function openGift(id) {
      if (busy) return;
      busy = true;
      clearTimeout(hintTimer);
      const node = nodes[id];
      node.classList.remove("nudge");
      node.classList.add("shake");
      Music.ding();
      await wait(reduceMotion ? 0 : 450);
      node.classList.remove("shake");

      let content;
      if (id === "me") {
        try {
          const r = await api("/api/gift");
          if (r.status === 410) { location.reload(); return; }
          if (r.status === 400 || r.status === 401 || r.status === 403) { emailStore.clear(); location.reload(); return; }
          if (!r.ok) throw new Error(String(r.status));
          const j = await r.json();
          content = { icon: "💌", title: `For you, ${j.name}`, text: j.message };
        } catch (e) {
          busy = false;
          showCard({ icon: "📡", title: "Oops", text: "Your message could not be loaded. Check your connection and tap the gift again." });
          return;
        }
      } else {
        const g = gifts[Number(id.slice(1))];
        content = { icon: g.icon, title: g.title, text: g.text };
      }

      node.classList.add("open");
      const [x, y] = centerOf(node);
      FX.burst(x, y, id === "me" ? 140 : 70);
      opened.add(id);
      store.save(opened);
      const all = refreshHud();
      busy = false;
      showCard(content, () => {
        if (all && !opened.has("star")) {
          toast("You found all the gifts! Tap the golden star ⭐", 5000);
        }
      });
    }

    function onStar() {
      if (busy) return;
      if (!starNode.classList.contains("ready") && !opened.has("star")) {
        toast("Find every gift first, the star is waiting ✨");
        return;
      }
      busy = true;
      Music.fanfare();
      const [x, y] = centerOf(starNode);
      FX.burst(x, y, 220);
      opened.add("star");
      store.save(opened);
      refreshHud();
      busy = false;
      showCard({ icon: state.star.icon, title: state.star.title, text: state.star.text });
    }

    for (const id of Object.keys(nodes)) {
      const node = nodes[id];
      node.addEventListener("click", () => openGift(id));
      node.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openGift(id); } });
    }
    starNode.addEventListener("click", onStar);
    starNode.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onStar(); } });

    $("#sound").addEventListener("click", (e) => {
      const on = Music.toggle();
      e.currentTarget.textContent = on ? "🔊" : "🔇";
      e.currentTarget.setAttribute("aria-pressed", String(on));
    });

    // ---- intro (the click also unlocks audio, which browsers require)
    introTitle.textContent = `Maligayang Pasko, ${state.name}!`;
    introText.textContent = "Something is waiting for you under the tree.";
    introBtn.hidden = false;
    introBtn.focus();
    if (emailStore.get()) {
      const notYou = $("#not-you");
      notYou.textContent = `Not ${state.name}? Use a different e-mail`;
      notYou.hidden = false;
      notYou.addEventListener("click", () => { emailStore.clear(); location.reload(); }, { once: true });
    }
    introBtn.addEventListener("click", () => {
      // SVG elements have no .hidden property, so remove the attribute explicitly
      $("#scene").removeAttribute("hidden");
      $("#hud").removeAttribute("hidden");
      $("#intro").classList.add("hidden");
      Music.start();
      FX.burst(window.innerWidth / 2, window.innerHeight * 0.55, 60);
      if (!opened.has("me")) {
        hintTimer = setTimeout(() => {
          nodes.me.classList.add("nudge");
          toast("Tap the gift with your name 🎁");
        }, 6000);
      }
    }, { once: true });
  }

  main();
})();
