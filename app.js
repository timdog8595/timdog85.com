/* Candy Auction — live site powered by Supabase */
(() => {
"use strict";

const CFG = window.CANDY_CONFIG;
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);

// Logins are checked against SHA-256 hashes so the passwords aren't sitting in the code as plain text.
const USERS = {
  TMW: "b4a20abe231ba93b9135ef9bc17d3a0335be4b816080f0038054dc27e7279749",
  ICW: "0fc035bdcd8905343482ce98803f920cd7ddef242e5e837d66682229dc2c92ae",
  LJW: "d22b7f9bbef428a9befa3a25b73c7d0f9de5c3f8163f5b25e75f82836a2186a0",
};
const ADMIN = "TMW";
const PLAYERS = ["ICW", "LJW"];
const ACTS = ["auction", "gamble", "offer"];
const ACT_LABEL = { auction: "Join Auction", gamble: "Join Gamble", offer: "Join Offer" };
const DAY = 24 * 60 * 60 * 1000;

// Wheel: Nothing 50% (two slices), TMW's Choice 25%, Spin Again 20%, Your Choice 5%
const WHEEL = [
  { key: "nothing", label: "Nothing", deg: 90, color: "#5b5266" },
  { key: "tmw", label: "TMW's Choice", deg: 90, color: "#ff8a3d" },
  { key: "nothing", label: "Nothing", deg: 90, color: "#6b6177" },
  { key: "again", label: "Spin Again", deg: 72, color: "#b86bff" },
  { key: "your", label: "Your Choice", deg: 18, color: "#3ecf8e" },
];

let me = localStorage.getItem("candy_user");
if (me && !USERS[me]) me = null;
let view = "home";
let D = { candy: [], cooldowns: [], auction: null, players: [], bids: [], prizes: [], offers: [], activity: [] };
let loaded = false;
const ui = {
  g: { phase: "ready", rot: 0, msg: "", logId: null },
  offerTab: "ICW",
  offerResult: null,
  joining: false,
};

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isAdmin = () => me === ADMIN;
const candy = (id) => D.candy.find((c) => c.id === id);
const available = () => D.candy.filter((c) => !c.owner);
const ownedBy = (u) => D.candy.filter((c) => c.owner === u);
const names = (rows) => rows.map((r) => r.name).join(", ");

function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
function fail(error) {
  if (error) { console.error(error); toast("Something went wrong: " + (error.message || error)); return true; }
  return false;
}
function cooldownLeft(user, act) {
  if (user === ADMIN) return 0;
  const row = D.cooldowns.find((c) => c.username === user && c.activity === act);
  if (!row) return 0;
  return Math.max(0, new Date(row.done_at).getTime() + DAY - Date.now());
}
function fmtLeft(ms) {
  const m = Math.ceil(ms / 60000), h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
function card(c, extra = "") {
  return `<div class="card ${extra}" data-id="${esc(c.id)}"><img src="img/${esc(c.img)}" alt="${esc(c.name)}" loading="lazy"><div class="nm">${esc(c.name)}</div></div>`;
}
function cardsHtml(ids, cls = "grid") {
  const rows = ids.map(candy).filter(Boolean);
  if (!rows.length) return `<p class="muted">No candy.</p>`;
  return `<div class="${cls}">${rows.map((c) => card(c, c.owner ? "taken" : "")).join("")}</div>`;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- database actions ----------
async function setCooldown(user, act) {
  if (user === ADMIN) return;
  const { error } = await sb.from("cooldowns").upsert({ username: user, activity: act, done_at: new Date().toISOString() });
  fail(error);
}
async function logAct(message, needs_action = false) {
  const { data, error } = await sb.from("activity").insert({ username: me, message, needs_action }).select("id").single();
  fail(error);
  return data?.id;
}
async function award(ids, user, how) {
  if (!ids.length) return [];
  const { data, error } = await sb.from("candy")
    .update({ owner: user, won_how: how, won_at: new Date().toISOString() })
    .in("id", ids).is("owner", null).select("id,name");
  fail(error);
  return data || [];
}

// ---------- loading + live updates ----------
async function refresh() {
  const [candyR, coolR, aucR, plR, prR, ofR, actR] = await Promise.all([
    sb.from("candy").select("*").order("sort"),
    sb.from("cooldowns").select("*"),
    sb.from("auction").select("*").eq("id", 1).single(),
    sb.from("auction_players").select("*").order("joined_at"),
    sb.from("gamble_prizes").select("*"),
    sb.from("offers").select("*").order("slot"),
    sb.from("activity").select("*").order("id", { ascending: false }).limit(60),
  ]);
  const err = [candyR, coolR, aucR, plR, prR, ofR, actR].find((r) => r.error);
  if (err) { showSetupError(err.error); return; }
  D.candy = candyR.data; D.cooldowns = coolR.data; D.auction = aucR.data; D.players = plR.data;
  D.prizes = prR.data; D.offers = ofR.data; D.activity = actR.data;
  const bidsR = await sb.from("bids").select("*").eq("round", D.auction.round).order("id");
  D.bids = bidsR.data || [];
  loaded = true;
  render();
}
let refreshTimer = null;
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 120); }

function showSetupError(error) {
  console.error(error);
  $("#app").innerHTML = `<div class="panel"><h2>Can't reach the database</h2>
    <p>${esc(error.message || error)}</p>
    <p class="muted">If you just made the Supabase project, run <b>setup.sql</b> in Supabase → SQL Editor first, then reload this page.</p>
    <button id="retry">Try again</button></div>`;
  $("#retry").onclick = refresh;
}

sb.channel("candy-live")
  .on("postgres_changes", { event: "*", schema: "public" }, scheduleRefresh)
  .subscribe();
setInterval(() => { if (me) refresh(); }, 20000); // safety net if live updates drop
setInterval(() => { if (me && view === "home") render(); }, 30000); // tick countdowns

// ---------- rendering ----------
function render() {
  $("#topbar").hidden = !me;
  if (!me) return renderLogin();
  $("#whoami").textContent = me;
  if (!loaded) { $("#app").innerHTML = `<p class="center muted">Loading…</p>`; return; }
  if (view === "gamble" && ui.g.phase === "spinning") return; // don't interrupt the wheel

  // keep anything being typed across live re-renders
  const keep = {};
  document.querySelectorAll("[data-keep]").forEach((el) => (keep[el.id] = el.value));
  const focusId = document.activeElement?.id;

  ({ home: renderHome, auction: renderAuction, gamble: renderGamble, offer: renderOffer }[view] || renderHome)();

  for (const id in keep) { const el = document.getElementById(id); if (el) el.value = keep[id]; }
  if (focusId) document.getElementById(focusId)?.focus();
}

function go(v) { view = v; ui.offerResult = null; render(); window.scrollTo(0, 0); }

// ---------- login ----------
function renderLogin() {
  $("#app").innerHTML = `<div class="panel login">
    <h1>🍬 Candy Auction</h1>
    <form id="loginForm">
      <label for="u">Username</label><input id="u" autocomplete="username" autocapitalize="characters" required>
      <label for="p">Password</label><input id="p" type="password" autocomplete="current-password" required>
      <div style="margin-top:1.1em"><button style="width:100%">Log in</button></div>
      <div class="err" id="err"></div>
    </form></div>`;
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const u = $("#u").value.trim().toUpperCase(), p = $("#p").value;
    if (!crypto?.subtle) { $("#err").textContent = "Open the site over https to log in."; return; }
    if (USERS[u] && (await sha256(`candy-salt:${u}:${p}`)) === USERS[u]) {
      me = u; localStorage.setItem("candy_user", u); view = "home";
      $("#topbar").hidden = false; render(); refresh();
    } else $("#err").textContent = "Wrong username or password.";
  };
}
$("#logoutBtn").onclick = () => { me = null; localStorage.removeItem("candy_user"); view = "home"; render(); };

