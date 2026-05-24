// Live Poll — a tiny, no-build poll/vote tool deployed on ifhost.
//
// Bound to '::':3000 — dual-stack so the platform edge can reach the machine
// over IPv6. Two foot-guns avoided here: 127.0.0.1 (edge can't reach loopback)
// and v4-only '0.0.0.0' (routing to <app>.host.impossi.build arrives over IPv6,
// so a v4-only listener silently gets connection-refused even on a healthy deploy).
//
// Persistence: polls + votes live in a single JSON file. On ifhost we write to
// the persistent volume at /data/polls.json so votes survive restarts. If /data
// doesn't exist (local dev, or a plan with no volume) we fall back to ./data,
// and if even that can't be written we keep everything in memory. We never crash
// on a storage problem — we detect and degrade.
//
// No external dependencies: plain `http`, plain `fs`. No DB engine.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3000;
const HOST = '::';

// ---------------------------------------------------------------------------
// Storage: pick the best writable location, degrade gracefully.
// ---------------------------------------------------------------------------

function pickStore() {
  // Prefer the persistent volume, then a local ./data dir, then memory-only.
  const candidates = [
    { dir: '/data', label: "ifhost persistent volume (/data)" },
    { dir: path.join(__dirname, 'data'), label: "local ./data" },
  ];
  for (const c of candidates) {
    try {
      fs.mkdirSync(c.dir, { recursive: true });
      const probe = path.join(c.dir, '.write-probe');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return { file: path.join(c.dir, 'polls.json'), label: c.label, persistent: true };
    } catch (_) {
      // not writable — try the next candidate
    }
  }
  return { file: null, label: 'in-memory (not persistent)', persistent: false };
}

const STORE = pickStore();

// In-memory state. Shape: { polls: { [id]: { id, question, options:[{text,votes}], createdAt } } }
let db = { polls: {} };

function loadDb() {
  if (!STORE.file) return;
  try {
    if (fs.existsSync(STORE.file)) {
      const raw = fs.readFileSync(STORE.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.polls) db = parsed;
    }
  } catch (e) {
    // Corrupt or unreadable file — start fresh rather than crash.
    console.error('Could not read store, starting fresh:', e.message);
    db = { polls: {} };
  }
}

let saveTimer = null;
function saveDb() {
  if (!STORE.file) return; // memory-only mode
  // Debounce writes so a burst of votes doesn't hammer the disk.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = STORE.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, STORE.file); // atomic-ish swap
    } catch (e) {
      console.error('Could not persist store:', e.message);
    }
  }, 120);
}

loadDb();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newId() {
  // Short, URL-friendly, unambiguous (no 0/O/1/l). 7 chars ~ 34 bits.
  const alphabet = '23456789abcdefghijkmnpqrstuvwxyz';
  let id = '';
  const bytes = crypto.randomBytes(7);
  for (let i = 0; i < 7; i++) id += alphabet[bytes[i] % alphabet.length];
  return id;
}

function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');
}

function readBody(req, cb) {
  let data = '';
  let tooBig = false;
  req.on('data', (chunk) => {
    data += chunk;
    if (data.length > 16 * 1024) { // 16 KB cap — plenty for a poll
      tooBig = true;
      req.destroy();
    }
  });
  req.on('end', () => {
    if (tooBig) return cb(new Error('payload too large'));
    try { cb(null, data ? JSON.parse(data) : {}); }
    catch (e) { cb(e); }
  });
  req.on('error', (e) => cb(e));
}

