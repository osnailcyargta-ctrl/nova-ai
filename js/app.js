// app.js - Nova chat application
(function () {
  const $ = (s) => document.querySelector(s);
  const LS = "nova.conv.v1";
  const MODELS = [
    { key: "2m", label: "2M", desc: "2.0M" },
    { key: "5m", label: "5M", desc: "5.1M" },
    { key: "10m", label: "10M", desc: "10.9M" },
    { key: "17m", label: "17M", desc: "16.9M" },
  ];
  const PERSONAS = {
    FAKE_SMILE: { tag: "[P:FAKE_SMILE]", label: "Fake Smile", dot: "fs" },
    SIGMA: { tag: "[P:SIGMA]", label: "Real Sigma", dot: "sg" },
    CUSTOM: { tag: null, label: "Custom", dot: "cs" },
  };

  // ---------- state ----------
  let store = { convs: {}, order: [], active: null };
  let ui = { model: "17m", persona: "SIGMA", customText: "", theme: null, temp: 0.85, maxNew: 190 };
  let current = { model: null, loading: false };
  let generating = false, genAbort = false;
  try {
    const s = localStorage.getItem(LS + ".store");
    if (s) store = JSON.parse(s);
    const c = localStorage.getItem(LS + ".ui");
    if (c) ui = Object.assign(ui, JSON.parse(c));
  } catch (e) {}
  const save = () => {
    localStorage.setItem(LS + ".store", JSON.stringify(store));
    localStorage.setItem(LS + ".ui", JSON.stringify(ui));
  };

  function newConv(silent) {
    const id = "c" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    store.convs[id] = { id, title: "New chat", persona: ui.persona, custom: ui.customText, messages: [], created: Date.now() };
    store.order.unshift(id);
    store.active = id;
    save();
    renderSidebar();
    renderChat();
    if (!silent) $("#input").focus();
  }
  function conv() { return store.convs[store.active]; }
  function touch() {
    const c = conv();
    c.updated = Date.now();
    save();
  }

  // ---------- persona tag ----------
  function personaTag() {
    if (ui.persona === "CUSTOM") return "[P:CUSTOM: " + (ui.customText || "a friendly assistant") + "]";
    return PERSONAS[ui.persona].tag;
  }
  function turnTag() {
    if (ui.persona === "FAKE_SMILE") return "A [FS]:";
    if (ui.persona === "SIGMA") return "A [SG]:";
    const words = (ui.customText || "a friendly assistant").split(/\s+/).slice(0, 3).join(" ");
    return "A [CU: " + words + "]:";
  }

  // ---------- prompt building ----------
  function buildPrompt(userMsg) {
    const c = conv();
    const tt = turnTag();
    const lines = [];
    for (const m of c.messages) {
      if (m.role === "user") lines.push("U: " + m.text);
      else lines.push(m.aprefix || ("A [SG]: " + m.text));
    }
    if (userMsg != null) lines.push("U: " + userMsg);
    let body = "";
    for (let i = lines.length - 1; i >= 0; i--) {
      const cand = lines[i] + "\n" + body;
      if (cand.length > 250 && body) break;
      body = cand;
    }
    return "\n\n" + personaTag() + "\n" + body + tt;
  }

  // ---------- model ----------
  async function ensureModel() {
    if (current.model && current.key === ui.model) return current.model;
    if (current.loading) return null;
    current.loading = true;
    const bar = $("#loadbar");
    bar.style.width = "0%";
    $("#loadwrap").style.display = "block";
    try {
      const m = await NovaLM.loadModel(ui.model, (p) => (bar.style.width = (p * 100).toFixed(1) + "%"));
      current.model = m;
      current.key = ui.model;
      toast(m.cfg.name + " ready - " + (m.cfg.params / 1e6).toFixed(1) + "M params");
      return m;
    } catch (e) {
      console.error(e);
      toast("Failed to load model. Check connection.");
      return null;
    } finally {
      current.loading = false;
      setTimeout(() => ($("#loadwrap").style.display = "none"), 400);
    }
  }

  // ---------- chat rendering ----------
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function renderChat() {
    const c = conv();
    const box = $("#messages");
    box.innerHTML = "";
    $("#welcome").style.display = c && c.messages.length ? "none" : "flex";
    if (!c || !c.messages.length) return;
    const wrap = document.createElement("div");
    wrap.className = "msg-wrap";
    for (const m of c.messages) wrap.appendChild(renderMsg(m));
    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
  }
  function renderMsg(m) {
    const el = document.createElement("div");
    el.className = "msg " + (m.role === "user" ? "u" : "a");
    const ava = document.createElement("div");
    ava.className = "ava";
    ava.textContent = m.role === "user" ? "U" : "N";
    const body = document.createElement("div");
    body.className = "body";
    const bub = document.createElement("div");
    bub.className = "bubble";
    bub.textContent = m.text;
    body.appendChild(bub);
    if (m.role === "ai") {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.innerHTML = "<span>" + (m.model || "Nova") + "</span>" + (m.tps ? "<span>" + m.tps + " tok/s</span>" : "");
      const regen = document.createElement("button");
      regen.textContent = "regenerate";
      regen.onclick = () => regenerate();
      const cpy = document.createElement("button");
      cpy.textContent = "copy";
      cpy.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(m.text); toast("Copied"); };
      meta.appendChild(regen);
      meta.appendChild(cpy);
      body.appendChild(meta);
      if (m.game) {
        const holder = document.createElement("div");
        holder.className = "game-holder";
        body.appendChild(holder);
        mountGame(holder, m.game);
      }
    }
    el.appendChild(ava);
    el.appendChild(body);
    return el;
  }
  function mountGame(holder, game) {
    if (game === "TICTACTOE") NovaGames.mountTTT(holder, {});
    else if (game === "RPS") NovaGames.mountRPS(holder, {});
    else if (game === "DICE2" || game === "DICE3") NovaGames.mountDice(holder, game, {});
    else if (game === "DICE") NovaGames.mountDice(holder, "DICE2", {});
  }

  // ---------- send / generate ----------
  async function send(text) {
    if (generating || !text || !text.trim()) return;
    const c = conv();
    if (!c) newConv(true);
    const cc = conv();
    const clean = text.replace(/\s*\n\s*/g, " ").trim();
    cc.messages.push({ role: "user", text: clean });
    if (cc.title === "New chat") {
      cc.title = clean.length > 34 ? clean.slice(0, 34) + "..." : clean;
      renderSidebar();
    }
    touch();
    renderChat();
    await respond();
  }

  async function respond(isRegen) {
    const c = conv();
    if (isRegen) {
      while (c.messages.length && c.messages[c.messages.length - 1].role === "ai") c.messages.pop();
      renderChat();
    }
    const model = await ensureModel();
    if (!model) return;
    generating = true;
    genAbort = false;
    setSendState(true);
    // placeholder bubble
    const box = $("#messages");
    $("#welcome").style.display = "none";
    let wrap = box.querySelector(".msg-wrap");
    if (!wrap) { wrap = document.createElement("div"); wrap.className = "msg-wrap"; box.appendChild(wrap); }
    const el = document.createElement("div");
    el.className = "msg a";
    el.innerHTML = '<div class="ava">N</div><div class="body"><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>';
    wrap.appendChild(el);
    const bub = el.querySelector(".bubble");
    box.scrollTop = box.scrollHeight;

    const prompt = buildPrompt(null);
    const t0 = performance.now();
    let acc = "";
    let lastRender = 0;
    try {
      await NovaLM.generate(
        model,
        prompt,
        { temp: ui.temp, topK: 40, maxNew: ui.maxNew, repPenalty: 0.35 },
        (ch, outAll) => {
          acc = outAll;
          const now = performance.now();
          if (now - lastRender > 40) {
            lastRender = now;
            bub.textContent = acc;
            box.scrollTop = box.scrollHeight;
          }
        },
        () => genAbort
      );
    } catch (e) {
      console.error(e);
    }
    let text = acc.trim();
    if (!text && !genAbort) {
      // one retry with more heat
      try {
        await NovaLM.generate(model, prompt, { temp: Math.min(1.2, ui.temp + 0.15), topK: 60, maxNew: ui.maxNew }, (ch, outAll) => (acc = outAll), () => genAbort);
        text = acc.trim();
      } catch (e) {}
    }
    const dt = (performance.now() - t0) / 1000;
    generating = false;
    setSendState(false);
    if (genAbort) { renderChat(); return; }
    // game token parsing
    let game = null;
    const gm = text.match(/\[\[GAME:(TICTACTOE|RPS|DICE2|DICE3|DICE)\]\]/);
    if (gm) {
      game = gm[1];
      text = text.replace(/\[\[GAME:[A-Z0-9]+\]\]/g, "").trim();
    }
    text = text.replace(/^A(\s*\[[^\]]*\])?:\s*/i, "").trim();
    c.messages.push({ role: "ai", text: text || "...", model: model.cfg.name, tps: Math.round((acc.length || 1) / Math.max(dt, 0.001)), game, aprefix: turnTag() + " " + (text || "...") });
    touch();
    renderChat();
  }

  function regenerate() {
    if (generating) return;
    respond(true);
  }

  function setSendState(busy) {
    const btn = $("#send");
    btn.className = busy ? "send stop" : "send";
    btn.textContent = busy ? "\u25A0" : "\u2191";
    btn.title = busy ? "Stop" : "Send";
    $("#input").disabled = false;
  }

  // ---------- sidebar ----------
  function renderSidebar() {
    const list = $("#conv-list");
    list.innerHTML = "";
    for (const id of store.order) {
      const c = store.convs[id];
      if (!c) continue;
      const el = document.createElement("div");
      el.className = "conv-item" + (id === store.active ? " active" : "");
      el.innerHTML = '<span class="t"></span><button class="x" title="delete">&times;</button>';
      el.querySelector(".t").textContent = c.title;
      el.querySelector(".x").onclick = (e) => {
        e.stopPropagation();
        delete store.convs[id];
        store.order = store.order.filter((x) => x !== id);
        if (store.active === id) {
          store.active = store.order[0] || null;
          if (!store.active) newConv(true);
        }
        save();
        renderSidebar();
        renderChat();
      };
      el.onclick = () => {
        store.active = id;
        const c2 = store.convs[id];
        if (c2) {
          ui.persona = c2.persona || ui.persona;
          ui.customText = c2.custom || ui.customText;
          renderPersonaSeg();
        }
        save();
        renderSidebar();
        renderChat();
        $("#sidebar").classList.remove("open");
      };
      list.appendChild(el);
    }
  }

  // ---------- controls ----------
  function renderPersonaSeg() {
    document.querySelectorAll("#persona-seg button").forEach((b) => {
      b.classList.toggle("on", b.dataset.p === ui.persona);
    });
  }
  function renderModelGrid() {
    document.querySelectorAll("#model-grid button").forEach((b) => {
      b.classList.toggle("on", b.dataset.m === ui.model);
    });
  }
  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function applyTheme() {
    const t = ui.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", t);
  }

  // ---------- wire up ----------
  function init() {
    applyTheme();
    // model grid
    const grid = $("#model-grid");
    MODELS.forEach((m) => {
      const b = document.createElement("button");
      b.dataset.m = m.key;
      b.innerHTML = m.label + "<small>" + m.desc + " params</small>";
      b.onclick = async () => {
        if (generating) { toast("Wait for the current reply"); return; }
        ui.model = m.key;
        save();
        renderModelGrid();
        const top = $("#pill-model");
        top.textContent = "Nova-" + m.key.toUpperCase();
        await ensureModel();
      };
      grid.appendChild(b);
    });
    // persona seg
    document.querySelectorAll("#persona-seg button").forEach((b) => {
      b.onclick = () => {
        if (b.dataset.p === "CUSTOM") {
          $("#custom-modal").classList.add("open");
          $("#custom-text").value = ui.customText || "";
          return;
        }
        ui.persona = b.dataset.p;
        const c = conv();
        if (c) { c.persona = ui.persona; }
        save();
        renderPersonaSeg();
        $("#pill-persona").textContent = PERSONAS[ui.persona].label;
      };
    });
    $("#custom-save").onclick = () => {
      ui.customText = $("#custom-text").value.trim() || "a friendly assistant";
      ui.persona = "CUSTOM";
      const c = conv();
      if (c) { c.persona = "CUSTOM"; c.custom = ui.customText; }
      save();
      renderPersonaSeg();
      $("#pill-persona").textContent = "Custom";
      $("#custom-modal").classList.remove("open");
      toast("Persona: " + (ui.customText.length > 40 ? ui.customText.slice(0, 40) + "..." : ui.customText));
    };
    $("#custom-cancel").onclick = () => $("#custom-modal").classList.remove("open");
    // theme
    $("#theme-btn").onclick = () => {
      const cur = document.documentElement.getAttribute("data-theme");
      ui.theme = cur === "dark" ? "light" : "dark";
      save();
      applyTheme();
    };
    // new chat
    $("#new-chat").onclick = () => { newConv(); $("#sidebar").classList.remove("open"); };
    $("#hamb").onclick = () => $("#sidebar").classList.toggle("open");
    // composer
    const input = $("#input");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const v = input.value;
        input.value = "";
        input.style.height = "auto";
        send(v);
      }
    });
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 140) + "px";
    });
    $("#send").onclick = () => {
      if (generating) { genAbort = true; return; }
      const v = input.value;
      input.value = "";
      input.style.height = "auto";
      send(v);
    };
    // welcome chips
    const seeds = ["who are you?", "wanna play tic tac toe", "im bored", "remember my name is Rex", "should i quit my job to stream full time?", "roll 3 dice"];
    const chipBox = $("#chips");
    seeds.forEach((s) => {
      const b = document.createElement("button");
      b.textContent = s;
      b.onclick = () => send(s);
      chipBox.appendChild(b);
    });
    // settings
    $("#settings-btn").onclick = () => {
      $("#temp").value = ui.temp;
      $("#temp-val").textContent = ui.temp.toFixed(2);
      $("#maxnew").value = ui.maxNew;
      $("#maxnew-val").textContent = ui.maxNew;
      $("#settings-modal").classList.add("open");
    };
    $("#temp").oninput = (e) => { ui.temp = +e.target.value; $("#temp-val").textContent = ui.temp.toFixed(2); save(); };
    $("#maxnew").oninput = (e) => { ui.maxNew = +e.target.value; $("#maxnew-val").textContent = ui.maxNew; save(); };
    $("#settings-close").onclick = () => $("#settings-modal").classList.remove("open");
    // about
    $("#about-btn").onclick = () => {
      const m = current.model ? current.model.cfg : null;
      $("#about-body").innerHTML =
        kv("Architecture", "Decoder-only transformer (pre-norm)") +
        kv("Parameters", m ? (m.params / 1e6).toFixed(2) + "M" : "2.0M / 5.1M / 10.9M / 16.9M") +
        kv("Layers x Width", m ? m.n_layers + " x " + m.d_model : "3x224 / 4x320 / 6x384 / 6x480") +
        kv("Attention heads", m ? m.n_heads : "4 / 8 / 6 / 6") +
        kv("Context window", m ? m.block + " chars" : "384 chars") +
        kv("Tokenizer", "Character-level (" + (m ? m.vocab.length : 80) + " tokens)") +
        kv("Training data", "Synthetic conversations built from scratch") +
        kv("Trained with", "PyTorch on CPU, bf16 autocast") +
        kv("Runtime", "Pure JavaScript in your browser - no API, no server");
      $("#about-modal").classList.add("open");
    };
    $("#about-close").onclick = () => $("#about-modal").classList.remove("open");
    document.querySelectorAll(".overlay").forEach((o) =>
      o.addEventListener("click", (e) => {
        if (e.target === o) o.classList.remove("open");
      })
    );
    // pwa
    let installEvt = null;
    addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      installEvt = e;
      $("#install-btn").style.display = "flex";
    });
    $("#install-btn").onclick = async () => {
      if (installEvt) {
        installEvt.prompt();
        installEvt = null;
        $("#install-btn").style.display = "none";
      }
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
    // initial conv + model
    if (!store.active || !store.convs[store.active]) {
      if (store.order.length) store.active = store.order[0];
      else newConv(true);
    }
    renderSidebar();
    renderChat();
    renderPersonaSeg();
    renderModelGrid();
    $("#pill-model").textContent = "Nova-" + ui.model.toUpperCase();
    $("#pill-persona").textContent = ui.persona === "CUSTOM" ? "Custom" : PERSONAS[ui.persona].label;
    if (ui.persona === "CUSTOM" && ui.customText) {
      $("#pill-persona").title = ui.customText;
    }
    // preload chosen model quietly
    setTimeout(() => ensureModel(), 600);
  }
  function kv(k, v) {
    return '<div class="kv"><span>' + k + "</span><b>" + v + "</b></div>";
  }

  document.addEventListener("DOMContentLoaded", init);
})();