// ---------- home ----------
function renderHome() {
  const a = D.auction;
  const joins = ACTS.map((act) => {
    const left = cooldownLeft(me, act);
    let sub = isAdmin() ? "" : left ? `Available in ${fmtLeft(left)}` : "Ready";
    if (act === "auction" && a.status !== "closed" && !left) sub = "🔴 Auction is open!";
    if (act === "offer" && !isAdmin() && !left && D.offers.some((o) => o.username === me && o.candy_ids.length)) sub = "🎁 Offers waiting!";
    return `<button class="join ${act} ${left ? "cool" : ""}" data-act="${act}" ${left ? "disabled" : ""}>${ACT_LABEL[act]}<span class="sub">${esc(sub)}</span></button>`;
  }).join("");

  const mine = ownedBy(me);
  $("#app").innerHTML = `
    <div class="panel"><h2>Hi ${esc(me)}!</h2><div class="joins">${joins}</div></div>
    <div class="panel"><h3>${isAdmin() ? "Candy still available" : "Your candy"} (${isAdmin() ? available().length : mine.length})</h3>
      ${isAdmin()
        ? (available().length ? `<div class="grid">${available().map((c) => card(c)).join("")}</div>` : `<p class="muted">All the candy is gone!</p>`)
        : (mine.length ? `<div class="grid">${mine.map((c) => card(c)).join("")}</div>` : `<p class="muted">No candy yet. Go win some!</p>`)}
    </div>
    ${isAdmin() ? adminHtml() : ""}`;

  document.querySelectorAll(".join").forEach((b) => (b.onclick = () => startAct(b.dataset.act)));
  if (isAdmin()) bindAdmin();
}