function publicPoll(poll) {
  const total = poll.options.reduce((s, o) => s + o.votes, 0);
  return {
    id: poll.id,
    question: poll.question,
    total,
    options: poll.options.map((o, i) => ({ i, text: o.text, votes: o.votes })),
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function createPoll(req, res) {
  readBody(req, (err, body) => {
    if (err) return sendJson(res, 400, { error: 'Could not read your poll.' });

    const question = (body.question || '').toString().trim().slice(0, 200);
    let options = Array.isArray(body.options) ? body.options : [];
    options = options
      .map((o) => (o == null ? '' : o.toString().trim().slice(0, 100)))
      .filter((o) => o.length > 0)
      .slice(0, 10); // cap at 10 options

    if (!question) return sendJson(res, 400, { error: 'Please add a question.' });
    if (options.length < 2) return sendJson(res, 400, { error: 'Please add at least two options.' });

    const id = newId();
    db.polls[id] = {
      id,
      question,
      options: options.map((text) => ({ text, votes: 0 })),
      createdAt: Date.now(),
    };
    saveDb();
    sendJson(res, 201, { id, url: '/p/' + id });
  });
}

function getPoll(res, id) {
  const poll = db.polls[id];
  if (!poll) return sendJson(res, 404, { error: 'Poll not found.' });
  sendJson(res, 200, publicPoll(poll));
}

function votePoll(req, res, id) {
  const poll = db.polls[id];
  if (!poll) return sendJson(res, 404, { error: 'Poll not found.' });
  readBody(req, (err, body) => {
    if (err) return sendJson(res, 400, { error: 'Could not read your vote.' });
    const idx = Number(body.option);
    if (!Number.isInteger(idx) || idx < 0 || idx >= poll.options.length) {
      return sendJson(res, 400, { error: 'That option does not exist.' });
    }
    poll.options[idx].votes += 1;
    saveDb();
    sendJson(res, 200, publicPoll(poll));
  });
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const method = req.method;

  // --- API ---
  if (pathname === '/api/polls' && method === 'POST') return createPoll(req, res);

  const apiMatch = pathname.match(/^\/api\/polls\/([a-z0-9]+)(\/vote)?$/i);
  if (apiMatch) {
    const id = apiMatch[1];
    const isVote = !!apiMatch[2];
    if (isVote && method === 'POST') return votePoll(req, res, id);
    if (!isVote && method === 'GET') return getPoll(res, id);
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  // --- Pages ---
  if (pathname === '/' ) return send(res, 200, HOME_HTML);
  if (pathname === '/health') return sendJson(res, 200, { ok: true, store: STORE.label });

  const pageMatch = pathname.match(/^\/p\/([a-z0-9]+)$/i);
  if (pageMatch && method === 'GET') {
    const poll = db.polls[pageMatch[1]];
    if (!poll) return send(res, 404, NOT_FOUND_HTML);
    return send(res, 200, POLL_HTML);
  }

  send(res, 404, NOT_FOUND_HTML);
});

server.listen(PORT, HOST, () => {
  console.log(`Live Poll on :${PORT} (${HOST}) — storage: ${STORE.label}`);
});

// ---------------------------------------------------------------------------
// Pages (inlined — no build step, no static-file plumbing)
// ---------------------------------------------------------------------------

const SHELL_HEAD = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0f17">
<title>Live Poll</title>
<style>
  :root{
    --bg:#0b0f17; --panel:#121826; --panel-2:#0f1521; --line:#1f2940;
    --text:#eef2f9; --muted:#93a0b8; --accent:#818cf8; --accent-2:#a5b4fc;
    --good:#34d399;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{
    background:
      radial-gradient(1100px 700px at 50% -10%, rgba(129,140,248,.18), transparent 60%),
      radial-gradient(900px 600px at 90% 110%, rgba(52,211,153,.10), transparent 55%),
      var(--bg);
    color:var(--text);
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
    min-height:100%;
    display:flex; flex-direction:column;
  }
  a{color:var(--accent-2);text-decoration:none}
  main{width:100%;max-width:560px;margin:0 auto;padding:34px 22px 24px;flex:1}
  .brand{display:flex;align-items:center;gap:9px;font-weight:600;font-size:15px;color:var(--muted);margin-bottom:30px}
  .dot{width:11px;height:11px;border-radius:50%;background:var(--accent);box-shadow:0 0 16px var(--accent)}
  h1{font-size:30px;line-height:1.15;margin:0 0 8px;letter-spacing:-.02em}
  .sub{color:var(--muted);margin:0 0 26px;font-size:15px}
  .card{
    background:linear-gradient(180deg, var(--panel), var(--panel-2));
    border:1px solid var(--line);border-radius:18px;padding:22px;
    box-shadow:0 30px 60px -30px rgba(0,0,0,.7);
  }
  label{display:block;font-size:13px;color:var(--muted);margin:0 0 8px}
  input[type=text]{
    width:100%;background:#0c121e;border:1px solid var(--line);color:var(--text);
    border-radius:12px;padding:14px 15px;font-size:16px;outline:none;transition:border-color .15s, box-shadow .15s;
  }
  input[type=text]:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(129,140,248,.18)}
  input::placeholder{color:#5d6a82}
  .opt-row{display:flex;gap:8px;margin-bottom:10px;align-items:center}
  .opt-row input{flex:1}
  .x{flex:0 0 auto;width:42px;height:48px;border-radius:12px;border:1px solid var(--line);
     background:#0c121e;color:var(--muted);font-size:20px;cursor:pointer;line-height:1}
  .x:hover{color:#fff;border-color:#33405e}
  .ghost{
    width:100%;background:transparent;border:1px dashed #33405e;color:var(--accent-2);
    border-radius:12px;padding:12px;font-size:14px;cursor:pointer;margin-top:2px;transition:border-color .15s,color .15s;
  }
  .ghost:hover{border-color:var(--accent);color:#fff}
  .btn{
    width:100%;margin-top:18px;border:0;border-radius:13px;padding:15px;
    font-size:16px;font-weight:650;color:#0b0f17;cursor:pointer;
    background:linear-gradient(180deg,var(--accent-2),var(--accent));
    box-shadow:0 12px 28px -10px rgba(129,140,248,.8);transition:transform .08s, filter .15s;
  }
  .btn:hover{filter:brightness(1.06)}
  .btn:active{transform:translateY(1px)}
  .btn[disabled]{opacity:.6;cursor:default;filter:none}
  .err{color:#fca5a5;font-size:14px;margin-top:12px;min-height:18px}
  .field{margin-bottom:18px}
  footer{max-width:560px;margin:0 auto;padding:18px 22px 28px;color:#5d6a82;font-size:12.5px;width:100%}
  footer a{color:#7585a0}
  /* poll page */
  .opts{display:flex;flex-direction:column;gap:11px}
  .vote{
    position:relative;overflow:hidden;cursor:pointer;text-align:left;
    background:#0c121e;border:1px solid var(--line);border-radius:13px;
    padding:15px 16px;color:var(--text);font-size:16px;font-weight:500;
    transition:border-color .15s, transform .08s;
  }
  .vote:hover{border-color:var(--accent)}
  .vote:active{transform:scale(.995)}
  .vote .fill{
    position:absolute;inset:0;width:0;
    background:linear-gradient(90deg, rgba(129,140,248,.30), rgba(129,140,248,.14));
    border-right:2px solid rgba(165,180,252,.55);
    transition:width .7s cubic-bezier(.22,1,.36,1);z-index:0;
  }
  .vote.picked .fill{background:linear-gradient(90deg, rgba(52,211,153,.28), rgba(52,211,153,.12));border-right-color:rgba(52,211,153,.6)}
  .vote .row{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:12px}
  .vote .pct{font-variant-numeric:tabular-nums;color:var(--muted);font-size:14px;font-weight:600}
  .vote.picked .pct{color:var(--good)}
  .check{color:var(--good);font-weight:700}
  .results-mode .vote{cursor:default}
  .results-mode .vote:hover{border-color:var(--line)}
  .total{color:var(--muted);font-size:13.5px;margin:16px 2px 0;display:flex;justify-content:space-between;align-items:center}
  .live{display:inline-flex;align-items:center;gap:6px}
  .pulse{width:8px;height:8px;border-radius:50%;background:var(--good);animation:pulse 1.6s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}
  .share{display:flex;gap:8px;margin-top:14px}
  .share input{flex:1;font-size:14px;color:var(--accent-2)}
  .copy{flex:0 0 auto;border:1px solid var(--line);background:#0c121e;color:var(--text);
        border-radius:12px;padding:0 16px;font-size:14px;font-weight:600;cursor:pointer}
  .copy:hover{border-color:var(--accent)}
  .copy.done{color:var(--good);border-color:rgba(52,211,153,.5)}
  .back{display:inline-block;margin-top:22px;color:var(--muted);font-size:14px}
  .back:hover{color:#fff}
  .pop{animation:pop .5s cubic-bezier(.22,1.4,.5,1)}
  @keyframes pop{0%{transform:scale(.96);opacity:0}100%{transform:scale(1);opacity:1}}
  /* how-to steps */
  .steps{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 26px;list-style:none;padding:0}
  .steps li{
    display:inline-flex;align-items:center;gap:8px;
    background:var(--panel-2);border:1px solid var(--line);border-radius:999px;
    padding:7px 13px 7px 8px;font-size:13px;color:var(--muted);
  }
  .steps b{
    display:inline-flex;align-items:center;justify-content:center;
    width:20px;height:20px;border-radius:50%;flex:0 0 auto;
    background:rgba(129,140,248,.16);color:var(--accent-2);
    font-size:12px;font-weight:700;
  }
  .tip{
    display:flex;align-items:flex-start;gap:10px;margin-top:16px;
    background:var(--panel-2);border:1px solid var(--line);border-radius:13px;
    padding:13px 15px;color:var(--muted);font-size:13.5px;line-height:1.5;
  }
  .tip .ico{color:var(--accent-2);flex:0 0 auto;line-height:1.5}
</style>
</head><body><main>
<div class="brand"><span class="dot"></span> Live Poll <span style="color:#3a465e">·</span> <span style="font-weight:400">on ifhost</span></div>`;

const SHELL_FOOT = `</main>
<footer>Built on <a href="https://host.impossi.build">ifhost</a> — votes are saved and survive restarts. No accounts, no setup.</footer>
</body></html>`;

const HOME_HTML = SHELL_HEAD + `
<h1>Ask anything.<br>Get answers, live.</h1>
<p class="sub">Add a question and a few options. Share the link. Watch the votes roll in.</p>
<ol class="steps">
  <li><b>1</b> Ask a question</li>
  <li><b>2</b> Add a few options</li>
  <li><b>3</b> Create &amp; share the link</li>
</ol>
<div class="card pop">
  <div class="field">
    <label for="q">Your question</label>
    <input id="q" type="text" placeholder="e.g. Where should we eat tonight?" maxlength="200" autocomplete="off">
  </div>
  <div class="field">
    <label>Options</label>
    <div id="opts">
      <div class="opt-row"><input type="text" placeholder="Option 1" maxlength="100" autocomplete="off"></div>
      <div class="opt-row"><input type="text" placeholder="Option 2" maxlength="100" autocomplete="off"></div>
    </div>
    <button class="ghost" id="add" type="button">+ Add option</button>
  </div>
  <button class="btn" id="create" type="button">Create poll</button>
  <div class="err" id="err"></div>
</div>
<script>
  var opts = document.getElementById('opts');
  var add = document.getElementById('add');
  var err = document.getElementById('err');
  var createBtn = document.getElementById('create');

  function addOption(focus){
    if (opts.children.length >= 10) return;
    var row = document.createElement('div');
    row.className = 'opt-row';
    var input = document.createElement('input');
    input.type = 'text'; input.maxLength = 100; input.autocomplete = 'off';
    input.placeholder = 'Option ' + (opts.children.length + 1);
    var x = document.createElement('button');
    x.className = 'x'; x.type = 'button'; x.textContent = '\\u00d7';
    x.title = 'Remove'; x.onclick = function(){ row.remove(); renumber(); };
    row.appendChild(input); row.appendChild(x);
    opts.appendChild(row);
    if (focus) input.focus();
  }
  function renumber(){
    [].forEach.call(opts.children, function(r,i){
      r.querySelector('input').placeholder = 'Option ' + (i+1);
    });
  }
  add.onclick = function(){ addOption(true); };

  function create(){
    err.textContent = '';
    var question = document.getElementById('q').value.trim();
    var options = [].map.call(opts.querySelectorAll('input'), function(i){return i.value.trim();})
                    .filter(function(v){return v;});
    if (!question){ err.textContent = 'Please add a question.'; return; }
    if (options.length < 2){ err.textContent = 'Please add at least two options.'; return; }
    createBtn.disabled = true; createBtn.textContent = 'Creating…';
    fetch('/api/polls', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({question:question, options:options})
    }).then(function(r){return r.json();}).then(function(d){
      if (d.url){ location.href = d.url; }
      else { err.textContent = d.error || 'Something went wrong.'; createBtn.disabled=false; createBtn.textContent='Create poll'; }
    }).catch(function(){
      err.textContent = 'Network error — please try again.'; createBtn.disabled=false; createBtn.textContent='Create poll';
    });
  }
  createBtn.onclick = create;
  document.getElementById('q').addEventListener('keydown', function(e){ if(e.key==='Enter') create(); });
</script>
` + SHELL_FOOT;

const POLL_HTML = SHELL_HEAD + `
<h1 id="question">…</h1>
<p class="sub" id="hint">Tap an option to vote — results appear instantly.</p>
<div class="card pop">
  <div class="opts" id="opts"></div>
  <div class="total">
    <span class="live"><span class="pulse"></span> Live results</span>
    <span id="total">0 votes</span>
  </div>
</div>
<div class="card" id="sharecard" style="margin-top:14px">
  <label>Share this poll</label>
  <div class="share">
    <input id="shareurl" type="text" readonly>
    <button class="copy" id="copy" type="button">Copy</button>
  </div>
  <div class="tip"><span class="ico">→</span><span>Send this link to anyone you'd like to vote — the more people who tap an option, the livelier the results.</span></div>
</div>
<a class="back" href="/">← Create your own poll</a>
<div class="err" id="err"></div>
<script>
  var id = location.pathname.split('/').pop();
  var voteKey = 'voted:' + id;
  var hasVoted = false;
  try { hasVoted = !!localStorage.getItem(voteKey); } catch(e){}
  // Peek at results without voting: append ?results to the poll URL. Handy for
  // sharing a read-only snapshot (and for screenshots). Voting stays disabled.
  var peek = location.search.indexOf('results') !== -1;
  if (peek) hasVoted = true;
  var optsEl = document.getElementById('opts');
  var totalEl = document.getElementById('total');
  var qEl = document.getElementById('question');
  var hintEl = document.getElementById('hint');
  var errEl = document.getElementById('err');
  var cardEl = optsEl.parentElement;
  var current = null;
  var myPick = -1;
  try { var mp = localStorage.getItem(voteKey); if (mp !== null && mp !== '') myPick = Number(mp); } catch(e){}

  document.getElementById('shareurl').value = location.href;
  document.getElementById('copy').onclick = function(){
    var btn = this;
    var inp = document.getElementById('shareurl');
    inp.select();
    var ok = false;
    if (navigator.clipboard){ navigator.clipboard.writeText(inp.value); ok = true; }
    else { try{ ok = document.execCommand('copy'); }catch(e){} }
    if (ok){ btn.textContent='Copied'; btn.classList.add('done'); setTimeout(function(){ btn.textContent='Copy'; btn.classList.remove('done'); }, 1600); }
  };

  function render(data, animate){
    current = data;
    qEl.textContent = data.question;
    if (hasVoted){
      cardEl.classList.add('results-mode');
      hintEl.textContent = peek ? 'Live results — updating in real time.' : 'Thanks for voting — results update live.';
    }
    // Build rows only once, then update widths so the bars animate.
    if (optsEl.children.length !== data.options.length){
      optsEl.innerHTML = '';
      data.options.forEach(function(o){
        var b = document.createElement('button');
        b.className = 'vote'; b.type = 'button'; b.dataset.i = o.i;
        b.innerHTML = '<span class="fill"></span><span class="row"><span class="txt"></span><span class="pct"></span></span>';
        b.querySelector('.txt').textContent = o.text;
        b.onclick = function(){ vote(o.i); };
        optsEl.appendChild(b);
      });
    }
    var total = data.total || 0;
    [].forEach.call(optsEl.children, function(b){
      var o = data.options[Number(b.dataset.i)];
      var pct = total ? Math.round((o.votes/total)*100) : 0;
      // Only paint bars once a vote has been cast (keeps the pre-vote screen clean).
      b.querySelector('.fill').style.width = hasVoted ? pct + '%' : '0%';
      b.querySelector('.pct').textContent = hasVoted ? (pct + '% · ' + o.votes) : '';
      if (Number(b.dataset.i) === myPick){ b.classList.add('picked'); } else { b.classList.remove('picked'); }
    });
    totalEl.textContent = total + (total === 1 ? ' vote' : ' votes');
  }

  function load(animate){
    fetch('/api/polls/' + id).then(function(r){
      if (!r.ok) throw new Error('not found');
      return r.json();
    }).then(function(d){ render(d, animate); }).catch(function(){
      errEl.textContent = 'Could not load this poll.';
    });
  }

  function vote(i){
    if (hasVoted) return;
    hasVoted = true; myPick = i;
    try { localStorage.setItem(voteKey, String(i)); } catch(e){}
    cardEl.classList.add('results-mode');
    hintEl.textContent = 'Thanks for voting — results update live.';
    fetch('/api/polls/' + id + '/vote', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({option:i})
    }).then(function(r){return r.json();}).then(function(d){
      if (d.error){ errEl.textContent = d.error; return; }
      render(d, true);
    }).catch(function(){ errEl.textContent = 'Could not save your vote.'; });
  }

  load(false);
  // Short-poll so results feel live without a refresh.
  setInterval(function(){ load(true); }, 2500);
</script>
` + SHELL_FOOT;

const NOT_FOUND_HTML = SHELL_HEAD + `
<h1>Poll not found</h1>
<p class="sub">This poll may have been removed, or the link is incomplete.</p>
<div class="card pop">
  <a class="btn" href="/" style="display:block;text-align:center;text-decoration:none">Create a new poll</a>
</div>
` + SHELL_FOOT;
