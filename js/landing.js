/* Landing page glue: public request tracking (no sign-in). Shows ONLY the status and timeline the server returns for the code entered. */
(function () {
  var form = document.getElementById('track-form'), out = document.getElementById('track-result'), btn = document.getElementById('track-btn'), input = document.getElementById('code');
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmtDt = function (iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  var fmtD = function (ymd) { var d = new Date(ymd + 'T00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); };
  var STEPS = [['submitted', 'Submitted'], ['processing', 'Processing'], ['ready', 'Ready for Release'], ['completed', 'Completed']];

  function show(html) { out.innerHTML = html; out.hidden = false; }
  function message(kind, text) { show('<div class="tr-card tr-msg ' + kind + '" role="' + (kind === 'err' ? 'alert' : 'status') + '">' + esc(text) + '</div>'); }

  function render(d) {
    var reached = {}; d.timeline.forEach(function (t) { reached[t.event] = 1; });
    var rejected = d.status === 'rejected';
    var steps = STEPS.map(function (s) { return [s[0], s[1], !!reached[s[0]]]; });
    if (rejected) steps = steps.filter(function (s) { return s[2]; }).concat([['rejected', 'Rejected', true]]);
    var bar = '<ol class="tr-steps">' + steps.map(function (s, i) { return '<li class="' + (s[2] ? 'on' : '') + (s[0] === 'rejected' ? ' rej' : '') + '"><i></i><span>' + esc(s[1]) + '</span></li>'; }).join('') + '</ol>';
    var rows = d.timeline.slice().reverse().map(function (t, i) {
      var head = t.event === 'rejected' && t.note ? 'Rejected: ' + t.note : t.label, sub = '';
      if (t.event === 'info' && t.note) sub = t.note;
      if (t.event === 'ready' && t.claimDate) sub = 'Claim date: ' + fmtD(t.claimDate);
      return '<li class="' + (i === 0 ? 'cur ' : '') + 'ev-' + esc(t.event) + '"><time>' + esc(fmtDt(t.at)) + '</time><div><b>' + esc(head) + '</b>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div></li>';
    }).join('');
    show('<div class="tr-card"><div class="tr-head"><div><small>Tracking code</small><h3>' + esc(d.trackingNo) + '</h3></div><span class="tr-pill s-' + esc(d.status) + '">' + esc(d.statusLabel) + '</span></div>' +
      '<p class="tr-upd">Last updated ' + esc(fmtDt(d.updatedAt)) + '</p>' + bar + '<ul class="tr-list">' + rows + '</ul></div>');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var code = input.value.trim();
    if (!code) { input.focus(); return; }
    if (window.BD_CONFIG.USE_MOCK) { message('err', 'Public tracking needs the BarangayDocs server (demo mode has no request data).'); return; }
    btn.disabled = true; btn.textContent = 'Searching…'; message('info', 'Looking up your request…');
    fetch(window.BD_CONFIG.API_BASE + '/public/track/' + encodeURIComponent(code), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (r) {
        if (r.ok) render(r.j);
        else message('err', r.status === 404 || r.status === 429 ? (r.j.message || 'We couldn’t find a request with that tracking code.') : 'Something went wrong. Please try again.');
      })
      .catch(function () { message('err', 'Can’t reach the server. Check your connection and try again.'); })
      .then(function () { btn.disabled = false; btn.textContent = 'Track Now'; });
  });
})();