async function startAct(act) {
  if (cooldownLeft(me, act)) return;
  if (act === "auction") {
    if (isAdmin()) {
      if (D.auction.status === "closed") {
        const { error } = await sb.from("auction").update({ status: "lobby", lot: [], best_bid: null, last_result: null, updated_at: new Date().toISOString() }).eq("id", 1);
        if (fail(error)) return;
      }
    } else {
      ui.joining = true;
      const { error } = await sb.from("auction_players").upsert({ username: me });
      if (fail(error)) { ui.joining = false; return; }
    }
    await refresh(); ui.joining = false;
  }
  if (act === "gamble") ui.g = { phase: "ready", rot: 0, msg: "", logId: null };
  go(act);
}

// ---------- auction ----------
function renderAuction() {
  const a = D.auction;
  const players = D.players.map((p) => p.username);
  const best = D.bids.find((b) => b.id === a.best_bid);
  const bestHtml = best
    ? `<div class="bestbid"><div class="lbl">Bid to beat — ${esc(best.username)}</div><div class="big">${esc(best.body)}</div></div>`
    : "";
  const lotHtml = `<h3>Up for auction</h3><div class="lot">${a.lot.map(candy).filter(Boolean).map((c) => card(c)).join("")}</div>`;
  const pills = PLAYERS.map((p) => `<span class="pill ${players.includes(p) ? "on" : ""}">${p}${players.includes(p) ? " ✓" : ""}</span>`).join("");
  const back = `<button class="ghost" id="homeBtn">← Home</button>`;

  if (isAdmin()) {
    let body = "";
    if (a.status === "closed") {
      body = `<p>The auction is closed.</p><button id="openBtn">Open auction</button>`;
    } else if (a.status === "lobby") {
      body = `<p>Waiting for players to join. You need at least one to start.</p>
        <button class="good" id="startBtn" ${players.length ? "" : "disabled"}>Start</button>`;
    } else if (a.status === "picking") {
      body = `${a.last_result ? `<div class="bestbid"><div class="lbl">Last round</div><div class="big">${esc(a.last_result)}</div></div>` : ""}
        <p>Pick one or more pieces of candy to put up.</p>
        <button id="pickLotBtn" ${available().length ? "" : "disabled"}>Pick candy</button>`;
    } else if (a.status === "bidding") {
      const bids = [...D.bids].reverse();
      body = `${lotHtml}${bestHtml}<h3>Bids (${bids.length})</h3>
        ${bids.length ? bids.map((b) => `<div class="bid ${b.id === a.best_bid ? "best" : ""}">
            <div><b>${esc(b.username)}</b><div class="body">${esc(b.body)}</div></div>
            <div class="row"><button class="secondary small" data-better="${b.id}" ${b.id === a.best_bid ? "disabled" : ""}>Better</button>
            <button class="good small" data-win="${b.id}">Win</button></div></div>`).join("")
          : `<p class="muted">Waiting for bids…</p>`}`;
    }
    $("#app").innerHTML = `<div class="panel"><div class="row spread"><h2>Auction</h2>${back}</div>
      <div>Players: ${pills}</div></div>
      <div class="panel">${body}</div>
      ${a.status !== "closed" ? `<div class="panel row spread"><span class="muted">Ending puts everyone who joined on their 24-hour wait.</span><button class="bad" id="endBtn">End auction</button></div>` : ""}`;

    $("#openBtn") && ($("#openBtn").onclick = () => startAct("auction"));
    $("#startBtn") && ($("#startBtn").onclick = async () => {
      fail((await sb.from("auction").update({ status: "picking", last_result: null }).eq("id", 1)).error);
    });
    $("#pickLotBtn") && ($("#pickLotBtn").onclick = async () => {
      const ids = await openPicker({ title: "Pick candy to auction", multi: true });
      if (!ids?.length) return;
      fail((await sb.from("auction").update({ status: "bidding", lot: ids, round: a.round + 1, best_bid: null, last_result: null }).eq("id", 1)).error);
    });
    document.querySelectorAll("[data-better]").forEach((b) => (b.onclick = async () => {
      fail((await sb.from("auction").update({ best_bid: Number(b.dataset.better) }).eq("id", 1)).error);
      toast("Shown to everyone as the bid to beat.");
    }));
    document.querySelectorAll("[data-win]").forEach((b) => (b.onclick = async () => {
      const bid = D.bids.find((x) => x.id === Number(b.dataset.win));
      if (!bid || !confirm(`${bid.username} wins with:\n\n"${bid.body}"\n\nGive them the candy?`)) return;
      const got = await award(a.lot, bid.username, "auction");
      const msg = got.length ? `${bid.username} won ${names(got)} for "${bid.body}"` : `${bid.username} won, but that candy was already gone`;
      await sb.from("auction").update({ status: "picking", lot: [], best_bid: null, last_result: msg }).eq("id", 1);
      await logAct(msg);
      toast(msg);
    }));
    $("#endBtn") && ($("#endBtn").onclick = async () => {
      if (!confirm("End the auction for everyone?")) return;
      for (const p of players) await setCooldown(p, "auction");
      await sb.from("auction_players").delete().neq("username", "");
      await sb.from("auction").update({ status: "closed", lot: [], best_bid: null, last_result: "The auction has ended." }).eq("id", 1);
      await logAct(`Auction ended (${players.join(", ") || "no players"})`);
      go("home");
    });
  } else {
    const inIt = players.includes(me) || ui.joining;
    let body;
    if (!inIt) {
      body = `<p class="big">${a.status === "closed" && a.last_result ? esc(a.last_result) : "You're not in this auction."}</p>
        ${cooldownLeft(me, "auction") ? "" : `<button id="rejoinBtn">Join</button>`}`;
    } else if (a.status === "closed" || a.status === "lobby") {
      body = `<p class="big">You're in! ⏳</p><p class="muted">Waiting for TMW to ${a.status === "closed" ? "open the auction" : "press Start"}…</p>
        <button class="ghost" id="leaveBtn">Leave</button>`;
    } else if (a.status === "picking") {
      body = `${a.last_result ? `<div class="bestbid"><div class="lbl">Last round</div><div class="big">${esc(a.last_result)}</div></div>` : ""}
        <p class="big">TMW is choosing the candy… 👀</p>`;
    } else {
      const myBids = D.bids.filter((b) => b.username === me).reverse();
      body = `${lotHtml}${bestHtml}
        <label for="bidText">What would you give for this?</label>
        <textarea id="bidText" data-keep maxlength="500" placeholder="Type your offer…"></textarea>
        <div style="margin-top:.7em"><button id="bidBtn">${myBids.length ? "Bid again" : "Send bid"}</button></div>
        ${myBids.length ? `<h3 style="margin-top:1em">Your bids</h3>${myBids.map((b) => `<div class="bid ${b.id === a.best_bid ? "best" : ""}"><div class="body">${esc(b.body)}</div></div>`).join("")}` : ""}`;
    }
    $("#app").innerHTML = `<div class="panel"><div class="row spread"><h2>Auction</h2>${back}</div><div>Players: ${pills}</div></div>
      <div class="panel">${body}</div>`;
    $("#rejoinBtn") && ($("#rejoinBtn").onclick = () => startAct("auction"));
    $("#leaveBtn") && ($("#leaveBtn").onclick = async () => {
      await sb.from("auction_players").delete().eq("username", me); go("home");
    });
    $("#bidBtn") && ($("#bidBtn").onclick = async () => {
      const t = $("#bidText"), body = t.value.trim();
      if (!body) return t.focus();
      $("#bidBtn").disabled = true;
      const { error } = await sb.from("bids").insert({ round: a.round, username: me, body });
      if (!fail(error)) { t.value = ""; toast("Bid sent!"); }
      $("#bidBtn").disabled = false;
    });
  }
  $("#homeBtn").onclick = () => go("home");
}

