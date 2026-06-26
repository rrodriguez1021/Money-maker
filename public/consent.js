// Lightweight cookie/tracking notice. Shown until the visitor acknowledges; the
// choice is stored in localStorage. We only use strictly-necessary local storage,
// so this is a transparency notice rather than a consent gate — but it documents
// disclosure, which helps your compliance posture.
(function () {
  // Capture a referral code from ?ref=… so it can be attributed at signup.
  try {
    var ref = new URLSearchParams(location.search).get('ref');
    if (ref) localStorage.setItem('dynaqr_ref', ref.slice(0, 32));
  } catch (e) { /* ignore */ }

  var KEY = 'dynaqr_notice_ack';
  try { if (localStorage.getItem(KEY)) return; } catch (e) { return; }

  var bar = document.createElement('div');
  bar.id = 'cookie-banner';
  bar.innerHTML =
    '<p>Qrysm stores a sign-in token in your browser and logs QR <strong>scan events</strong> ' +
    '(time, referrer, device) to provide analytics. We don’t use ad trackers. ' +
    'See our <a href="/privacy.html">Privacy Policy</a>.</p>';

  var btn = document.createElement('button');
  btn.className = 'btn btn-primary btn-sm';
  btn.textContent = 'Got it';
  btn.onclick = function () {
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
    bar.classList.add('hidden');
  };
  bar.appendChild(btn);

  function mount() { document.body.appendChild(bar); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
