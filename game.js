/* Bilgi Çemberi — oyun motoru (sadece mantık, arayüz yok).
   Oyunu kuran kişinin telefonu "sunucu" görevi görür: tüm hamleler buradan geçer. */
(function (root) {
  'use strict';

  var CAT_COUNT = 6;
  var RING = 42;            // dış halka: 6 kavşak + 36 ara kare
  var SPOKE = 5;            // her koldaki kare
  var HUB = 'hub';
  var SIDE_COLORS = [
    { name: 'Kırmızı', color: '#ff4d4f' }, { name: 'Mavi', color: '#2f7bff' },
    { name: 'Sarı', color: '#ffd23f' }, { name: 'Yeşil', color: '#22c55e' },
    { name: 'Mor', color: '#9b5cff' }, { name: 'Turuncu', color: '#ff7a1a' },
    { name: 'Pembe', color: '#ff5fb5' }, { name: 'Turkuaz', color: '#14d4d4' },
    { name: 'Beyaz', color: '#f4f1ff' }, { name: 'Kahve', color: '#a8714a' }
  ];
  var MIN_PLAYERS = 3, MAX_PLAYERS = 10;
  var TIMERS = [20, 30, 45, 60, 90, 120];
  var DIFF_WEIGHTS = [0.2, 0.4, 0.4];          // Normal, Zor, Çok Zor
  var BOT_SKILL = { easy: 0.4, mid: 0.65, hard: 0.85 };
  var RESULT_MS = 3500;
  var ONLINE_MS = 25000;

  /* ---------------- Tahta ---------------- */
  function buildBoard() {
    var nodes = {}, adj = {};
    function add(id, n) { nodes[id] = n; adj[id] = []; }
    function link(a, b) { adj[a].push(b); adj[b].push(a); }
    var C = 500, R = 438;
    // Her iki kavşak arasındaki 6 karede 6 rengin her biri bir kez bulunur
    var ringPattern = [0, 2, 4, 1, 5, 3, 0];
    for (var i = 0; i < RING; i++) {
      var a = (i / RING) * Math.PI * 2 - Math.PI / 2;
      var s = Math.floor(i / 7), o = i % 7;
      add('r' + i, {
        type: o === 0 ? 'junction' : 'cat', cat: (s + ringPattern[o]) % CAT_COUNT,
        x: C + R * Math.cos(a), y: C + R * Math.sin(a)
      });
    }
    for (i = 0; i < RING; i++) link('r' + i, 'r' + ((i + 1) % RING));
    add(HUB, { type: 'hub', x: C, y: C });
    for (s = 0; s < CAT_COUNT; s++) {
      var ang = (s * 7 / RING) * Math.PI * 2 - Math.PI / 2;
      var prev = 'r' + (s * 7);
      for (var j = 1; j <= SPOKE; j++) {
        var rad = R - j * 61, id = 's' + s + '_' + j;
        add(id, { type: 'cat', cat: (s + j) % CAT_COUNT, x: C + rad * Math.cos(ang), y: C + rad * Math.sin(ang) });
        link(prev, id); prev = id;
      }
      link(prev, HUB);
    }
    return { nodes: nodes, adj: adj };
  }
  var BOARD = buildBoard();

  // Tam n adımda ulaşılan kareler (bir atışta geri dönmek / aynı kareye iki kez basmak yok)
  function reachable(start, n) {
    var out = {}, seen = {}; seen[start] = true;
    (function walk(node, left) {
      if (left === 0) { out[node] = true; return; }
      BOARD.adj[node].forEach(function (nb) {
        if (seen[nb]) return;
        seen[nb] = true; walk(nb, left - 1); delete seen[nb];
      });
    })(start, n);
    return Object.keys(out);
  }

  /* ---------------- Soru havuzu ---------------- */
  function catAvail(st, data, cat) {
    var id = data.categories[cat].id;
    return data.questions.some(function (q) { return q.cat === id && !st._used[q.id]; });
  }
  function availCats(st, data) {
    var out = []; for (var c = 0; c < CAT_COUNT; c++) if (catAvail(st, data, c)) out.push(c);
    return out;
  }
  function nodeOk(st, data, id, avail) {
    var n = BOARD.nodes[id];
    return n.type === 'hub' ? avail.length > 0 : avail.indexOf(n.cat) >= 0;
  }
  function pickQuestion(st, data, cat, rng) {
    var id = data.categories[cat].id;
    var pool = data.questions.filter(function (q) { return q.cat === id && !st._used[q.id]; });
    if (!pool.length) return null;
    // önce zorluk seçilir (%20/%40/%40), o zorluk bittiyse kategorinin kalanından çekilir
    var r = rng(), d = r < DIFF_WEIGHTS[0] ? 0 : r < DIFF_WEIGHTS[0] + DIFF_WEIGHTS[1] ? 1 : 2;
    var byD = pool.filter(function (q) { return q.d === d; });
    var from = byD.length ? byD : pool;
    var q = from[Math.floor(rng() * from.length)];
    st._used[q.id] = true;           // ekrana geldiği an kullanılmış sayılır
    return q;
  }

  /* ---------------- Durum ---------------- */
  function newState(code, hostPid) {
    return {
      v: 0, code: code, host: hostPid,
      phase: 'lobby', paused: false,
      settings: { mode: 'solo', timer: 60, teamCount: 2, botSkill: 'mid' },
      players: {},          // pid -> {name, team, seen, bot}
      sides: [],            // {id, name, color, members, pos, wedges[6], done, rank}
      turn: 0, roll: null, dests: [], blocked: [], votes: {},
      question: null, result: null, ranking: [], winner: null, overReason: null,
      log: [],
      _used: {}, _endsAt: 0, _remain: 0, _resultUntil: 0, _botAt: 0, _botKey: '', _continue: false
    };
  }

  function rnd(rng, n) { return Math.floor(rng() * n); }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) { var j = rnd(rng, i + 1), t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  function log(st, msg) { st.log.unshift(msg); if (st.log.length > 30) st.log.length = 30; }
  function activeSide(st) { return st.sides[st.turn]; }
  function sideOf(st, pid) { return st.sides.filter(function (s) { return s.members.indexOf(pid) >= 0; })[0]; }
  function isOnline(st, pid, now) { var p = st.players[pid]; return p && (p.bot || now - p.seen < ONLINE_MS); }
  function teamName(i) { return SIDE_COLORS[i].name + ' Takım'; }

  // Karar verecek kişiler: takımın çevrimiçi insanları; hiç insan yoksa botlar
  function voters(st, side, now) {
    var humans = side.members.filter(function (p) { return !st.players[p].bot && isOnline(st, p, now); });
    if (humans.length) return humans;
    var bots = side.members.filter(function (p) { return st.players[p].bot; });
    return bots.length ? bots : side.members.slice();
  }
  // Bireyselde ilk geçerli seçim kilitlenir; takımda karar verenlerin hepsi aynı şeyi seçmeli
  function consensus(st, now) {
    var vs = voters(st, activeSide(st), now);
    var first = st.votes[vs[0]];
    if (first === undefined) return undefined;
    for (var i = 1; i < vs.length; i++) if (st.votes[vs[i]] !== first) return undefined;
    return first;
  }

  function startGame(st, now, rng) {
    var pids = Object.keys(st.players);
    if (pids.length < MIN_PLAYERS) return 'En az ' + MIN_PLAYERS + ' oyuncu gerekli (bot da ekleyebilirsin)';
    if (pids.length > MAX_PLAYERS) return 'En fazla ' + MAX_PLAYERS + ' oyuncu olabilir';
    var sides = [];
    if (st.settings.mode === 'team') {
      var n = st.settings.teamCount, counts = [];
      for (var t = 0; t < n; t++) counts.push(0);
      pids.forEach(function (p) { if (st.players[p].team != null && st.players[p].team < n) counts[st.players[p].team]++; else st.players[p].team = null; });
      shuffle(pids.slice(), rng).forEach(function (p) {
        if (st.players[p].team == null) { var m = counts.indexOf(Math.min.apply(null, counts)); st.players[p].team = m; counts[m]++; }
      });
      for (t = 0; t < n; t++) {
        var mem = pids.filter(function (p) { return st.players[p].team === t; });
        if (mem.length) sides.push({ id: 't' + t, name: teamName(t), color: SIDE_COLORS[t].color, members: mem });
      }
      if (sides.length < 2) return 'Takım oyunu için en az iki dolu takım gerekli';
    } else {
      pids.forEach(function (p, i) { sides.push({ id: p, name: st.players[p].name, color: SIDE_COLORS[i].color, members: [p] }); });
    }
    sides.forEach(function (s) { s.pos = HUB; s.wedges = [false, false, false, false, false, false]; s.done = false; s.rank = 0; });
    // ilk oyuncu rastgele, sonra sabit döngü
    var first = rnd(rng, sides.length);
    st.sides = sides.slice(first).concat(sides.slice(0, first));
    st.turn = 0; st.ranking = []; st.winner = null; st.overReason = null; st._continue = false;
    st._used = {}; st.question = null; st.result = null; st.log = [];
    log(st, 'Oyun başladı! İlk sıra: ' + st.sides[0].name);
    beginTurn(st, null, now, rng);
    return null;
  }

  function clearStep(st) { st.roll = null; st.dests = []; st.blocked = []; st.votes = {}; st.question = null; st.result = null; }

  // Sıra başı: altı rengi tamam olan yeni zar atmadan final sorusu alır
  function beginTurn(st, data, now, rng) {
    clearStep(st);
    var side = activeSide(st);
    if (data && side.wedges.every(Boolean)) return askFinal(st, data, now, rng);
    st.phase = 'roll';
  }

  function nextTurn(st, data, now, rng) {
    var n = st.sides.length;
    for (var k = 1; k <= n; k++) {
      var i = (st.turn + k) % n;
      if (!st.sides[i].done) { st.turn = i; log(st, 'Sıra: ' + st.sides[i].name); return beginTurn(st, data, now, rng); }
    }
    finish(st, 'Herkes finali tamamladı');
  }

  function finish(st, reason) {
    st.phase = 'over'; st.overReason = reason || null; st.paused = false; st.question = null;
    // sıralama: finali bitirenler bitiriş sırasına göre, kalanlar renk sayısına göre
    var rest = st.sides.filter(function (s) { return !s.done; })
      .sort(function (a, b) { return b.wedges.filter(Boolean).length - a.wedges.filter(Boolean).length; });
    st.ranking = st.sides.filter(function (s) { return s.done; }).sort(function (a, b) { return a.rank - b.rank; })
      .concat(rest).map(function (s) { return s.id; });
  }

  function ask(st, data, cat, final, now, rng) {
    var q = pickQuestion(st, data, cat, rng);
    if (!q) return false;
    st.question = { id: q.id, cat: cat, d: q.d, text: q.q, options: q.o.slice(), final: !!final, timer: st.settings.timer, _correct: q.a };
    st.votes = {};
    st.phase = 'question';
    st._endsAt = st.settings.timer ? now + st.settings.timer * 1000 : 0;
    return true;
  }

  function askFinal(st, data, now, rng) {
    var avail = availCats(st, data);
    if (!avail.length) return finish(st, 'Soru havuzu bitti, maç mevcut sıralamayla kapandı');
    log(st, activeSide(st).name + ' final sorusunda!');
    ask(st, data, avail[rnd(rng, avail.length)], true, now, rng);
  }

  function doRoll(st, data, now, rng) {
    var side = activeSide(st), avail = availCats(st, data);
    if (!avail.length) return finish(st, 'Soru havuzu bitti, maç mevcut sıralamayla kapandı');
    // hiçbir zarla soru alınabilecek kareye gidilemiyorsa sıra ilerler
    var any = false;
    for (var n = 1; n <= 6 && !any; n++) any = reachable(side.pos, n).some(function (id) { return nodeOk(st, data, id, avail); });
    if (!any) { log(st, side.name + ' için geçerli hedef yok, sıra geçiyor'); return nextTurn(st, data, now, rng); }
    st.roll = 1 + rnd(rng, 6);
    var all = reachable(side.pos, st.roll);
    st.dests = all.filter(function (id) { return nodeOk(st, data, id, avail); });
    st.blocked = all.filter(function (id) { return st.dests.indexOf(id) < 0; });
    st.votes = {};
    if (!st.dests.length) {
      log(st, side.name + ' ' + st.roll + ' attı ama ulaşılan renklerde soru kalmadı, tekrar zar');
      st.phase = 'roll'; st.roll = null; st.blocked = [];
      return;
    }
    st.phase = 'move';
    log(st, side.name + ' ' + st.roll + ' attı');
  }

  function land(st, data, now, rng) {
    var side = activeSide(st), node = BOARD.nodes[side.pos];
    if (node.type === 'hub') { st.phase = 'category'; st.votes = {}; return; }
    ask(st, data, node.cat, false, now, rng);
  }

  function resolve(st, chosen, now) {
    var q = st.question, side = activeSide(st);
    var correct = chosen === q._correct;
    var res = { correct: correct, chosen: chosen, answer: q._correct, wedge: false, timeout: chosen == null };
    if (correct && !q.final && !side.wedges[q.cat]) { side.wedges[q.cat] = true; res.wedge = true; }
    st.result = res; st.phase = 'result';
    st._resultUntil = now + RESULT_MS;
    log(st, side.name + ': ' + (res.timeout ? 'süre doldu' : correct ? 'doğru!' : 'yanlış') + (res.wedge ? ' — rengi kazandı' : ''));
  }

  function afterResult(st, data, now, rng) {
    var side = activeSide(st), r = st.result, q = st.question;
    if (q.final) {
      if (!r.correct) return nextTurn(st, data, now, rng);   // renkler korunur, sırası gelince yeni final
      side.done = true; side.rank = st.ranking.length + 1; st.ranking.push(side.id);
      if (side.rank === 1) {
        st.winner = side.id;
        log(st, '🏆 ' + side.name + ' maçı kazandı!');
        var left = st.sides.filter(function (s) { return !s.done; }).length;
        if (left === 0) return finish(st);
        clearStep(st); st.phase = 'decide';                    // kurucu: bitir ya da sıralama için devam
        return;
      }
      log(st, side.name + ' finali ' + side.rank + '. sırada tamamladı');
      return nextTurn(st, data, now, rng);
    }
    if (!r.correct) return nextTurn(st, data, now, rng);
    // doğru: altı renk tamamsa aynı turda zar atmadan final, değilse tekrar zar
    if (side.wedges.every(Boolean)) { clearStep(st); return askFinal(st, data, now, rng); }
    clearStep(st); st.phase = 'roll';
  }

  /* ---------------- Hamle işleme ---------------- */
  // ctx: {now, rng, data}. Hata mesajı (string) ya da null döner.
  function apply(st, a, ctx) {
    var now = ctx.now, rng = ctx.rng, data = ctx.data;
    var pid = a.pid, isHost = pid === st.host;
    if (pid && st.players[pid]) st.players[pid].seen = now;

    if (a.t === 'hb') return null;
    if (a.t === 'join') {
      var name = String(a.name || '').trim().slice(0, 20);
      if (!name) return 'İsim gerekli';
      var p = st.players[pid];
      if (p) { p.name = name; if (st.settings.mode === 'solo') { var sd = sideOf(st, pid); if (sd) sd.name = name; } return null; }
      if (st.phase === 'lobby' && Object.keys(st.players).length >= MAX_PLAYERS) return 'Oda dolu (en fazla ' + MAX_PLAYERS + ' oyuncu)';
      st.players[pid] = { name: name, team: null, seen: now };
      if (st.phase === 'lobby') log(st, name + ' katıldı');
      else log(st, name + ' izleyici olarak katıldı');
      return null;
    }
    if (a.t === 'team') {
      if (!st.players[pid]) return 'Önce katıl';
      if (st.phase !== 'lobby') {
        if (st.settings.mode !== 'team' || sideOf(st, pid)) return 'Oyun sürerken takım değiştirilemez';
        var side = st.sides.filter(function (s) { return s.id === 't' + a.team; })[0];
        if (!side) return null;
        st.players[pid].team = a.team; side.members.push(pid);
        log(st, st.players[pid].name + ' ' + side.name + '\'a katıldı');
        return null;
      }
      st.players[pid].team = a.team; return null;
    }

    // --- yönetici komutları ---
    var hostCmd = { settings: 1, start: 1, pause: 1, resume: 1, skip: 1, end: 1, reset: 1, kick: 1, addbot: 1, botteam: 1, cont: 1 };
    if (hostCmd[a.t]) {
      if (!isHost) return 'Sadece oyunu kuran yapabilir';
      switch (a.t) {
        case 'settings': {
          if (st.phase !== 'lobby') return 'Ayarlar sadece lobide değişir';
          var s = a.settings || {};
          if (s.mode === 'solo' || s.mode === 'team') st.settings.mode = s.mode;
          if (TIMERS.indexOf(s.timer) >= 0) st.settings.timer = s.timer;
          if (s.teamCount >= 2 && s.teamCount <= 6) st.settings.teamCount = s.teamCount;
          if (BOT_SKILL[s.botSkill]) st.settings.botSkill = s.botSkill;
          return null;
        }
        case 'addbot': {
          if (st.phase !== 'lobby') return 'Bot sadece lobide eklenir';
          if (Object.keys(st.players).length >= MAX_PLAYERS) return 'Oda dolu';
          var k = 1; while (Object.keys(st.players).some(function (q) { return st.players[q].name === 'Bot ' + k; })) k++;
          st.players['bot' + now.toString(36) + k] = { name: 'Bot ' + k, team: null, seen: now, bot: true };
          return null;
        }
        case 'botteam':
          if (st.phase !== 'lobby' || !st.players[a.target] || !st.players[a.target].bot) return null;
          st.players[a.target].team = a.team; return null;
        case 'start':
          if (st.phase !== 'lobby') return 'Oyun zaten başladı';
          return startGame(st, now, rng);
        case 'pause':
          if (st.phase === 'lobby' || st.phase === 'over' || st.paused) return null;
          st.paused = true;
          if (st.phase === 'question' && st._endsAt) st._remain = Math.max(0, st._endsAt - now);
          log(st, 'Oyun duraklatıldı');
          return null;
        case 'resume':
          if (!st.paused) return null;
          st.paused = false;
          if (st.phase === 'question' && st._endsAt) st._endsAt = now + st._remain;
          if (st.phase === 'result') st._resultUntil = now + 1500;
          st._botAt = now + 1200;
          log(st, 'Oyun devam ediyor');
          return null;
        case 'skip':
          if (st.phase === 'lobby' || st.phase === 'over' || st.phase === 'decide') return null;
          log(st, activeSide(st).name + ' sırası geçildi');
          nextTurn(st, data, now, rng); return null;
        case 'cont':
          if (st.phase !== 'decide') return null;
          log(st, 'Sıralama için devam ediliyor');
          nextTurn(st, data, now, rng); return null;
        case 'end':
          if (st.phase === 'lobby') return null;
          finish(st, st.winner ? null : 'Oyun kurucu tarafından bitirildi'); return null;
        case 'reset':
          st.phase = 'lobby'; st.paused = false; st.sides = []; st.winner = null; st.ranking = [];
          clearStep(st); st.log = []; return null;
        case 'kick':
          if (a.target === st.host) return null;
          if (st.phase !== 'lobby') return 'Oyuncu sadece lobide çıkarılabilir';
          delete st.players[a.target]; return null;
      }
    }

    // --- oyun içi hamleler ---
    if (st.phase === 'lobby' || st.phase === 'over' || st.phase === 'decide') return null;
    if (st.paused) return 'Oyun duraklatıldı';
    var act = activeSide(st);
    if (act.members.indexOf(pid) < 0) return 'Sıra sende değil';

    if (a.t === 'roll') {
      if (st.phase !== 'roll') return null;
      doRoll(st, data, now, rng);
      return null;
    }
    if (a.t === 'vote') {
      if (a.kind !== st.phase || { move: 1, category: 1, question: 1 }[st.phase] !== 1) return null;
      if (st.phase === 'question' && a.qid !== undefined && a.qid !== st.question.id) return 'Bu soru artık geçerli değil';
      var val = a.value;
      if (st.phase === 'move' && st.dests.indexOf(val) < 0) return 'Oraya gidilemez';
      if (st.phase === 'category' && availCats(st, data).indexOf(val) < 0) return 'Bu kategoride soru kalmadı';
      if (st.phase === 'question' && !(val >= 0 && val < st.question.options.length)) return null;
      st.votes[pid] = val;
      var agreed = consensus(st, now);
      if (agreed === undefined) return null;
      if (st.phase === 'move') { act.pos = agreed; st.dests = []; st.blocked = []; st.votes = {}; land(st, data, now, rng); }
      else if (st.phase === 'category') ask(st, data, agreed, false, now, rng);
      else resolve(st, agreed, now);
      return null;
    }
    return null;
  }

  /* ---------------- Botlar ---------------- */
  function botMove(st, now, rng, data) {
    if (st.paused || ['roll', 'move', 'category', 'question'].indexOf(st.phase) < 0) return null;
    var side = activeSide(st);
    var bots = voters(st, side, now).filter(function (p) { return st.players[p].bot && st.votes[p] === undefined; });
    if (!bots.length) return null;
    var key = st.phase + '|' + st.turn + '|' + (st.question ? st.question.id : '') + '|' + st.roll;
    if (key !== st._botKey) {
      st._botKey = key;
      var delay = st.phase === 'question' ? 2500 + rng() * 4000 : 900 + rng() * 900;
      if (st.phase === 'question' && st.settings.timer) delay = Math.min(delay, st.settings.timer * 700);
      st._botAt = now + delay;
    }
    if (now < st._botAt) return null;
    var pid = bots[0], missing = function (c) { return !side.wedges[c]; };
    if (st.phase === 'roll') return { pid: pid, t: 'roll' };
    // takımdaki diğer botlar ilk botun kararını izler
    var kind = st.phase;
    var prior = voters(st, side, now).map(function (p) { return st.votes[p]; }).filter(function (x) { return x !== undefined; })[0];
    if (prior !== undefined) return { pid: pid, t: 'vote', kind: kind, value: prior, qid: st.question ? st.question.id : undefined };
    if (st.phase === 'move') {
      var pick = st.dests.filter(function (d) { var n = BOARD.nodes[d]; return n.type !== 'hub' && missing(n.cat); });
      if (!pick.length) pick = st.dests.filter(function (d) { return BOARD.nodes[d].type === 'hub'; });
      if (!pick.length) pick = st.dests;
      return { pid: pid, t: 'vote', kind: 'move', value: pick[rnd(rng, pick.length)] };
    }
    if (st.phase === 'category') {
      var av = availCats(st, data), m = av.filter(missing);
      var from = m.length ? m : av;
      return { pid: pid, t: 'vote', kind: 'category', value: from[rnd(rng, from.length)] };
    }
    var q = st.question, ok = rng() < BOT_SKILL[st.settings.botSkill];
    var ans = ok ? q._correct : (q._correct + 1 + rnd(rng, q.options.length - 1)) % q.options.length;
    return { pid: pid, t: 'vote', kind: 'question', value: ans, qid: q.id };
  }

  // Zamanlayıcılar: süre dolumu, sonuçtan sonraki adım, bot hamleleri. Değişiklik olduysa true.
  function tick(st, now, rng, data) {
    if (st.paused) return false;
    if (st.phase === 'question' && st._endsAt && now >= st._endsAt) {
      resolve(st, null, now); return true;
    }
    if (st.phase === 'result' && now >= st._resultUntil) { afterResult(st, data, now, rng); return true; }
    var b = botMove(st, now, rng, data);
    if (b) { apply(st, b, { now: now, rng: rng, data: data }); return true; }
    return false;
  }

  // Herkese gönderilecek görünüm: gizli alanlar çıkarılır, kalan süre eklenir
  function publicView(st, now, data) {
    var v = JSON.parse(JSON.stringify(st, function (k, val) { return k.charAt(0) === '_' ? undefined : val; }));
    if (st.question) {
      if (st.phase === 'result') v.question.correct = st.question._correct;
      if (st._endsAt) v.question.left = st.paused ? st._remain : Math.max(0, st._endsAt - now);
    }
    if (st.phase === 'result') v.result.left = Math.max(0, st._resultUntil - now);
    v.online = {};
    Object.keys(st.players).forEach(function (p) { v.online[p] = isOnline(st, p, now); });
    if (data) {
      v.avail = availCats(st, data);
      v.usedCount = Object.keys(st._used).length;
    }
    return v;
  }

  root.Game = {
    BOARD: BOARD, HUB: HUB, CAT_COUNT: CAT_COUNT, SIDE_COLORS: SIDE_COLORS, TIMERS: TIMERS, BOT_SKILL: BOT_SKILL,
    MIN_PLAYERS: MIN_PLAYERS, MAX_PLAYERS: MAX_PLAYERS, teamName: teamName,
    reachable: reachable, newState: newState, apply: apply, tick: tick, publicView: publicView,
    activeSide: activeSide, sideOf: sideOf
  };
})(typeof module !== 'undefined' ? module.exports : window);
