/* Pegasusbound website tracking. Records page views for the workspace whose site
 * key the script tag carries, sends nothing before consent when the
 * workspace requires it, and honours Global Privacy Control / Do Not Track.
 * API: pegasusbound('consent','granted'|'denied'), pegasusbound('page'), pegasusbound('reset'). */
(function () {
  if (window.__wbly) return;
  window.__wbly = 1;
  var w = window, d = document, n = navigator;
  var sc = d.currentScript;
  if (!sc) {
    var all = d.getElementsByTagName('script');
    for (var i = all.length - 1; i >= 0; i--) {
      if (all[i].getAttribute('data-site')) { sc = all[i]; break; }
    }
  }
  if (!sc) return;
  var key = sc.getAttribute('data-site');
  if (!key) return;
  var mode = sc.getAttribute('data-consent') === 'implicit' ? 'implicit' : 'explicit';
  var base = sc.getAttribute('data-endpoint') || String(sc.src).replace(/\/tracking\.js.*$/, '');
  var endpoint = base + '/p';
  var VID = 'wbly_vid', SID = 'wbly_sid', SAT = 'wbly_sat', CON = 'wbly_consent', TOK = 'wbly_t';

  function rnd() {
    var a = new Uint8Array(16);
    if (w.crypto && w.crypto.getRandomValues) { w.crypto.getRandomValues(a); }
    else { for (var i = 0; i < 16; i++) a[i] = (Math.random() * 256) | 0; }
    var s = '';
    for (var j = 0; j < 16; j++) s += ('0' + a[j].toString(16)).slice(-2);
    return s;
  }
  function get(k) { try { return w.localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { w.localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { w.localStorage.removeItem(k); } catch (e) {} }
  function sget(k) { try { return w.sessionStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { w.sessionStorage.setItem(k, v); } catch (e) {} }
  function sdel(k) { try { w.sessionStorage.removeItem(k); } catch (e) {} }

  function optedOut() {
    return n.globalPrivacyControl === true || n.doNotTrack === '1' || w.doNotTrack === '1';
  }
  function consent() {
    if (optedOut()) return null;
    var c = get(CON);
    if (c === 'granted') return 'granted';
    if (c === 'denied') return null;
    return mode === 'implicit' ? 'implicit' : null;
  }

  /* The click redirect appends the identification ticket; take it off the
   * address bar right away so it is never bookmarked or shared. */
  var token = '';
  try {
    var u = new URL(w.location.href);
    var t = u.searchParams.get(TOK);
    if (t) {
      token = t;
      u.searchParams.delete(TOK);
      w.history.replaceState(w.history.state, '', u.toString());
    }
  } catch (e) {}

  var landing = false, lastUrl = '', lastAt = 0;
  function session() {
    var now = Date.now();
    var sid = sget(SID), at = +sget(SAT) || 0;
    if (!sid || now - at > 30 * 60 * 1000) { sid = rnd(); landing = true; }
    sset(SID, sid);
    sset(SAT, String(now));
    return sid;
  }
  function tz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  }

  function send() {
    var c = consent();
    if (!c) return;
    var url = w.location.href, now = Date.now();
    if (url === lastUrl && now - lastAt < 1000) return;
    lastUrl = url; lastAt = now;
    var vid = get(VID);
    if (!vid) { vid = rnd(); set(VID, vid); }
    var sid = session();
    var body = {
      k: key, v: vid, s: sid, c: c, t: token, u: url,
      ti: d.title || '', r: d.referrer || '', l: n.language || '', tz: tz(),
      sw: (w.screen && w.screen.width) || 0, sh: (w.screen && w.screen.height) || 0, ld: landing
    };
    landing = false; token = '';
    try {
      /* text/plain keeps this a simple request: no preflight on every view. */
      fetch(endpoint, {
        method: 'POST', keepalive: true, credentials: 'omit',
        headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body)
      }).then(function (r) { return r.status === 200 ? r.json() : null; })
        .then(function (j) { if (j && j.vid) set(VID, j.vid); })
        .catch(function () {});
    } catch (e) {}
  }

  /* Single-page apps: a pushed history entry is a page view. */
  var push = w.history.pushState;
  if (push) {
    w.history.pushState = function () {
      push.apply(this, arguments);
      setTimeout(send, 0);
    };
  }
  w.addEventListener('popstate', function () { setTimeout(send, 0); });

  var queued = (w.pegasusbound && w.pegasusbound.q) || [];
  function api(cmd, arg) {
    if (cmd === 'consent') {
      if (arg === 'granted') { set(CON, 'granted'); send(); }
      else if (arg === 'denied') { set(CON, 'denied'); del(VID); sdel(SID); sdel(SAT); }
    } else if (cmd === 'reset') {
      del(VID); sdel(SID); sdel(SAT);
    } else if (cmd === 'page') {
      send();
    }
  }
  w.pegasusbound = function () { api.apply(null, arguments); };
  w.pegasusbound.q = [];
  for (var q = 0; q < queued.length; q++) api.apply(null, queued[q]);
  send();
})();
