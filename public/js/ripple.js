// Material-style touch ripple — v1.10
// A single delegated listener; no per-element setup. It only runs on the controls listed in TARGETS,
// stays off in low-power mode and for people who asked for reduced motion.
(function () {
  'use strict';
  var TARGETS = '.btn-grad,.btn-surf,.qbtn,.qp,.fb,.mode-btn,.cc,.opt,.menu-item,.tab,.neu-select-option';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  document.addEventListener('pointerdown', function (e) {
    if (document.documentElement.hasAttribute('data-lowpower')) return;
    if (e.button > 0) return;
    var el = e.target.closest && e.target.closest(TARGETS);
    if (!el || el.disabled || el.hasAttribute('data-no-ripple')) return;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var size = Math.max(r.width, r.height) * 2.2;
    var dot = document.createElement('span');
    dot.className = 'rpl';
    dot.style.width = dot.style.height = size + 'px';
    dot.style.left = (e.clientX - r.left - size / 2) + 'px';
    dot.style.top = (e.clientY - r.top - size / 2) + 'px';
    var addedHost = !el.classList.contains('rpl-host');
    if (addedHost) el.classList.add('rpl-host');
    el.appendChild(dot);
    var done = function () { if (dot.parentNode) dot.parentNode.removeChild(dot); if (addedHost && !el.querySelector('.rpl')) el.classList.remove('rpl-host'); };
    dot.addEventListener('animationend', done);
    setTimeout(done, 800);
  }, { passive: true });
})();