// ---------- gamble ----------
function drawWheel(rot) {
  const cv = $("#wheel"); if (!cv) return;
  const x = cv.getContext("2d"), r = cv.width / 2;
  x.clearRect(0, 0, cv.width, cv.height);
  x.save(); x.translate(r, r); x.rotate((rot * Math.PI) / 180);
  let start = -90;
  for (const s of WHEEL) {
    const a0 = (start * Math.PI) / 180, a1 = ((start + s.deg) * Math.PI) / 180;
    x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, r - 6, a0, a1); x.closePath();
    x.fillStyle = s.color; x.fill(); x.strokeStyle = "#1b1424"; x.lineWidth = 4; x.stroke();
    x.save(); x.rotate((((start + s.deg / 2) * Math.PI) / 180));
    x.fillStyle = "#fff"; x.font = `bold ${s.deg < 30 ? 22 : 30}px system-ui`; x.textAlign = "right"; x.textBaseline = "middle";
    x.fillText(s.label, r - 26, 0); x.restore();
    start += s.deg;
  }
  x.beginPath(); x.arc(0, 0, 34, 0, Math.PI * 2); x.fillStyle = "#271d34"; x.fill();
  x.fillStyle = "#ffc14d"; x.font = "bold 30px system-ui"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("🍬", 0, 2);
  x.restore();
}

