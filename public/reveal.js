// Cinematic intro overlay + scroll-reveal for landing sections. Respects reduced motion.
(function () {
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var intro = document.getElementById('intro');
  if (intro && !reduced) {
    setTimeout(function () {
      intro.classList.add('hide');
      setTimeout(function () { intro.remove(); }, 700);
    }, 1150);
  } else if (intro) {
    intro.remove();
  }

  var reveals = document.querySelectorAll('[data-reveal]');
  if (reduced || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.15 });
  reveals.forEach(function (el) { io.observe(el); });
})();
