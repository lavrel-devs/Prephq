// Legal pages (v1.8.2) — the details below are the ONLY things to edit to personalise every policy page at once.
// Anything left empty is hidden or replaced with a sensible fallback.
window.PHQ_LEGAL = {
  operator: 'PrepHQ',          // the name of the business/person that runs PrepHQ (e.g. your registered business name)
  contactEmail: '',            // e.g. 'support@yourdomain.com' — shown for privacy and data requests
  address: '',                 // optional postal address in Nigeria
  whatsapp: '',                // optional support WhatsApp number in international format, e.g. '2348012345678'
  dpoName: '',                 // optional: name/title of your data protection contact
};
(function () {
  var c = window.PHQ_LEGAL, a = function (href, text) { return '<a href="' + href + '">' + text + '</a>'; };
  var contact = [];
  if (c.contactEmail) contact.push(a('mailto:' + c.contactEmail, c.contactEmail));
  if (c.whatsapp) contact.push(a('https://wa.me/' + String(c.whatsapp).replace(/\D/g, ''), 'WhatsApp support'));
  contact.push('the Support option inside the app');
  document.querySelectorAll('[data-legal]').forEach(function (el) {
    var k = el.getAttribute('data-legal');
    if (k === 'operator') el.textContent = c.operator || 'PrepHQ';
    else if (k === 'contact') el.innerHTML = contact.join(', ').replace(/, ([^,]*)$/, ' or $1');
    else if (k === 'address') { if (c.address) el.textContent = c.address; else if (el.hasAttribute('data-hide-empty')) el.style.display = 'none'; }
    else if (k === 'dpo') el.textContent = c.dpoName || 'our data protection contact';
  });
  // highlight the current page in the top nav
  document.querySelectorAll('.lg-nav a').forEach(function (l) { if (l.getAttribute('href') === location.pathname) l.classList.add('on'); });
})();