function renderGamble() {
  const g = ui.g;
  let below = "";
  if (g.phase === "ready") below = `<button id="spinBtn" class="big">${g.msg ? "Spin again!" : "Spin!"}</button>`;
  if (g.phase === "done") below = `<button id="doneBtn">Back home</button>`;
  if (g.phase === "choose") {
    below = `<p>Pick any one piece of candy:</p><button id="chooseBtn">Choose my candy</button>`;
  }
  $("#app").innerHTML = `<div class="panel center"><div class="row spread"><h2>Gamble</h2>${g.phase === "ready" && !g.msg ? `<button class="ghost" id="homeBtn">← Home</button>` : ""}</div>
    <div class="wheelwrap"><div class="pointer"></div><canvas id="wheel" width="600" height="600"></canvas></div>
    <div class="result">${esc(g.msg)}</div>${below}</div>`;
  drawWheel(g.rot);
  $("#homeBtn") && ($("#homeBtn").onclick = () => go("home"));
  $("#doneBtn") && ($("#doneBtn").onclick = () => go("home"));
  $("#spinBtn") && ($("#spinBtn").onclick = spin);
  $("#chooseBtn") && ($("#chooseBtn").onclick = chooseYourCandy);
  if (g.phase === "choose" && !g.pickerShown) { g.pickerShown = true; chooseYourCandy(); }
}

function spin() {
  const g = ui.g;
  if (!isAdmin() && cooldownLeft(me, "gamble") && !g.msg) return go("home");
  g.phase = "spinning"; g.msg = "";
  $("#spinBtn").disabled = true; $(".result").textContent = "";
  const rnd = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32; // 0..1
  const landAt = rnd * 360; // degrees clockwise from top
  let acc = 0, seg = WHEEL[0];
  for (const s of WHEEL) { if (landAt < acc + s.deg) { seg = s; break; } acc += s.deg; }
  const from = g.rot % 360, to = 360 * 6 + (360 - landAt);
  const t0 = performance.now(), dur = 4800;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4);
    g.rot = from + (to - from) * e; drawWheel(g.rot);
    if (p < 1) requestAnimationFrame(step); else finishSpin(seg.key);
  };
  requestAnimationFrame(step);
}

