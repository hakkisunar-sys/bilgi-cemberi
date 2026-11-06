(function () {
  'use strict';
  var D = window.GAME_DATA, G = window.Game, CATS = D.categories, Net = window.Net;
  var $app = document.getElementById('app');
  var store = Net.local ? sessionStorage : localStorage;
  function ls(k, v) {
    try {
      if (v === undefined) return store.getItem(k);
      if (v === null) store.removeItem(k); else store.setItem(k, v);
    } catch (e) { return null; }
  }
  var pid = ls('bc_pid') || (function () { var p = 'p' + Math.random().toString(36).slice(2, 10); ls('bc_pid', p); return p; })();
  var params = new URLSearchParams(location.search);

  var S = { code: null, view: null, t: null, broker: null, conn: 'online', ui: {}, deadline: 0, busy: false, wasIn: false };
  var host = null, hostTimers = [];

  document.title = D.title;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function topic(x) { return Net.PREFIX + S.code + '/' + x; }
  function toast(msg) {
    var el = document.getElementById('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  function shareLink() {
    var u = location.origin + location.pathname + '?oda=' + S.code + '&s=' + S.broker;
    return Net.local ? u + '&local=1' : u;
  }
  function wakeLock() { try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(function () {}); } catch (e) {} }

  /* ================= Ağ ================= */
  function send(a) {
    a.pid = pid;
    if (host) hostHandle(a);
    else if (S.t) S.t.publish(topic('a'), a, false);
  }

  function hostHandle(a) {
    var err = G.apply(host, a, { now: Date.now(), rng: Math.random, data: D });
    if (err && a.t !== 'hb') notify(a.pid, err);
    hostPublish();
  }
  function hostPublish() {
    host.v++;
    ls('bc_host_' + S.code, JSON.stringify(host));
    var v = G.publicView(host, Date.now(), D);
    S.t.publish(topic('s'), v, true);
    onView(v);
  }
  function notify(to, msg) {
    if (to === pid) toast(msg); else S.t.publish(topic('n'), { to: to, msg: msg }, false);
  }
  function startHosting() {
    S.t.subscribe(topic('a'), function (s) {
      var a; try { a = JSON.parse(s); } catch (e) { return; }
      if (a && typeof a.pid === 'string') hostHandle(a);
    });
    hostTimers.push(setInterval(function () { if (G.tick(host, Date.now(), Math.random, D)) hostPublish(); }, 250));
    hostTimers.push(setInterval(hostPublish, 5000));
    hostPublish();
  }

  function listen() {
    S.t.subscribe(topic('s'), function (s) {
      if (host) return;
      if (!s) { if (S.view) { toast('Oda kapandı'); leave(); } return; }
      var v; try { v = JSON.parse(s); } catch (e) { return; }
      if (S.view && v.v < S.view.v && v.host === S.view.host) return;
      onView(v);
    });
    S.t.subscribe(topic('n'), function (s) {
      try { var n = JSON.parse(s); if (n.to === pid) toast(n.msg); } catch (e) {}
    });
    setInterval(function () { send({ t: 'hb' }); }, 8000);
  }

  function setUrl() { history.replaceState(null, '', shareLink().replace(location.origin, '')); }

  function createRoom(name) {
    S.busy = true; render();
    Net.connect(null, onConn).then(function (c) {
      S.t = c.t; S.broker = c.broker;
      var A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      S.code = ''; for (var i = 0; i < 4; i++) S.code += A[Math.floor(Math.random() * A.length)];
      host = G.newState(S.code, pid);
      G.apply(host, { pid: pid, t: 'join', name: name }, { now: Date.now(), rng: Math.random, data: D });
      setUrl(); listen(); startHosting(); S.busy = false;
    }, function () { S.busy = false; render(); toast('İnternete bağlanılamadı, tekrar dene'); });
  }

  function resumeHost(code, saved, broker) {
    S.code = code; S.busy = true; render();
    Net.connect(broker, onConn).then(function (c) {
      S.t = c.t; S.broker = c.broker; host = saved;
      setUrl(); listen(); startHosting(); S.busy = false;
      toast('Oyuna geri döndün');
    }, function () { S.busy = false; S.code = null; render(); toast('İnternete bağlanılamadı'); });
  }

  function joinRoom(code, name, team) {
    ls('bc_last', code); // aynı odaya geri dönüşte otomatik katılmak için
    S.busy = true; S.code = code; render();
    var pref = params.get('oda') === code && params.get('s') != null ? +params.get('s') : null;
    var order = Net.local ? [0] : pref != null ? [pref] : Net.BROKERS.map(function (_, i) { return i; });
    (function tryNext(k) {
      if (k >= order.length) { S.busy = false; S.code = null; render(); toast(code + ' kodlu oda bulunamadı'); return; }
      Net.connect(order[k], onConn).then(function (c) {
        if (c.broker !== order[k]) { c.t.close(); return tryNext(k + 1); }
        S.t = c.t; S.broker = c.broker;
        listen();
        var waited = 0, iv = setInterval(function () {
          waited += 250;
          if (S.view) { clearInterval(iv); S.busy = false; setUrl(); send({ t: 'join', name: name, team: team }); render(); }
          else if (waited >= 5000) { clearInterval(iv); c.t.close(); S.t = null; tryNext(k + 1); }
        }, 250);
      }, function () { tryNext(k + 1); });
    })(0);
  }

  function onConn(st) { S.conn = st; renderConn(); }
  function renderConn() {
    var el = document.getElementById('conn');
    if (S.conn === 'online') { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'conn'; el.className = 'conn'; document.body.appendChild(el); }
    el.textContent = 'Bağlantı koptu, yeniden bağlanılıyor…';
  }

  function leave() {
    if (host && !confirm('Oyunu kapatırsan herkesin oyunu biter. Emin misin?')) return;
    if (host) { S.t.clear(topic('s')); ls('bc_host_' + S.code, null); hostTimers.forEach(clearInterval); }
    try { S.t && S.t.close(); } catch (e) {}
    location.href = location.pathname + (Net.local ? '?local=1' : '');
  }

  /* ================= Durum ================= */
  function me() { return S.view && S.view.players[pid]; }
  function mySide(v) { return G.sideOf(v, pid); }
  function active(v) { return v.sides[v.turn]; }
  function myTurn(v) { var s = active(v); return s && s.members.indexOf(pid) >= 0; }

  function onView(v) {
    var prev = S.view;
    var key = v.phase + '|' + v.turn + '|' + (v.question ? v.question.text : '') + '|' + v.roll;
    if (!prev || key !== S.ui.key) {
      S.ui = { key: key, sel: null, sheetShown: S.ui.sheetShown, rolled: prev && v.roll && v.roll !== prev.roll };
      if (v.phase === 'roll' && myTurn(v) && (!prev || prev.phase !== 'roll' || prev.turn !== v.turn)) {
        try { navigator.vibrate && navigator.vibrate(120); } catch (e) {}
      }
    }
    if (v.question && v.question.left != null) S.deadline = Date.now() + v.question.left;
    if (v.players[pid]) S.wasIn = true;
    else if (S.wasIn) { S.view = v; toast('Odadan çıkarıldın'); setTimeout(leave, 1500); return; }
    S.view = v;
    render();
  }

  /* ================= Çizim ================= */
  function render() {
    renderConn();
    if (!S.view) return renderHome();
    if (!me()) { $app.innerHTML = '<div class="hero"><h2>Katılıyor…</h2></div>'; return; }
    if (S.view.phase === 'lobby') return renderLobby(S.view);
    renderGame(S.view);
  }

  function logoSVG() {
    var s = '<svg class="logo" viewBox="-60 -60 120 120">';
    CATS.forEach(function (c, i) {
      var a0 = (i / 6) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / 6) * Math.PI * 2 - Math.PI / 2;
      s += '<path d="M0 0 L' + 56 * Math.cos(a0) + ' ' + 56 * Math.sin(a0) + ' A56 56 0 0 1 ' + 56 * Math.cos(a1) + ' ' + 56 * Math.sin(a1) + 'Z" fill="' + c.color + '" stroke="#14112b" stroke-width="3"/>';
    });
    return s + '<circle r="20" fill="#14112b"/><circle r="11" fill="#ffd447"/></svg>';
  }

  function renderHome() {
    var name = ls('bc_name') || '', code = (params.get('oda') || '').toUpperCase();
    $app.innerHTML =
      '<div class="hero">' + logoSVG() + '<h1>' + esc(D.title).replace(/(\S+)$/, '<span>$1</span>') + '</h1>' +
      '<p class="muted">Herkes kendi telefonundan, aynı tahtada.</p></div>' +
      '<div class="card stack">' +
      '<div><div class="label">Adın</div><input id="name" class="input" maxlength="20" placeholder="Örn. Ayşe" value="' + esc(name) + '" autocomplete="nickname"></div>' +
      (code ? '' : '<button class="btn primary block" data-act="create"' + (S.busy ? ' disabled' : '') + '>Yeni oyun kur</button>' +
        '<div class="divider">ya da odaya katıl</div>') +
      '<div class="row"><input id="code" class="input code-input grow" maxlength="4" placeholder="KOD" value="' + esc(code) + '" autocapitalize="characters" autocomplete="off">' +
      '<button class="btn ' + (code ? 'primary' : '') + '" data-act="join"' + (S.busy ? ' disabled' : '') + '>Katıl</button></div>' +
      (code ? '<button class="btn ghost block small" data-act="nocode">Kendi oyununu kur</button>' : '') +
      (S.busy ? '<p class="muted small" style="text-align:center">Bağlanılıyor…</p>' : '') +
      '</div>';
    var n = document.getElementById(code ? 'name' : 'name');
    if (!name) n.focus();
  }

  function settingChips(v, isHost) {
    var st = v.settings, h = '';
    h += '<div><div class="label">Oyun türü</div><div class="chips">' +
      chip('mode', 'solo', 'Bireysel', st.mode === 'solo', isHost) + chip('mode', 'team', 'Takım', st.mode === 'team', isHost) + '</div></div>';
    if (st.mode === 'team') {
      h += '<div><div class="label">Takım sayısı</div><div class="chips">';
      [2, 3, 4, 5, 6].forEach(function (n) { h += chip('teamCount', n, n, st.teamCount === n, isHost); });
      h += '</div></div>';
    }
    h += '<div><div class="label">Soru süresi</div><div class="chips">';
    G.TIMERS.forEach(function (n) { h += chip('timer', n, n + ' sn', st.timer === n, isHost); });
    h += '</div></div>';
    var hasBot = Object.keys(v.players).some(function (p) { return v.players[p].bot; });
    if (hasBot) {
      h += '<div><div class="label">Bot seviyesi</div><div class="chips">' +
        chip('botSkill', 'easy', 'Kolay', st.botSkill === 'easy', isHost) + chip('botSkill', 'mid', 'Orta', st.botSkill === 'mid', isHost) +
        chip('botSkill', 'hard', 'Zor', st.botSkill === 'hard', isHost) + '</div></div>';
    }
    return h;
  }
  function chip(k, val, label, on, enabled) {
    if (!enabled && !on) return '';
    return '<button class="chip' + (on ? ' on' : '') + '"' + (enabled ? ' data-act="set" data-k="' + k + '" data-v="' + val + '"' : ' disabled') + '>' + label + '</button>';
  }

  function teamPicker(v, gameMode) {
    var n = v.settings.teamCount, h = '<div class="teams">';
    for (var t = 0; t < n; t++) {
      var col = G.SIDE_COLORS[t].color;
      var mem = Object.keys(v.players).filter(function (p) { return v.players[p].team === t; });
      if (gameMode && !v.sides.some(function (s) { return s.id === 't' + t; })) continue;
      h += '<button class="team' + (v.players[pid].team === t ? ' mine' : '') + '" style="color:' + col + '" data-act="team" data-v="' + t + '">' +
        '<div class="tn">' + esc(G.teamName(t)) + '</div><div class="tm">' + (mem.map(function (p) { return esc(v.players[p].name); }).join(', ') || '<span class="muted">boş</span>') + '</div></button>';
    }
    return h + '</div>';
  }

  function renderLobby(v) {
    var isHost = v.host === pid, link = shareLink();
    var qr = '';
    try { var q = qrcode(0, 'M'); q.addData(link); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch (e) {}
    var players = Object.keys(v.players).map(function (p) {
      var pl = v.players[p];
      return '<div class="player"><span class="dot' + (v.online[p] ? ' on' : '') + '"></span><span class="grow">' + esc(pl.name) +
        (p === pid ? ' <span class="tag">sen</span>' : '') + (p === v.host ? ' <span class="tag">kurucu</span>' : '') + (pl.bot ? ' <span class="tag">🤖 bot</span>' : '') + '</span>' +
        (pl.bot && isHost && v.settings.mode === 'team' ? '<button class="chip small" data-act="botteam" data-v="' + p + '">' + (pl.team == null ? 'Takım: otomatik' : esc(G.teamName(pl.team))) + '</button>' : '') +
        (isHost && p !== pid ? '<button class="x" data-act="kick" data-v="' + p + '" aria-label="Çıkar">✕</button>' : '') + '</div>';
    }).join('');
    $app.innerHTML =
      '<div class="topbar"><h2 class="grow">' + esc(D.title) + '</h2><button class="btn ghost small" style="padding:8px 14px" data-act="leave">Çık</button></div>' +
      '<div class="card stack">' +
      '<div class="row"><div class="grow"><div class="label">Oda kodu</div><div class="roomcode">' + v.code + '</div>' +
      '<div class="muted small" style="margin-top:6px">Arkadaşların bu kodu girsin ya da QR\'ı okutsun.</div></div>' +
      (qr ? '<div class="qr">' + qr + '</div>' : '') + '</div>' +
      '<button class="btn block" data-act="share">Davet linkini paylaş</button></div>' +
      '<div class="card stack" style="margin-top:12px">' + settingChips(v, isHost) +
      (isHost ? '' : '<div class="muted small">Ayarları oyunu kuran belirler.</div>') + '</div>' +
      (v.settings.mode === 'team' ? '<div class="card" style="margin-top:12px"><div class="label">Takımını seç</div>' + teamPicker(v) +
        '<div class="muted small" style="margin-top:8px">Takım seçmeyenler oyun başlarken dağıtılır. Takımda herkes aynı cevabı onaylayınca cevap kesinleşir.</div></div>' : '') +
      '<div class="card" style="margin-top:12px"><div class="label">Oyuncular (' + Object.keys(v.players).length + '/' + G.MAX_PLAYERS + ')</div>' + players +
      (isHost ? '<button class="btn ghost block" style="margin-top:10px" data-act="addbot"' + (Object.keys(v.players).length >= G.MAX_PLAYERS ? ' disabled' : '') + '>🤖 Bot ekle</button>' : '') + '</div>' +
      '<div style="margin-top:14px">' + (isHost ? (Object.keys(v.players).length < G.MIN_PLAYERS ? '<p class="muted small" style="text-align:center">Başlamak için en az ' + G.MIN_PLAYERS + ' oyuncu gerekli (bot da sayılır).</p>' : '') +
        '<button class="btn primary block" data-act="start"' + (Object.keys(v.players).length < G.MIN_PLAYERS ? ' disabled' : '') + '>Oyunu başlat</button>'
        : '<p class="muted" style="text-align:center">Kurucunun oyunu başlatması bekleniyor…</p>') + '</div>';
  }

  /* ---------- Tahta ---------- */
  function nodeColor(n) { return n.type === 'hub' ? '#14112b' : CATS[n.cat].color; }
  function nodeLabel(id) {
    var n = G.BOARD.nodes[id];
    return n.type === 'hub' ? 'Merkez (kategori seçersin)' : CATS[n.cat].name;
  }
  function slice(cx, cy, r, i, fill, extra) {
    var a0 = (i / 6) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / 6) * Math.PI * 2 - Math.PI / 2;
    return '<path d="M' + cx + ' ' + cy + ' L' + (cx + r * Math.cos(a0)) + ' ' + (cy + r * Math.sin(a0)) + ' A' + r + ' ' + r + ' 0 0 1 ' +
      (cx + r * Math.cos(a1)) + ' ' + (cy + r * Math.sin(a1)) + 'Z" fill="' + fill + '"' + (extra || '') + '/>';
  }
  function boardSVG(v) {
    var B = G.BOARD, h = '<svg class="board" viewBox="0 0 1000 1000" role="img" aria-label="Oyun tahtası">';
    h += '<circle cx="500" cy="500" r="438" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="70"/>';
    for (var s = 0; s < 6; s++) {
      var a = (s * 7 / 42) * Math.PI * 2 - Math.PI / 2;
      h += '<line x1="500" y1="500" x2="' + (500 + 438 * Math.cos(a)) + '" y2="' + (500 + 438 * Math.sin(a)) + '" stroke="rgba(255,255,255,.08)" stroke-width="58" stroke-linecap="round"/>';
    }
    Object.keys(B.nodes).forEach(function (id) {
      var n = B.nodes[id];
      if (n.type === 'hub') {
        for (var i = 0; i < 6; i++) h += slice(500, 500, 72, i, CATS[i].color, ' stroke="#14112b" stroke-width="4"');
        h += '<circle cx="500" cy="500" r="28" fill="#14112b"/><circle cx="500" cy="500" r="14" fill="#ffd447"/>';
      } else {
        var big = n.type === 'junction', gone = v.avail && v.avail.indexOf(n.cat) < 0;
        h += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + (big ? 36 : 27) + '" fill="' + nodeColor(n) + '" stroke="' + (big ? '#fff' : '#14112b') + '" stroke-width="' + (big ? 5 : 4) + '"' + (gone ? ' opacity=".22"' : '') + '/>';
        if (gone) h += '<text x="' + n.x + '" y="' + (n.y + 10) + '" text-anchor="middle" font-size="28" fill="#fff" opacity=".6">✕</text>';
      }
    });
    // gidilebilecek kareler
    var mine = myTurn(v) && v.phase === 'move' && !v.paused;
    (v.blocked || []).forEach(function (id) {
      var n = B.nodes[id], r = n.type === 'junction' ? 47 : n.type === 'hub' ? 84 : 38;
      h += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="4" stroke-dasharray="8 8"/>';
    });
    (v.dests || []).forEach(function (id) {
      var n = B.nodes[id], r = n.type === 'junction' ? 47 : n.type === 'hub' ? 84 : 38, sel = S.ui.sel === id;
      h += '<circle class="' + (sel ? '' : 'dest') + '" cx="' + n.x + '" cy="' + n.y + '" r="' + r + '" fill="' + (sel ? 'rgba(255,255,255,.35)' : 'transparent') +
        '" stroke="#fff" stroke-width="' + (sel ? 9 : 6) + '"' + (mine ? ' data-act="dest" data-v="' + id + '"' : '') + '/>';
      if (mine) h += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + (r + 12) + '" fill="transparent" data-act="dest" data-v="' + id + '"/>';
    });
    // takım arkadaşlarının seçtiği kareler
    if (v.phase === 'move') Object.keys(v.votes || {}).forEach(function (p) {
      var n = B.nodes[v.votes[p]]; if (!n) return;
      h += '<text x="' + n.x + '" y="' + (n.y - 46) + '" text-anchor="middle" font-size="26" fill="#fff" font-weight="800" pointer-events="none">' + esc((v.players[p] || {}).name || '').slice(0, 6) + '</text>';
    });
    // piyonlar
    var groups = {};
    v.sides.forEach(function (sd, i) { (groups[sd.pos] = groups[sd.pos] || []).push(i); });
    Object.keys(groups).forEach(function (pos) {
      var n = B.nodes[pos], g = groups[pos];
      g.forEach(function (i, k) {
        var sd = v.sides[i], off = g.length > 1 ? 22 : 0, ang = (k / g.length) * Math.PI * 2;
        var x = n.x + off * Math.cos(ang), y = n.y + off * Math.sin(ang), act = i === v.turn;
        h += '<g pointer-events="none">' + (act ? '<circle cx="' + x + '" cy="' + y + '" r="27" fill="none" stroke="#fff" stroke-width="3" opacity=".8"><animate attributeName="r" values="22;30;22" dur="1.4s" repeatCount="indefinite"/></circle>' : '') +
          '<circle cx="' + x + '" cy="' + (y + 4) + '" r="19" fill="rgba(0,0,0,.4)"/><circle cx="' + x + '" cy="' + y + '" r="19" fill="' + sd.color + '" stroke="#fff" stroke-width="4"/>' +
          pieInner(sd, x, y, 11) + '</g>';
      });
    });
    return h + '</svg>';
  }
  function pieInner(sd, x, y, r) {
    var h = '';
    for (var i = 0; i < 6; i++) if (sd.wedges[i]) h += slice(x, y, r, i, CATS[i].color);
    return h;
  }
  function pie(sd) {
    var h = '<svg class="pie" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="' + sd.color + '"/><circle cx="20" cy="20" r="15" fill="#14112b"/>';
    for (var i = 0; i < 6; i++) h += slice(20, 20, 14, i, sd.wedges[i] ? CATS[i].color : 'rgba(255,255,255,.07)', ' stroke="#14112b" stroke-width="1.2"');
    return h + '</svg>';
  }

  /* ---------- Oyun ekranı ---------- */
  function names(v, pids) { return pids.map(function (p) { return (v.players[p] || {}).name || '?'; }); }
  function voteSummary(v, fmt) {
    var side = active(v);
    if (side.members.length < 2) return '';
    var parts = side.members.map(function (p) {
      var val = v.votes[p];
      return esc(v.players[p].name) + ': ' + (val === undefined ? '<span class="muted">seçmedi</span>' : esc(fmt(val))) + (v.online[p] ? '' : ' <span class="muted">(çevrimdışı)</span>');
    });
    return '<div class="muted small" style="margin-top:8px">' + parts.join(' · ') + '</div>';
  }

  function actionsHTML(v) {
    var side = active(v), mine = myTurn(v), h = '';
    var team = side.members.length > 1;
    if (v.phase === 'roll') {
      h = mine ? '<button class="btn primary block" data-act="roll" style="font-size:20px;padding:18px">🎲 Zar at</button>' +
          '<div class="muted small" style="text-align:center;margin-top:8px">' + (S.shake ? '📳 Telefonu sallayarak da atabilirsin' : 'Telefonu sallayarak atmak için önce bir kez düğmeye bas') + '</div>'
        : '<div class="muted">' + esc(side.name) + ' zar atacak…</div>';
    } else if (v.phase === 'move') {
      h = '<div class="row"><div class="dice' + (S.ui.rolled ? ' rolling' : '') + '">' + v.roll + '</div><div class="grow">' +
        (mine ? (S.ui.sel ? '<b>' + esc(nodeLabel(S.ui.sel)) + '</b><div class="muted small">' + (team ? 'Takımdaki herkes aynı kareyi seçmeli' : 'Onaylayınca piyon gider') + '</div>'
          : 'Tahtada parlayan karelerden birine dokun')
          : '<span class="muted">' + esc(side.name) + ' nereye gideceğini seçiyor…</span>') + '</div></div>' +
        (mine && S.ui.sel ? '<button class="btn primary block" style="margin-top:10px" data-act="confirm-move">Buraya git</button>' : '') +
        voteSummary(v, nodeLabel);
    } else if (v.phase === 'category') {
      if (mine) {
        h = '<div style="margin-bottom:8px">Merkezdesin! Sorunun geleceği kategoriyi seç:</div><div class="catgrid">' +
          CATS.map(function (c, i) {
            if (v.avail && v.avail.indexOf(i) < 0) return '<button class="catbtn" style="background:' + c.color + ';opacity:.3" disabled>' + esc(c.name) + ' (bitti)</button>';
            return '<button class="catbtn' + (S.ui.sel === i ? ' sel' : '') + '" style="background:' + c.color + '" data-act="cat" data-v="' + i + '">' + esc(c.name) + '</button>';
          }).join('') + '</div>' +
          (S.ui.sel != null ? '<button class="btn primary block" style="margin-top:10px" data-act="confirm-cat">Bu kategoriden sor</button>' : '');
      } else h = '<div class="muted">' + esc(side.name) + ' merkezde, kategori seçiyor…</div>';
      h += voteSummary(v, function (i) { return CATS[i].name; });
    } else if (v.phase === 'question' || v.phase === 'result') {
      h = '<button class="btn block" data-act="showq">Soruyu göster</button>';
    }
    if (!mySide(v) && v.settings.mode === 'team') {
      h += '<div class="card" style="margin-top:12px"><div class="label">Bir takıma katıl</div>' + teamPicker(v, true) + '</div>';
    } else if (!mySide(v)) h += '<div class="muted small" style="margin-top:8px">İzleyicisin.</div>';
    return h;
  }

  function scoresHTML(v) {
    return '<div class="scores">' + v.sides.map(function (sd, i) {
      var cnt = sd.wedges.filter(Boolean).length;
      return '<div class="score' + (i === v.turn ? ' active' : '') + '" style="border-color:' + sd.color + '">' + pie(sd) +
        '<div class="grow"><div>' + esc(sd.name) + (sd.members.indexOf(pid) >= 0 ? ' <span class="tag">sen</span>' : '') + (sd.done ? ' <span class="tag" style="background:var(--accent);color:#2a1d00">🏁 ' + sd.rank + '.</span>' : '') + '</div>' +
        (sd.members.length > 1 || v.settings.mode === 'team' ? '<div class="who">' + esc(names(v, sd.members).join(', ')) + '</div>' : '') + '</div>' +
        '<div class="display" style="font-size:22px">' + cnt + '<span class="muted" style="font-size:14px">/6</span></div></div>';
    }).join('') + '</div>';
  }

  function questionSheet(v) {
    var q = v.question, side = active(v), mine = myTurn(v), c = CATS[q.cat], res = v.phase === 'result' ? v.result : null;
    var anim = S.ui.sheetShown !== S.ui.key; S.ui.sheetShown = S.ui.key;
    var keys = 'ABCDEFGH';
    var votersBy = {};
    Object.keys(v.votes || {}).forEach(function (p) { (votersBy[v.votes[p]] = votersBy[v.votes[p]] || []).push(p); });
    var team = side.members.length > 1;
    var h = '<div class="sheet-bg"' + (anim ? '' : ' style="animation:none"') + '><div class="sheet"' + (anim ? '' : ' style="animation:none"') + '>' +
      '<div class="qhead" style="background:' + c.color + '"><span class="display grow">' + esc(c.name) + '</span>' +
      (q.final ? '<span class="final-badge">FİNAL SORUSU</span>' : '') +
      (!res ? '<button class="iconbtn" style="background:rgba(20,15,45,.25);width:34px;height:34px" data-act="hideq" aria-label="Küçült">▾</button>' : '') + '</div>' +
      '<div class="qbody"><div class="row muted small" style="margin-bottom:6px"><span class="grow">' + esc(side.name) + (mine ? ' (sen)' : '') + ' cevaplıyor</span><span>' + ['Normal', 'Zor', 'Çok zor'][q.d] + ' · ' + esc(q.id) + '</span></div>' +
      '<div class="qtext">' + esc(q.text) + '</div>' +
      (q.timer && !res ? '<div class="timer" id="timer"><i id="tbar"></i></div>' : '');
    q.options.forEach(function (o, i) {
      var cls = 'opt';
      if (res) { if (i === q.correct) cls += ' right'; else if (i === res.chosen) cls += ' wrong'; }
      else if (S.ui.sel === i) cls += ' sel';
      var vs = team && !res ? (votersBy[i] || []).map(function (p) { return '<span class="voter">🔒 ' + esc(v.players[p].name) + '</span>'; }).join('') : '';
      h += '<button class="' + cls + '"' + (mine && !res && !v.paused ? ' data-act="opt" data-v="' + i + '"' : ' disabled') + '><span class="k">' + keys[i] + '</span><span class="grow">' + esc(o) + '</span>' +
        (vs ? '<span class="voters">' + vs + '</span>' : '') + '</button>';
    });
    if (res) {
      h += '<div class="verdict" style="color:' + (res.correct ? 'var(--good)' : 'var(--bad)') + '">' +
        (res.correct ? (q.final ? '🏁 Final tamam!' : 'Doğru! 🎉') : res.timeout ? '⏰ Süre doldu' : 'Yanlış') + '</div>' +
        (res.wedge ? '<div style="text-align:center;margin-bottom:6px">' + esc(c.name) + ' rengi kazanıldı!</div>' : '') +
        '<div class="muted small" style="text-align:center">' + (res.correct ? (q.final ? '' : side.wedges.every(Boolean) ? 'Altı renk tamam — sıradaki soru final!' : 'Tekrar zar atma hakkı') : q.final ? 'Renkler korunuyor, sırası gelince yeni final sorusu' : 'Sıra bir sonrakine geçiyor') + '</div>';
    } else if (mine && !v.paused) {
      var locked = v.votes[pid];
      h += '<button class="btn primary block" data-act="answer" style="margin-top:4px"' + (S.ui.sel == null || S.ui.sel === locked ? ' disabled' : '') + '>🔒 Kilitle' + (S.ui.sel != null ? ' (' + keys[S.ui.sel] + ')' : '') + '</button>' +
        '<div class="muted small" style="text-align:center;margin-top:8px">' + (team
          ? (locked !== undefined ? 'Sen ' + keys[locked] + ' şıkkını kilitledin. Takımdaki herkes aynı şıkkı kilitleyince cevap kesinleşir; fikrin değişirse başka şık seçip yeniden kilitleyebilirsin.' : 'Şık seç, sonra kilitle. Takımdaki herkes aynı şıkkı kilitleyince cevap kesinleşir.')
          : 'Şık seçip istediğin kadar değiştirebilirsin; Kilitle\'ye basınca cevap kesinleşir.') + '</div>';
    } else if (!mine) {
      h += '<div class="muted small" style="text-align:center">Sadece sırası gelen cevaplayabilir.</div>';
    }
    return h + '</div></div></div>';
  }

  function renderGame(v) {
    var isHost = v.host === pid, side = active(v);
    var h = '<div class="topbar"><span class="pill">Oda <b>' + v.code + '</b></span>' +
      (v.settings.timer ? '<span class="pill">⏱ ' + v.settings.timer + ' sn</span>' : '') + '<span class="grow"></span>' +
      '<div style="position:relative"><button class="iconbtn" data-act="menu" aria-label="Menü">⋯</button>' + (S.ui.menu ? menuHTML(v, isHost) : '') + '</div></div>';
    h += '<div class="board-wrap">' + boardSVG(v) + '</div>';
    if (side && v.phase !== 'over') {
      h += '<div class="turn"><span class="swatch" style="background:' + side.color + '"></span><div class="grow">Sıra: <b>' + esc(side.name) + '</b>' +
        (myTurn(v) ? ' <span class="tag" style="background:var(--accent);color:#2a1d00">senin</span>' : '') + '</div></div>';
      h += '<div class="actions">' + actionsHTML(v) + '</div>';
    }
    h += scoresHTML(v);
    h += '<div class="log">' + v.log.slice(0, 5).map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') + '</div>';
    if ((v.phase === 'question' || v.phase === 'result') && v.question && !S.ui.hideq) h += questionSheet(v);
    if (v.paused) h += '<div class="overlay"><div><div class="big display">⏸ Oyun duraklatıldı</div>' +
      (isHost ? '<button class="btn primary" style="margin-top:20px" data-act="resume">Devam et</button>' : '<p class="muted">Kurucu devam ettirince oyun sürecek.</p>') + '</div></div>';
    var w = v.sides.filter(function (s) { return s.id === v.winner; })[0];
    if (v.phase === 'decide') {
      h += '<div class="overlay"><div><div class="winner-pawn" style="background:' + w.color + '"></div><div class="big display">🏆 ' + esc(w.name) + ' maçı kazandı!</div>' +
        (isHost ? '<div style="margin-top:22px;display:grid;gap:10px"><button class="btn primary" data-act="cont">Sıralama için devam et</button><button class="btn ghost" data-act="end">Maçı bitir</button></div>'
          : '<p class="muted" style="margin-top:16px">Kurucu maçı bitirmeye ya da sıralama için devam etmeye karar veriyor…</p>') + '</div></div>';
    }
    if (v.phase === 'over') {
      var rank = (v.ranking || []).map(function (id, i) {
        var sd = v.sides.filter(function (s) { return s.id === id; })[0];
        return '<div class="score" style="border-color:' + sd.color + ';text-align:left">' + '<div class="display" style="font-size:24px;width:30px">' + (i + 1) + '.</div>' + pie(sd) +
          '<div class="grow">' + esc(sd.name) + (sd.done ? '' : ' <span class="muted small">(' + sd.wedges.filter(Boolean).length + ' renk)</span>') + '</div></div>';
      }).join('');
      h += '<div class="overlay" style="overflow:auto"><div style="width:100%;max-width:420px">' + (w ? '<div class="winner-pawn" style="background:' + w.color + '"></div><div class="big display">🏆 ' + esc(w.name) + ' kazandı!</div>'
        : '<div class="big display">Oyun bitti</div>') +
        (v.overReason ? '<p class="muted">' + esc(v.overReason) + '</p>' : '') +
        '<div class="scores" style="margin-top:16px">' + rank + '</div>' +
        '<div style="margin-top:22px;display:grid;gap:10px">' + (isHost ? '<button class="btn primary" data-act="reset">Yeni maç (lobiye dön)</button>' : '<p class="muted">Kurucu yeni maç başlatabilir.</p>') +
        '<button class="btn ghost" data-act="leave">Çık</button></div></div></div>';
    }
    $app.innerHTML = h;
    tickTimer();
  }

  function menuHTML(v, isHost) {
    var h = '<div class="menu">';
    if (isHost) {
      h += v.paused ? '<button data-act="resume">▶ Devam et</button>' : '<button data-act="pause">⏸ Oyunu duraklat</button>';
      h += '<button data-act="skip">⏭ Sırayı geç</button><button data-act="end">⏹ Oyunu bitir</button>';
    }
    h += '<button data-act="share">🔗 Davet linki</button><button data-act="leave">🚪 Çık</button>';
    return h + '</div>';
  }

  function tickTimer() {
    var bar = document.getElementById('tbar'), v = S.view;
    if (!bar || !v || !v.question || !v.question.timer) return;
    var left = v.paused ? v.question.left : Math.max(0, S.deadline - Date.now());
    var frac = left / (v.question.timer * 1000);
    bar.style.transform = 'scaleX(' + frac + ')';
    document.getElementById('timer').classList.toggle('low', left < 5000);
  }
  setInterval(tickTimer, 100);

  /* ================= Sallayarak zar ================= */
  S.shake = false;
  function enableShake() {
    if (S.shake || !window.DeviceMotionEvent) return;
    var go = function () {
      var last = 0, prev = null;
      window.addEventListener('devicemotion', function (e) {
        var a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
        if (prev) {
          var d = Math.abs(a.x - prev.x) + Math.abs(a.y - prev.y) + Math.abs(a.z - prev.z);
          var v = S.view, now = Date.now();
          if (d > 30 && now - last > 1500 && v && v.phase === 'roll' && !v.paused && myTurn(v)) {
            last = now; try { navigator.vibrate && navigator.vibrate(60); } catch (er) {}
            send({ t: 'roll' });
          }
        }
        prev = { x: a.x, y: a.y, z: a.z };
      });
      S.shake = true;
    };
    if (typeof DeviceMotionEvent.requestPermission === 'function') {   // iPhone izin ister
      DeviceMotionEvent.requestPermission().then(function (r) { if (r === 'granted') { go(); render(); } }).catch(function () {});
    } else go();
  }

  /* ================= Etkileşim ================= */
  $app.addEventListener('click', function (e) {
    enableShake();
    var el = e.target.closest('[data-act]');
    if (!el) { if (S.ui.menu) { S.ui.menu = false; render(); } return; }
    var act = el.getAttribute('data-act'), val = el.getAttribute('data-v'), v = S.view;
    if (act !== 'menu' && S.ui.menu) S.ui.menu = false;
    switch (act) {
      case 'create': case 'join': {
        var name = document.getElementById('name').value.trim();
        if (!name) { toast('Önce adını yaz'); document.getElementById('name').focus(); return; }
        ls('bc_name', name); wakeLock();
        if (act === 'create') return createRoom(name);
        var code = document.getElementById('code').value.trim().toUpperCase();
        if (code.length !== 4) { toast('4 harfli oda kodunu yaz'); return; }
        return joinRoom(code, name);
      }
      case 'nocode': params.delete('oda'); history.replaceState(null, '', location.pathname + (Net.local ? '?local=1' : '')); return renderHome();
      case 'set': {
        var s = {}, k = el.getAttribute('data-k'); s[k] = (k === 'mode' || k === 'botSkill') ? val : +val;
        return send({ t: 'settings', settings: s });
      }
      case 'team': return send({ t: 'team', team: +val });
      case 'kick': if (confirm(v.players[val].name + ' odadan çıkarılsın mı?')) send({ t: 'kick', target: val }); return;
      case 'start': wakeLock(); return send({ t: 'start' });
      case 'addbot': return send({ t: 'addbot' });
      case 'botteam': {
        var bt = v.players[val].team, nt = bt == null ? 0 : bt + 1;
        return send({ t: 'botteam', target: val, team: nt >= v.settings.teamCount ? null : nt });
      }
      case 'cont': return send({ t: 'cont' });
      case 'share': {
        var link = shareLink();
        if (navigator.share) navigator.share({ title: D.title, text: D.title + ' oyununa katıl! Oda kodu: ' + S.code, url: link }).catch(function () {});
        else if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { toast('Link kopyalandı'); });
        else prompt('Linki kopyala:', link);
        return render();
      }
      case 'leave': return leave();
      case 'menu': S.ui.menu = !S.ui.menu; return render();
      case 'pause': case 'resume': case 'skip': return send({ t: act });
      case 'end': if (v.phase === 'decide' || confirm('Oyun bitirilsin mi?')) send({ t: 'end' }); else render(); return;
      case 'reset': return send({ t: 'reset' });
      case 'roll': wakeLock(); return send({ t: 'roll' });
      case 'dest': S.ui.sel = val; return render();
      case 'confirm-move': return send({ t: 'vote', kind: 'move', value: S.ui.sel });
      case 'cat': S.ui.sel = +val; return render();
      case 'confirm-cat': return send({ t: 'vote', kind: 'category', value: S.ui.sel });
      case 'opt': S.ui.sel = +val; return render();
      case 'answer': return send({ t: 'vote', kind: 'question', value: S.ui.sel, qid: v.question.id });
      case 'hideq': S.ui.hideq = true; return render();
      case 'showq': S.ui.hideq = false; return render();
    }
  });
  $app.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.target.id === 'code' || e.target.id === 'name')) {
      var btn = document.querySelector(params.get('oda') || e.target.id === 'code' ? '[data-act=join]' : '[data-act=create]');
      if (btn) btn.click();
    }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.view) { send({ t: 'hb' }); wakeLock(); } });

  /* ================= Başlangıç ================= */
  (function boot() {
    var code = (params.get('oda') || '').toUpperCase();
    var saved = code && ls('bc_host_' + code);
    if (saved) {
      try { var st = JSON.parse(saved); if (st.host === pid) return resumeHost(code, st, params.get('s') != null ? +params.get('s') : null); } catch (e) {}
    }
    var name = ls('bc_name');
    if (code && name && ls('bc_last') === code) return joinRoom(code, name);
    renderHome();
  })();
})();
