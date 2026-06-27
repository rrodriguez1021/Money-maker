// Qrysm conversion pixel. Add this once, site-wide:
//   <script src="https://YOUR-QRYSM-HOST/pixel.js"></script>
// Then, on your success/thank-you page, call:  qrysm('conversion')
//
// How it works: a Qrysm QR redirect tags the landing URL with ?qr_ref=…; this
// script remembers it for the session, so a later conversion is credited to the
// exact code (and routing variant) the visitor scanned — no cookies, no IP.
(function () {
  var base = '';
  try {
    var s = document.currentScript;
    if (s && s.src) base = s.src.replace(/\/pixel\.js.*$/, '');
  } catch (e) { /* ignore */ }

  // Capture the attribution token from the URL on arrival.
  try {
    var p = new URLSearchParams(location.search);
    var ref = p.get('qr_ref');
    if (ref) {
      sessionStorage.setItem('qrysm_ref', ref);
      var v = p.get('qr_v');
      if (v) sessionStorage.setItem('qrysm_v', v); else sessionStorage.removeItem('qrysm_v');
    }
  } catch (e) { /* ignore */ }

  window.qrysm = function (event) {
    if (event !== 'conversion') return;
    var ref, v;
    try { ref = sessionStorage.getItem('qrysm_ref'); v = sessionStorage.getItem('qrysm_v'); } catch (e) { return; }
    if (!ref) return; // visitor didn't arrive via a Qrysm code
    var url = base + '/api/convert?ref=' + encodeURIComponent(ref) + (v ? '&v=' + encodeURIComponent(v) : '') + '&t=' + Date.now();
    try { new Image().src = url; } catch (e) { /* ignore */ }
  };
})();