async function finishSpin(key) {
  const g = ui.g;
  if (key === "again") { g.phase = "ready"; g.msg = "🔄 Spin again!"; return render(); }
  await setCooldown(me, "gamble");
  if (key === "nothing") {
    g.msg = "Nothing this time 😢"; g.phase = "done";
    await logAct(`${me} spun the wheel: Nothing`);
  } else if (key === "your" || (key === "tmw" && isAdmin())) {
    g.msg = key === "your" ? "🎉 YOUR CHOICE! 🎉" : "TMW's Choice — that's you, so pick!";
    g.phase = "choose"; g.pickerShown = false;
    g.logId = await logAct(`${me} won Your Choice on the wheel (picking…)`, true);
  } else if (key === "tmw") {
    const prize = D.prizes.find((p) => p.username === me);
    const got = prize ? await award(prize.candy_ids, me, "gamble") : [];
    if (got.length) {
      await sb.from("gamble_prizes").delete().eq("username", me);
      g.msg = `🎁 TMW's Choice: you won ${names(got)}!`;
      await logAct(`${me} won TMW's Choice: ${names(got)}`);
    } else {
      g.msg = "🎁 TMW's Choice! TMW will pick your prize.";
      await logAct(`${me} won TMW's Choice, but no prize was set — give them one`, true);
    }
    g.phase = "done";
  }
  render(); refresh();
}

async function chooseYourCandy() {
  const ids = await openPicker({ title: "Pick your candy!", multi: false });
  if (!ids?.length) return;
  const got = await award(ids, me, "gamble");
  if (!got.length) return toast("Someone just took that one. Pick another!");
  const g = ui.g;
  g.msg = `🎉 You picked ${names(got)}!`; g.phase = "done";
  if (g.logId) await sb.from("activity").update({ message: `${me} won Your Choice and picked ${names(got)}`, needs_action: false }).eq("id", g.logId);
  render(); refresh();
}

// ---------- offer ----------
function renderOffer() {
  const back = `<button class="ghost" id="homeBtn">← Home</button>`;
  if (isAdmin()) {
    const u = ui.offerTab;
    const slots = [1, 2, 3].map((s) => {
      const o = D.offers.find((x) => x.username === u && x.slot === s);
      const ids = o?.candy_ids || [];
      return `<div class="offer"><div class="row spread"><h3>Offer ${s}</h3>
        <div class="row"><button class="small" data-edit="${s}">${ids.length ? "Edit" : "Add candy"}</button>
        ${ids.length ? `<button class="ghost small" data-clear="${s}">Clear</button>` : ""}</div></div>
        ${ids.length ? cardsHtml(ids) : `<p class="muted">Empty</p>`}</div>`;
    }).join("");
    const cooled = cooldownLeft(u, "offer");
    $("#app").innerHTML = `<div class="panel"><div class="row spread"><h2>Offers</h2>${back}</div>
      <p class="muted">Make up to three offers for each player. They pick one and get that candy free. Changes show up for them right away.</p>
      <div class="tabs">${PLAYERS.map((p) => `<button data-tab="${p}" class="${p === u ? "on" : ""}">${p}</button>`).join("")}</div>
      ${cooled ? `<p class="muted">${u}'s Join Offer is on cooldown (${fmtLeft(cooled)} left). Reset it from the control panel if you want them to choose now.</p>` : ""}
      <div class="offers">${slots}</div></div>`;
    document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { ui.offerTab = b.dataset.tab; render(); }));
    document.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = async () => {
      const s = Number(b.dataset.edit);
      const cur = D.offers.find((x) => x.username === u && x.slot === s)?.candy_ids || [];
      const ids = await openPicker({ title: `${u} — Offer ${s}`, multi: true, selected: cur });
      if (ids === null) return;
      fail((await sb.from("offers").upsert({ username: u, slot: s, candy_ids: ids })).error);
    }));
    document.querySelectorAll("[data-clear]").forEach((b) => (b.onclick = async () => {
      fail((await sb.from("offers").delete().eq("username", u).eq("slot", Number(b.dataset.clear))).error);
    }));
  } else {
    let body;
    const mine = D.offers.filter((o) => o.username === me && o.candy_ids.length);
    if (ui.offerResult) {
      body = `<p class="big center">${esc(ui.offerResult)}</p><div class="center"><button id="doneBtn">Back home</button></div>`;
    } else if (cooldownLeft(me, "offer")) {
      return go("home");
    } else if (!mine.length) {
      body = `<p class="big">TMW hasn't made your offers yet.</p><p class="muted">This page updates by itself, so they'll pop up here when they're ready.</p>`;
    } else {
      body = `<p>Pick <b>one</b> offer. The candy is free!</p><div class="offers">${mine.map((o) => `
        <div class="offer"><h3>Offer ${o.slot}</h3>${cardsHtml(o.candy_ids)}
        <div style="margin-top:.8em"><button class="good" data-choose="${o.slot}">Choose Offer ${o.slot}</button></div></div>`).join("")}</div>`;
    }
    $("#app").innerHTML = `<div class="panel"><div class="row spread"><h2>Offers</h2>${back}</div>${body}</div>`;
    $("#doneBtn") && ($("#doneBtn").onclick = () => go("home"));
    document.querySelectorAll("[data-choose]").forEach((b) => (b.onclick = async () => {
      const o = mine.find((x) => x.slot === Number(b.dataset.choose));
      if (!confirm(`Take Offer ${o.slot}? You can only pick one.`)) return;
      ui.offerResult = "Getting your candy…"; render();
      const got = await award(o.candy_ids, me, "offer");
      await sb.from("offers").delete().eq("username", me);
      await setCooldown(me, "offer");
      const missing = o.candy_ids.length - got.length;
      ui.offerResult = got.length ? `🎁 You got ${names(got)}!${missing ? ` (${missing} piece${missing > 1 ? "s were" : " was"} already gone.)` : ""}` : "Sorry, that candy was already gone.";
      await logAct(`${me} chose Offer ${o.slot}: ${got.length ? names(got) : "nothing left"}`);
      render(); refresh();
    }));
  }
  $("#homeBtn").onclick = () => go("home");
}

