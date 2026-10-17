// games.js - Tic-tac-toe (minimax), RPS (pattern-aware), Dice (2/3 dice match)
(function () {
  // ---------- Tic Tac Toe ----------
  const WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  function winner(b) {
    for (const w of WINS) {
      if (b[w[0]] && b[w[0]] === b[w[1]] && b[w[1]] === b[w[2]]) return { p: b[w[0]], line: w };
    }
    return b.every((c) => c) ? { p: "draw", line: [] } : null;
  }
  function minimax(b, turn, depth) {
    const w = winner(b);
    if (w) {
      if (w.p === "O") return { score: 10 - depth };
      if (w.p === "X") return { score: depth - 10 };
      return { score: 0 };
    }
    const moves = [];
    for (let i = 0; i < 9; i++) {
      if (b[i]) continue;
      b[i] = turn;
      const r = minimax(b, turn === "O" ? "X" : "O", depth + 1);
      moves.push({ i, score: r.score });
      b[i] = "";
    }
    if (turn === "O") moves.sort((a, b2) => b2.score - a.score);
    else moves.sort((a, b2) => a.score - b2.score);
    return moves[0];
  }
  function aiMove(b) {
    const empty = b.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
    if (Math.random() < 0.12 && empty.length > 0) return empty[Math.floor(Math.random() * empty.length)];
    const b2 = b.slice();
    return minimax(b2, "O", 0).i;
  }

  function mountTTT(root, opts) {
    let b = Array(9).fill("");
    let over = false;
    root.innerHTML =
      '<div class="game-card"><div class="game-head">TIC-TAC-TOE <span class="dot sg" style="background:var(--sub)"></span><span class="sp"></span>' +
      '<button class="gh-close" title="close">x</button></div><div class="game-body">' +
      '<div class="ttt-grid">' + Array(9).fill(0).map((_, i) => '<button class="ttt-cell" data-i="' + i + '"></button>').join("") + "</div>" +
      '<div class="gstatus">Your move (X)</div>' +
      '<div class="gline"><button class="gbtn ghost rematch">Rematch</button></div></div></div>';
    const cells = [...root.querySelectorAll(".ttt-cell")];
    const status = root.querySelector(".gstatus");
    function draw() {
      cells.forEach((c, i) => { c.textContent = b[i]; c.disabled = !!b[i] || over; c.classList.remove("win"); });
      const w = winner(b);
      if (w) {
        over = true;
        if (w.p === "draw") status.textContent = "Draw. Classic.";
        else {
          status.textContent = w.p === "X" ? "You win?! Suspicious." : "I win. As computed.";
          w.line.forEach((i) => cells[i].classList.add("win"));
        }
        cells.forEach((c) => (c.disabled = true));
      }
    }
    cells.forEach((c) =>
      c.addEventListener("click", () => {
        if (over || b[c.dataset.i]) return;
        b[c.dataset.i] = "X";
        draw();
        if (!over) {
          status.textContent = "Thinking...";
          setTimeout(() => {
            const m = aiMove(b);
            if (m != null) b[m] = "O";
            draw();
          }, 260);
        }
      })
    );
    root.querySelector(".rematch").addEventListener("click", () => {
      b = Array(9).fill(""); over = false; status.textContent = "Your move (X)"; draw();
    });
    opts.onClose && root.querySelector(".gh-close").addEventListener("click", opts.onClose);
    draw();
  }

  // ---------- Rock Paper Scissors ----------
  function mountRPS(root, opts) {
    let me = 0, ai = 0, round = 0, hist = [];
    const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
    const ICON = { rock: "Rock", paper: "Paper", scissors: "Scissors" };
    root.innerHTML =
      '<div class="game-card"><div class="game-head">ROCK PAPER SCISSORS <span class="sp"></span>' +
      '<button class="gh-close">x</button></div><div class="game-body">' +
      '<div class="score">You <b class="s-me">0</b> <span class="vs">vs</span> <b class="s-ai">0</b> Nova <span class="round" style="font-weight:400"></span></div>' +
      '<div class="rps-row" style="margin-top:12px">' +
      '<button class="rps-btn" data-m="rock">&#9994;</button>' +
      '<button class="rps-btn" data-m="paper">&#9995;</button>' +
      '<button class="rps-btn" data-m="scissors">&#9996;</button></div>' +
      '<div class="gstatus">First to 3. Pick one.</div></div></div>';
    const status = root.querySelector(".gstatus");
    const sMe = root.querySelector(".s-me"), sAi = root.querySelector(".s-ai"), sR = root.querySelector(".round");
    const btns = [...root.querySelectorAll(".rps-btn")];
    function aiPick() {
      if (hist.length >= 3 && Math.random() < 0.4) {
        const freq = { rock: 0, paper: 0, scissors: 0 };
        hist.slice(-8).forEach((m) => freq[m]++);
        const likely = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0];
        return Object.keys(BEATS).find((k) => BEATS[k] === likely);
      }
      return ["rock", "paper", "scissors"][Math.floor(Math.random() * 3)];
    }
    btns.forEach((btn) =>
      btn.addEventListener("click", () => {
        const mine = btn.dataset.m;
        const theirs = aiPick();
        hist.push(mine);
        round++;
        let msg;
        if (mine === theirs) msg = "Round " + round + ": " + ICON[mine] + " vs " + ICON[theirs] + " — tie.";
        else if (BEATS[mine] === theirs) { me++; msg = "Round " + round + ": " + ICON[mine] + " beats " + ICON[theirs] + " — yours."; }
        else { ai++; msg = "Round " + round + ": " + ICON[theirs] + " beats " + ICON[mine] + " — mine."; }
        sMe.textContent = me; sAi.textContent = ai; sR.textContent = "#" + round;
        if (me >= 3 || ai >= 3) {
          status.textContent = me > ai ? "You take the match " + me + "-" + ai + ". Run it back?" : "Match mine, " + ai + "-" + me + ". As predicted.";
          btns.forEach((b) => (b.disabled = true));
        } else status.textContent = msg;
      })
    );
    root.insertAdjacentHTML("beforeend", "");
    const head = root.querySelector(".game-body");
    const rem = document.createElement("div");
    rem.className = "gline";
    rem.innerHTML = '<button class="gbtn ghost rematch">Reset</button>';
    head.appendChild(rem);
    rem.querySelector(".rematch").addEventListener("click", () => {
      me = ai = round = 0; hist = [];
      sMe.textContent = sAi.textContent = 0; sR.textContent = "";
      status.textContent = "First to 3. Pick one.";
      btns.forEach((b) => (b.disabled = false));
    });
    opts.onClose && root.querySelector(".gh-close").addEventListener("click", opts.onClose);
  }

  // ---------- Dice ----------
  const FACES = ["", "\u2680", "\u2681", "\u2682", "\u2683", "\u2684", "\u2685"];
  function mountDice(root, startMode, opts) {
    let mode = startMode === "DICE3" ? 3 : 2;
    let me = 0, ai = 0, round = 0;
    root.innerHTML =
      '<div class="game-card"><div class="game-head">DICE DUEL <span class="sp"></span><button class="gh-close">x</button></div>' +
      '<div class="game-body"><div class="mode-seg"><button data-n="2">2 dice</button><button data-n="3">3 dice</button></div>' +
      '<div class="score">You <b class="s-me">0</b> <span class="vs">vs</span> <b class="s-ai">0</b> Nova <span class="round"></span></div>' +
      '<div class="dice-row" style="margin-top:12px"></div>' +
      '<div class="gstatus">First to 3 round wins. Roll when ready.</div>' +
      '<div class="gline"><button class="gbtn roll">Roll</button><button class="gbtn ghost reset">Reset</button></div></div></div>';
    const row = root.querySelector(".dice-row");
    const status = root.querySelector(".gstatus");
    const sMe = root.querySelector(".s-me"), sAi = root.querySelector(".s-ai"), sR = root.querySelector(".round");
    const rollBtn = root.querySelector(".roll");
    const modeBtns = [...root.querySelectorAll(".mode-seg button")];
    function paintMode() { modeBtns.forEach((b) => b.classList.toggle("on", +b.dataset.n === mode)); }
    modeBtns.forEach((b) => b.addEventListener("click", () => { mode = +b.dataset.n; paintMode(); status.textContent = mode + " dice mode. Roll."; }));
    paintMode();
    function diceHTML(n, vals, who) {
      return '<div style="text-align:center"><div style="font-size:11px;color:var(--sub);font-weight:700;margin-bottom:4px">' + who + "</div><div>" +
        vals.map((v) => '<span class="die roll">' + FACES[v] + "</span>").join("") + "</div></div>";
    }
    rollBtn.addEventListener("click", () => {
      rollBtn.disabled = true;
      const uv = [], av = [];
      for (let i = 0; i < mode; i++) { uv.push(1 + Math.floor(Math.random() * 6)); av.push(1 + Math.floor(Math.random() * 6)); }
      row.innerHTML = diceHTML(mode, uv, "YOU") + '<span class="vs">VS</span>' + diceHTML(mode, av, "NOVA");
      const us = uv.reduce((a, b) => a + b, 0), as = av.reduce((a, b) => a + b, 0);
      setTimeout(() => {
        round++;
        let msg;
        if (us === as) msg = "Round " + round + ": " + us + " vs " + as + " — dead tie.";
        else if (us > as) { me++; msg = "Round " + round + ": " + us + " vs " + as + " — yours."; }
        else { ai++; msg = "Round " + round + ": " + as + " vs " + us + " — mine."; }
        sMe.textContent = me; sAi.textContent = ai; sR.textContent = "#" + round;
        if (me >= 3 || ai >= 3) {
          status.textContent = me > ai ? "Match over: you " + me + "-" + ai + ". Lucky rollz." : "Match over: I win " + ai + "-" + me + ". Dice obey me.";
          rollBtn.textContent = "Rematch";
          rollBtn.dataset.done = "1";
        } else status.textContent = msg;
        rollBtn.disabled = false;
      }, 520);
    });
    rollBtn.addEventListener("click", () => {
      if (rollBtn.dataset.done) {
        delete rollBtn.dataset.done;
        me = ai = round = 0; sMe.textContent = sAi.textContent = 0; sR.textContent = "";
        rollBtn.textContent = "Roll";
        row.innerHTML = "";
        status.textContent = "First to 3 round wins. Roll when ready.";
      }
    });
    root.querySelector(".reset").addEventListener("click", () => {
      me = ai = round = 0; sMe.textContent = sAi.textContent = 0; sR.textContent = "";
      rollBtn.textContent = "Roll"; delete rollBtn.dataset.done;
      row.innerHTML = "";
      status.textContent = "First to 3 round wins. Roll when ready.";
    });
    opts.onClose && root.querySelector(".gh-close").addEventListener("click", opts.onClose);
  }

  window.NovaGames = { mountTTT, mountRPS, mountDice };
})();
