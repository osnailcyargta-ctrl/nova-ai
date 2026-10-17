// model.js - Nova transformer inference engine (pure JS, KV cache, f16 weights)
(function () {
  const MODELS = {}; // key -> {cfg, w, state}

  function f16to32(u16) {
    const out = new Float32Array(u16.length);
    const buf = new ArrayBuffer(4);
    const u32 = new Uint32Array(buf);
    const f32 = new Float32Array(buf);
    for (let i = 0; i < u16.length; i++) {
      const h = u16[i];
      const s = (h & 0x8000) >>> 15;
      const e = (h & 0x7c00) >>> 10;
      let m = h & 0x03ff;
      if (e === 0) {
        f32[0] = m === 0 ? 0 : m * 5.960464477539063e-8;
      } else if (e === 31) {
        f32[0] = NaN;
      } else {
        u32[0] = ((s << 31) | ((e - 15 + 127) << 23) | (m << 13)) >>> 0;
      }
      out[i] = f32[0];
    }
    return out;
  }

  async function fetchProgress(url, onp) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("fetch " + url + " -> " + res.status);
    const total = +(res.headers.get("content-length") || 0);
    if (!res.body || !total) {
      const ab = await res.arrayBuffer();
      onp && onp(1);
      return ab;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onp && onp(got / total);
    }
    const ab = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { ab.set(c, o); o += c.length; }
    return ab.buffer;
  }

  async function loadModel(key, onp) {
    if (MODELS[key]) return MODELS[key];
    const base = "models/nova-" + key;
    const cfg = await (await fetch(base + "/config.json")).json();
    const ab = await fetchProgress(base + "/weights.bin", (p) => onp && onp(p * 0.95));
    onp && onp(0.96);
    const u16 = new Uint16Array(ab);
    const w = {};
    for (const t of cfg.tensors) {
      w[t.name] = f16to32(u16.subarray(t.offset / 2, t.offset / 2 + t.n));
    }
    onp && onp(1);
    const m = { cfg, w };
    MODELS[key] = m;
    // keep at most 2 models in RAM
    const keys = Object.keys(MODELS);
    if (keys.length > 2) delete MODELS[keys.find((k) => k !== key)];
    return m;
  }

  // ---------- engine ----------
  function makeEngine(model) {
    const { cfg, w } = model;
    const V = cfg.vocab.length, D = cfg.d_model, L = cfg.n_layers, H = cfg.n_heads;
    const HD = D / H, BLOCK = cfg.block, FF = cfg.d_ff;
    const kvSize = BLOCK * D;
    const kC = [], vC = [];
    for (let l = 0; l < L; l++) { kC.push(new Float32Array(kvSize)); vC.push(new Float32Array(kvSize)); }
    let pos = 0; // current cache length
    const x = new Float32Array(D);
    const h1 = new Float32Array(D);
    const qkv = new Float32Array(3 * D);
    const att = new Float32Array(BLOCK);
    const ff1 = new Float32Array(FF);
    const xf = new Float32Array(D);
    const logits = new Float32Array(V);

    function ln(out, src, wg, bg) {
      let mu = 0;
      for (let i = 0; i < D; i++) mu += src[i];
      mu /= D;
      let va = 0;
      for (let i = 0; i < D; i++) { const d = src[i] - mu; va += d * d; }
      va /= D;
      const inv = 1 / Math.sqrt(va + 1e-5);
      for (let i = 0; i < D; i++) out[i] = (src[i] - mu) * inv * wg[i] + bg[i];
    }

    function gemv(out, W, b, inp, nIn, nOut) {
      for (let o = 0; o < nOut; o++) {
        let s = b ? b[o] : 0;
        const row = o * nIn;
        for (let i = 0; i < nIn; i++) s += W[row + i] * inp[i];
        out[o] = s;
      }
    }

    function gelu_(a, n) {
      for (let i = 0; i < n; i++) {
        const v = a[i];
        a[i] = 0.5 * v * (1 + Math.tanh(0.7978845608028654 * (v + 0.044715 * v * v * v)));
      }
    }

    // forward one token (already in cache at position pos) -> softmax-ready logits
    function step(tok) {
      const emb = w["emb.weight"], pem = w["pos.weight"];
      for (let i = 0; i < D; i++) x[i] = emb[tok * D + i] + pem[pos * D + i];
      const T = pos + 1; // tokens visible (0..pos)
      const scale = 1 / Math.sqrt(HD);
      for (let l = 0; l < L; l++) {
        const p = "blocks." + l + ".";
        ln(h1, x, w[p + "ln1.weight"], w[p + "ln1.bias"]);
        gemv(qkv, w[p + "qkv.weight"], w[p + "qkv.bias"], h1, D, 3 * D);
        // write k,v into cache at row pos
        const K = kC[l], Vc = vC[l], rowOff = pos * D;
        for (let i = 0; i < D; i++) { K[rowOff + i] = qkv[D + i]; Vc[rowOff + i] = qkv[2 * D + i]; }
        const out = new Float32Array(D); // reused per layer (alloc ok-ish; keep small)
        for (let hd = 0; hd < H; hd++) {
          const qo = hd * HD;
          let mx = -Infinity;
          for (let t = 0; t < T; t++) {
            let s = 0;
            const ko = t * D + hd * HD;
            for (let i = 0; i < HD; i++) s += qkv[qo + i] * K[ko + i];
            s *= scale;
            att[t] = s;
            if (s > mx) mx = s;
          }
          let sum = 0;
          for (let t = 0; t < T; t++) { const e = Math.exp(att[t] - mx); att[t] = e; sum += e; }
          const inv = 1 / sum;
          const oo = hd * HD;
          for (let i = 0; i < HD; i++) out[oo + i] = 0;
          for (let t = 0; t < T; t++) {
            const a = att[t] * inv, vo = t * D + hd * HD;
            if (a < 1e-6) continue;
            for (let i = 0; i < HD; i++) out[oo + i] += a * Vc[vo + i];
          }
        }
        gemv(h1, w[p + "proj.weight"], w[p + "proj.bias"], out, D, D);
        for (let i = 0; i < D; i++) x[i] += h1[i];
        ln(h1, x, w[p + "ln2.weight"], w[p + "ln2.bias"]);
        gemv(ff1, w[p + "fc1.weight"], w[p + "fc1.bias"], h1, D, FF);
        gelu_(ff1, FF);
        gemv(h1, w[p + "fc2.weight"], w[p + "fc2.bias"], ff1, FF, D);
        for (let i = 0; i < D; i++) x[i] += h1[i];
      }
      ln(xf, x, w["ln_f.weight"], w["ln_f.bias"]);
      gemv(logits, w["head.weight"], null, xf, D, V);
      pos++;
      if (pos >= BLOCK) { // shift cache by half block
        const shift = Math.floor(BLOCK / 4) * D;
        for (let l = 0; l < L; l++) {
          kC[l].copyWithin(0, shift);
          vC[l].copyWithin(0, shift);
        }
        pos = BLOCK - Math.floor(BLOCK / 4);
      }
      return logits;
    }

    function reset() { pos = 0; }
    function cachePos() { return pos; }

    return { step, reset, cachePos, cfg, V, D };
  }

  // ---------- sampling ----------
  function sample(logits, temp, topK, recentCounts, repPenalty) {
    const v = new Float32Array(logits.length);
    for (let i = 0; i < logits.length; i++) {
      let z = logits[i] / Math.max(temp, 1e-4);
      const c = recentCounts.get(i) || 0;
      if (c > 0) z -= repPenalty * Math.min(c, 4);
      v[i] = z;
    }
    // top-k
    const idx = Array.from(v.keys());
    if (topK > 0 && topK < v.length) {
      idx.sort((a, b) => v[b] - v[a]);
      idx.length = topK;
    }
    let mx = -Infinity;
    for (const i of idx) if (v[i] > mx) mx = v[i];
    let sum = 0;
    const probs = new Map();
    for (const i of idx) { const e = Math.exp(v[i] - mx); probs.set(i, e); sum += e; }
    let r = Math.random() * sum;
    for (const [i, e] of probs) { r -= e; if (r <= 0) return i; }
    return idx[0];
  }

  // generate from a prompt string; onChar(char) streamed; opts {temp, topK, maxNew, repPenalty}
  async function generate(model, prompt, opts, onChar, shouldStop) {
    const eng = makeEngine(model);
    const stoi = new Map();
    model.cfg.vocab.forEach((c, i) => stoi.set(c, i));
    const ids = [];
    for (const ch of prompt) ids.push(stoi.has(ch) ? stoi.get(ch) : stoi.get(" "));
    const temp = opts.temp || 0.85, topK = opts.topK || 40;
    const maxNew = opts.maxNew || 200, repPenalty = opts.repPenalty || 0.35;
    const recent = new Map();
    for (const id of ids.slice(-64)) recent.set(id, (recent.get(id) || 0) + 1);

    eng.reset();
    let lastLogits = null;
    for (let i = 0; i < ids.length; i++) {
      lastLogits = eng.step(ids[i]);
      if ((i & 31) === 31) await new Promise((r) => setTimeout(r, 0));
      if (shouldStop && shouldStop()) return "";
    }
    let out = "";
    let guard = maxNew * 4;
    while (out.length < maxNew && guard-- > 0) {
      if (shouldStop && shouldStop()) break;
      const nid = sample(lastLogits, temp, topK, recent, repPenalty);
      const ch = model.cfg.vocab[nid];
      if (ch === "\n") break; // responses are single-line
      if (out.length === 0 && (ch === " " || ch === "\r")) {
        lastLogits = eng.step(nid); // skip leading whitespace
        continue;
      }
      out += ch;
      recent.set(nid, (recent.get(nid) || 0) + 1);
      if (recent.size > 96) recent.clear();
      onChar && onChar(ch, out);
      lastLogits = eng.step(nid);
      await new Promise((r) => setTimeout(r, 0));
    }
    return out;
  }

  window.NovaLM = { loadModel, generate, makeEngine };
})();