// ---------- TMW control panel ----------
function adminHtml() {
  const coolRows = PLAYERS.map((p) => `<tr><td><b>${p}</b></td>${ACTS.map((a) => {
    const l = cooldownLeft(p, a);
    return `<td>${l ? `⏳ ${fmtLeft(l)}` : "✅ ready"}</td>`;
  }).join("")}</tr>`).join("");
  const prizeRows = PLAYERS.map((p) => {
    const ids = D.prizes.find((x) => x.username === p)?.candy_ids || [];
    return `<div class="offer" style="margin-bottom:.7em"><div class="row spread"><b>${p}</b>
      <div class="row"><button class="small" data-prize="${p}">${ids.length ? "Change" : "Set prize"}</button>
      ${ids.length ? `<button class="ghost small" data-unprize="${p}">Clear</button>` : ""}</div></div>
      ${ids.length ? cardsHtml(ids) : `<p class="muted">No prize set</p>`}</div>`;
  }).join("");
  const holders = [...PLAYERS, ADMIN].map((p) => {
    const own = ownedBy(p);
    return `<div class="offer" style="margin-bottom:.7em"><div class="row spread"><b>${p} (${own.length})</b>
      <button class="small secondary" data-give="${p}">Give candy</button></div>
      ${own.length ? `<div class="grid">${own.map((c) => `<div class="card">${card(c).replace(/^<div[^>]*>|<\/div>$/g, "")}
        <button class="ghost small" data-return="${esc(c.id)}" style="margin-top:.3em;width:100%">Return</button></div>`).join("")}</div>` : `<p class="muted">None</p>`}</div>`;
  }).join("");
  const log = D.activity.map((a) => `<div class="${a.needs_action ? "act" : ""}">
      <span class="muted">${new Date(a.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> — ${esc(a.message)}
      ${a.needs_action ? `<button class="ghost small" data-ack="${a.id}">Done</button>` : ""}</div>`).join("") || `<p class="muted">Nothing yet.</p>`;

  return `<div class="panel"><h2>Control panel</h2>
    <h3>Reset time</h3>
    <table><tr><th></th><th>Auction</th><th>Gamble</th><th>Offer</th></tr>${coolRows}</table>
    <div class="row" style="margin-top:.8em">
      <select id="rsUser" style="width:auto"><option value="ALL">Everyone</option>${PLAYERS.map((p) => `<option>${p}</option>`).join("")}</select>
      <select id="rsAct" style="width:auto"><option value="ALL">All three</option>${ACTS.map((a) => `<option value="${a}">${ACT_LABEL[a]}</option>`).join("")}</select>
      <button id="rsBtn">Reset time</button>
    </div></div>
  <div class="panel"><h3>"TMW's Choice" wheel prizes</h3>
    <p class="muted">If a player lands on TMW's Choice, they get whatever you set here.</p>${prizeRows}</div>
  <div class="panel"><h3>Who has what</h3>${holders}</div>
  <div class="panel"><h3>Activity</h3><div class="log">${log}</div></div>`;
}

