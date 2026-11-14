import confetti from "canvas-confetti";
import { createScene } from "./scene.js";
import { Music } from "./music.js";

const $ = (sel) => document.querySelector(sel);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const params = new URLSearchParams(window.location.search);

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

// ---------------------------------------------------------------- confetti (canvas-confetti)
const COLORS = ["#ffd54a", "#ff5e57", "#4fc3f7", "#ff8ad8", "#9be564", "#ffffff"];
function burst(pos, n = 90) {
  const x = pos ? pos[0] / window.innerWidth : 0.5;
  const y = pos ? pos[1] / window.innerHeight : 0.55;
  confetti({
    particleCount: n, spread: 75, startVelocity: 42, gravity: 1.05, ticks: 220, scalar: 1.0,
    origin: { x, y }, colors: COLORS, zIndex: 40, disableForReducedMotion: true,
  });
  confetti({
    particleCount: Math.round(n / 2), spread: 120, startVelocity: 26, gravity: 0.9, ticks: 260, scalar: 0.8,
    origin: { x, y }, colors: COLORS, zIndex: 40, shapes: ["circle"], disableForReducedMotion: true,
  });
}

// ---------------------------------------------------------------- small UI helpers
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

const NO_SCENE = {
  onPick() {}, setOpened() {}, openGift: () => Promise.resolve(), nudge() {}, setStarMode() {}, starBurst() {}, screenPos: () => null,
};

// ---------------------------------------------------------------- main
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

  // ---- state
  const gifts = state.gifts.slice(0, 4);
  const ids = [...gifts.map((_, i) => `g${i}`), "me"];
  const total = ids.length;
  const storeKey = `xmas-gifts-v2:${state.name}`;
  const store = {
    load() { try { return new Set(JSON.parse(localStorage.getItem(storeKey) || "[]")); } catch (e) { return new Set(); } },
    save(set) { try { localStorage.setItem(storeKey, JSON.stringify([...set])); } catch (e) { /* storage may be blocked */ } },
  };
  const opened = store.load();

  // ---- 3D scene (falls back to a plain list when WebGL is unavailable)
  let scene = NO_SCENE;
  try {
    scene = createScene($("#gl"), { gifts, name: state.name, quality: params.get("q") || "auto", reduceMotion });
    window.__xmas = { screenPos: (id) => scene.screenPos(id) }; // used by the automated tests only
  } catch (e) {
    console.warn("WebGL scene unavailable, using the simple view.", e);
    document.body.classList.add("no-webgl");
    $("#gl").remove();
  }

  const count = $("#count");
  const bar = $("#bar");
  function refreshHud() {
    const n = ids.filter((id) => opened.has(id)).length;
    count.textContent = `${n} / ${total}`;
    bar.style.width = `${(n / total) * 100}%`;
    const all = n === total;
    scene.setStarMode(opened.has("star") ? "claimed" : all ? "ready" : "locked");
    $("#gift-star").hidden = !(all || opened.has("star"));
    ids.forEach((id) => { const b = $(`#gift-${id}`); if (b) b.classList.toggle("done", opened.has(id)); });
    return all;
  }

  // accessible gift list: keyboard / screen readers, and the fallback view without WebGL
  const nav = $("#gift-nav");
  nav.textContent = "";
  const mk = (id, label, handler) => {
    const b = document.createElement("button");
    b.type = "button"; b.id = `gift-${id}`; b.textContent = label;
    b.addEventListener("click", handler);
    nav.appendChild(b);
    return b;
  };
  gifts.forEach((g, i) => mk(`g${i}`, `Open gift ${i + 1}`, () => openGift(`g${i}`)));
  mk("me", `Open the gift with your name, ${state.name}`, () => openGift("me"));
  mk("star", "Open the golden star", () => onStar()).hidden = true;

  scene.setOpened([...opened].filter((id) => id !== "star"));
  refreshHud();

  // ---- interactions
  let busy = false;
  let hintTimer = null;

  async function openGift(id) {
    if (busy) return;
    busy = true;
    clearTimeout(hintTimer);
    scene.nudge("me", false);
    Music.ding();
    const anim = scene.openGift(id);
    await Promise.race([anim, wait(900)]); // the card appears while the lid is still flying

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

    burst(scene.screenPos(id), id === "me" ? 150 : 80);
    opened.add(id);
    store.save(opened);
    const all = refreshHud();
    busy = false;
    showCard(content, () => {
      if (all && !opened.has("star")) toast("You found all the gifts! Tap the golden star ⭐", 5000);
    });
  }

  function onStar() {
    if (busy) return;
    const n = ids.filter((id) => opened.has(id)).length;
    if (n < total && !opened.has("star")) {
      toast("Find every gift first, the star is waiting ✨");
      return;
    }
    busy = true;
    Music.fanfare();
    scene.starBurst();
    burst(scene.screenPos("star"), 220);
    opened.add("star");
    store.save(opened);
    refreshHud();
    busy = false;
    showCard({ icon: state.star.icon, title: state.star.title, text: state.star.text });
  }

  scene.onPick((id) => { if (id === "star") onStar(); else openGift(id); });

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
    $("#hud").removeAttribute("hidden");
    $("#intro").classList.add("hidden");
    Music.start();
    burst(null, 70);
    if (!opened.has("me")) {
      hintTimer = setTimeout(() => {
        scene.nudge("me", true);
        toast("Tap the gift with your name 🎁");
      }, 6500);
    }
  }, { once: true });
}

main();
