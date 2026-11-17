// Wreddi accessibility layer (v1.12.1)
// Progressive enhancement that works for markup in the HTML AND markup injected later (views, innerHTML lists):
//  - clickable <div>/<span>/<li> with an onclick get role="button", tabindex="0" and Enter/Space activation
//  - sheets / modals get role="dialog" aria-modal; Escape closes the topmost one; focus moves in and returns
//  - .toggle / .v-toggle switches mirror their ".on" class into aria-checked
//  - inputs with only a placeholder get an aria-label
//  - every .scr gets role="main" (only one is visible at a time) and a hidden <h1> tracks the current screen
(function () {
  'use strict';
  var NATIVE = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|LABEL|OPTION)$/;
  var lastFocus = null;

  function enhance(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[onclick]').forEach(function (el) {
      if (NATIVE.test(el.tagName) || el.hasAttribute('role') || el.hasAttribute('tabindex')) return;
      if (el.classList.contains('sheet-bg') || el.classList.contains('modal-bg')) return; // backdrops: not tab stops
      if (el.hasAttribute('data-no-a11y')) return;
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
    });
    root.querySelectorAll('.sheet, .modal-bg .modal').forEach(function (el) {
      if (!el.hasAttribute('role')) { el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); }
      var t = el.querySelector('.sheet-title, h2, h3, .modal-title');
      if (t && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', t.textContent.trim().slice(0, 80));
    });
    root.querySelectorAll('.toggle, .v-toggle').forEach(function (el) {
      if (el.tagName === 'BUTTON' && !el.hasAttribute('role')) el.setAttribute('role', 'switch');
      el.setAttribute('aria-checked', el.classList.contains('on') ? 'true' : 'false');
    });
    root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select').forEach(function (el) {
      if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || el.hasAttribute('title')) return;
      if (el.id && root.querySelector('label[for="' + el.id.replace(/"/g, '') + '"]')) return;
      if (el.closest('label')) return;
      var name = el.getAttribute('placeholder');
      if (name) el.setAttribute('aria-label', name);
    });
    root.querySelectorAll('.scr').forEach(function (el) { if (!el.hasAttribute('role')) el.setAttribute('role', 'main'); });
  }

  function topOpen() {
    var open = document.querySelectorAll('.sheet-bg.on, .sheet-bg.open, .sheet-bg.show, .modal-bg.on, .modal-bg.open, .modal-bg.show');
    return open.length ? open[open.length - 1] : null;
  }

  document.addEventListener('keydown', function (e) {
    var el = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && el && el.getAttribute && el.getAttribute('role') === 'button' && !NATIVE.test(el.tagName)) {
      e.preventDefault();
      el.click();
      return;
    }
    if (e.key === 'Escape') {
      var layer = topOpen();
      if (layer) {
        // click the backdrop itself (not a child) so each page's existing close handler runs
        layer.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    }
  });

  // keep aria-checked in sync when a toggle's class changes, and enhance injected markup
  var mo = new MutationObserver(function (list) {
    list.forEach(function (m) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        var t = m.target;
        if (t.classList && (t.classList.contains('toggle') || t.classList.contains('v-toggle'))) {
          t.setAttribute('aria-checked', t.classList.contains('on') ? 'true' : 'false');
        }
        if (t.classList && /(^| )(sheet-bg|modal-bg)( |$)/.test(t.className)) {
          var isOpen = /(^| )(on|open|show)( |$)/.test(t.className);
          if (isOpen) { lastFocus = document.activeElement; var f = t.querySelector('input, button, [tabindex="0"]'); if (f) setTimeout(function () { try { f.focus({ preventScroll: true }); } catch (e) {} }, 60); }
          else if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} lastFocus = null; }
        }
      }
      m.addedNodes && m.addedNodes.forEach(function (n) { if (n.nodeType === 1) { enhance(n.parentNode || n); } });
    });
  });

  function start() {
    enhance(document);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