function bindAdmin() {
  $("#rsBtn").onclick = async () => {
    const u = $("#rsUser").value, a = $("#rsAct").value;
    let q = sb.from("cooldowns").delete();
    q = u === "ALL" ? q.in("username", PLAYERS) : q.eq("username", u);
    q = a === "ALL" ? q.in("activity", ACTS) : q.eq("activity", a);
    if (fail((await q).error)) return;
    toast(`Reset ${a === "ALL" ? "all buttons" : ACT_LABEL[a]} for ${u === "ALL" ? "everyone" : u}.`);
    refresh();
  };
  document.querySelectorAll("[data-prize]").forEach((b) => (b.onclick = async () => {
    const p = b.dataset.prize;
    const cur = D.prizes.find((x) => x.username === p)?.candy_ids || [];
    const ids = await openPicker({ title: `TMW's Choice prize for ${p}`, multi: true, selected: cur });
    if (ids === null) return;
    fail((await sb.from("gamble_prizes").upsert({ username: p, candy_ids: ids })).error);
  }));
  document.querySelectorAll("[data-unprize]").forEach((b) => (b.onclick = async () => {
    fail((await sb.from("gamble_prizes").delete().eq("username", b.dataset.unprize)).error);
  }));
  document.querySelectorAll("[data-give]").forEach((b) => (b.onclick = async () => {
    const p = b.dataset.give;
    const ids = await openPicker({ title: `Give candy to ${p}`, multi: true });
    if (!ids?.length) return;
    const got = await award(ids, p, "given");
    if (got.length) { await logAct(`TMW gave ${p}: ${names(got)}`); toast(`Gave ${p} ${names(got)}`); }
  }));
  document.querySelectorAll("[data-return]").forEach((b) => (b.onclick = async () => {
    const c = candy(b.dataset.return);
    if (!confirm(`Put ${c.name} back in the pool?`)) return;
    fail((await sb.from("candy").update({ owner: null, won_how: null, won_at: null }).eq("id", c.id)).error);
    await logAct(`${c.name} returned to the pool (was ${c.owner}'s)`);
  }));
  document.querySelectorAll("[data-ack]").forEach((b) => (b.onclick = async () => {
    fail((await sb.from("activity").update({ needs_action: false }).eq("id", Number(b.dataset.ack))).error);
  }));
}

// ---------- candy picker ----------
function openPicker({ title, multi, selected = [] }) {
  return new Promise((resolve) => {
    const pool = D.candy.filter((c) => !c.owner);
    const sel = new Set(selected.filter((id) => pool.some((c) => c.id === id)));
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="box"><div class="row spread"><h2>${esc(title)}</h2><span class="muted" id="pkCount"></span></div>
      ${pool.length ? `<div class="grid">${pool.map((c) => card(c, "pick" + (sel.has(c.id) ? " sel" : ""))).join("")}</div>` : `<p class="muted">No candy left.</p>`}
      <div class="row" style="justify-content:flex-end;margin-top:1em">
        <button class="ghost" id="pkCancel">Cancel</button><button id="pkOk">${multi ? "Done" : "Pick this one"}</button></div></div>`;
    document.body.appendChild(m);
    const upd = () => { m.querySelector("#pkCount").textContent = `${sel.size} selected`; m.querySelector("#pkOk").disabled = !multi && !sel.size; };
    upd();
    m.querySelectorAll(".card.pick").forEach((el) => (el.onclick = () => {
      const id = el.dataset.id;
      if (!multi) { sel.clear(); m.querySelectorAll(".card.sel").forEach((x) => x.classList.remove("sel")); }
      if (sel.has(id)) { sel.delete(id); el.classList.remove("sel"); } else { sel.add(id); el.classList.add("sel"); }
      upd();
    }));
    const close = (v) => { m.remove(); resolve(v); };
    m.querySelector("#pkCancel").onclick = () => close(null);
    m.querySelector("#pkOk").onclick = () => close([...sel]);
  });
}

render();
if (me) refresh();
})();
