/*
 * Amiri Building Services – site script (vanilla JS, no dependencies).
 * - Mobile menu
 * - Gentle scroll-reveal animations (off when the visitor prefers reduced motion)
 * - Quote form: sent to the receptionist API (saved, photos stored, emailed to us) when
 *   SITE_CONFIG.enquiryEndpoint is set; otherwise it opens WhatsApp or email
 * Business details come from /assets/js/config.js, generated from site.config.json.
 */
(function () {
  'use strict';

  var CFG = window.SITE_CONFIG || {};

  /* ---------------- Scroll reveal ---------------- */
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var revealEls = document.querySelectorAll('.reveal, .reveal-stagger');
  if (!reduceMotion && 'IntersectionObserver' in window && revealEls.length) {
    document.documentElement.classList.add('js');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    Array.prototype.forEach.call(revealEls, function (el) { io.observe(el); });
  }

  /* ---------------- Mobile contact bar ----------------
     Hidden while the page's own Call / WhatsApp buttons are on screen (top of the page),
     so the two sets of buttons never compete. Shows as soon as they scroll away. */
  var bar = document.querySelector('.mobile-bar');
  var heroActions = document.querySelector('.hero-call, .hero .cta-group');
  if (bar && heroActions && 'IntersectionObserver' in window) {
    bar.classList.add('is-hidden');
    new IntersectionObserver(function (entries) {
      bar.classList.toggle('is-hidden', entries[0].isIntersecting);
    }, { rootMargin: '0px 0px -80px 0px' }).observe(heroActions);
  }

  /* ---------------- Mobile menu ---------------- */
  var header = document.querySelector('.site-header');
  var toggle = document.querySelector('.nav-toggle');
  if (header && toggle) {
    var label = toggle.querySelector('.visually-hidden');
    var setOpen = function (open) {
      header.classList.toggle('nav-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (label) label.textContent = open ? 'Close menu' : 'Open menu';
      var use = toggle.querySelector('use');
      if (use) use.setAttribute('href', use.getAttribute('href').split('#')[0] + '#' + (open ? 'close' : 'menu'));
    };
    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && header.classList.contains('nav-open')) {
        setOpen(false);
        toggle.focus();
      }
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth >= 1100) setOpen(false);
    });
  }

  /* ---------------- Services dropdown ---------------- */
  Array.prototype.forEach.call(document.querySelectorAll('.nav-drop'), function (drop) {
    var btn = drop.querySelector('.nav-drop__btn');
    var setDrop = function (open) {
      drop.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', function () { setDrop(btn.getAttribute('aria-expanded') !== 'true'); });
    document.addEventListener('click', function (e) { if (!drop.contains(e.target)) setDrop(false); });
    drop.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drop.classList.contains('is-open')) { setDrop(false); btn.focus(); }
    });
  });

  /* ---------------- Enquiry form ---------------- */
  var form = document.getElementById('enquiry-form');
  if (!form) return;

  var errorBox = document.getElementById('enquiry-errors');
  var service = form.querySelector('#eq-service');
  var POSTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]?(\s*[0-9][A-Z]{2})?$/i;
  var PHONE = /^(\+44|0044|0)\d{9,10}$/;
  var EMAIL = /^[^\s@<>()",;:]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
  var API = form.hasAttribute('data-api') && CFG.enquiryEndpoint ? CFG.enquiryEndpoint : '';
  var shownAt = Date.now();

  // Pre-select the type of work on service pages (e.g. Plumbing page -> Plumbing).
  var preset = form.getAttribute('data-default-category');
  if (preset) {
    var presetInput = form.querySelector('input[name="category"][value="' + preset + '"]');
    if (presetInput) presetInput.checked = true;
  }

  // Choosing a specific service ticks the matching type of work.
  if (service) {
    service.addEventListener('change', function () {
      var opt = service.options[service.selectedIndex];
      var group = opt && opt.parentNode && opt.parentNode.getAttribute ? opt.parentNode.getAttribute('data-category') : null;
      if (group) {
        var radio = form.querySelector('input[name="category"][value="' + group + '"]');
        if (radio) radio.checked = true;
      }
    });
  }

  function value(name) {
    var el = form.elements[name];
    if (!el) return '';
    if (el.length !== undefined && !el.tagName) {
      for (var i = 0; i < el.length; i++) if (el[i].checked) return el[i].value;
      return '';
    }
    return (el.value || '').trim();
  }

  function clearErrors() {
    errorBox.hidden = true;
    errorBox.innerHTML = '';
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (el) {
      el.removeAttribute('aria-invalid');
    });
    Array.prototype.forEach.call(form.querySelectorAll('.field-error'), function (el) {
      el.parentNode.removeChild(el);
    });
  }

  function validate() {
    clearErrors();
    var errors = [];
    var add = function (id, message, fieldEl) {
      errors.push({ id: id, message: message });
      var target = fieldEl || document.getElementById(id);
      if (target) {
        if ((target.tagName === 'INPUT' && target.type !== 'radio' && target.type !== 'checkbox') || target.tagName === 'TEXTAREA') target.setAttribute('aria-invalid', 'true');
        var p = document.createElement('p');
        p.className = 'field-error';
        p.id = id + '-error';
        p.textContent = message;
        var container = target.closest('.field');
        if (container) container.appendChild(p);
      }
    };

    if (!value('name')) add('eq-name', 'Enter your name');
    var pc = value('postcode');
    if (!pc) add('eq-postcode', 'Enter your postcode');
    else if (!POSTCODE.test(pc)) add('eq-postcode', 'Enter a valid UK postcode, for example UB7 9AA');
    var tel = value('phone').replace(/[\s()\-.]/g, '');
    if (!tel) add('eq-phone', 'Enter your phone number');
    else if (!PHONE.test(tel)) add('eq-phone', 'Enter a valid UK phone number, for example 07700 900123');
    if (!value('category')) {
      var first = form.querySelector('input[name="category"]');
      first.id = first.id || 'eq-category';
      add(first.id, 'Choose the type of work');
    }
    if (!value('urgency')) {
      var firstU = form.querySelector('input[name="urgency"]');
      firstU.id = firstU.id || 'eq-urgency';
      add(firstU.id, 'Choose how urgent the job is');
    }
    if (!value('description')) add('eq-desc', 'Describe the problem in a few words');
    if (API) {
      var mail = value('email');
      if (!mail) add('eq-email', 'Enter your email address');
      else if (!EMAIL.test(mail)) add('eq-email', 'Enter a valid email address, for example name@example.com');
      if (!form.elements.consent.checked) add('eq-consent', 'Tick the box to agree we can use your details to reply');
    }

    if (errors.length) {
      var html = '<p><strong>There ' + (errors.length === 1 ? 'is a problem' : 'are ' + errors.length + ' problems') + ' with the form</strong></p><ul>';
      errors.forEach(function (e) {
        html += '<li><a href="#' + e.id + '">' + e.message + '</a></li>';
      });
      errorBox.innerHTML = html + '</ul>';
      errorBox.hidden = false;
      errorBox.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function (ev) {
          ev.preventDefault();
          var t = document.getElementById(a.getAttribute('href').slice(1));
          if (t) t.focus();
        });
      });
      errorBox.setAttribute('tabindex', '-1');
      errorBox.focus();
      return false;
    }
    return true;
  }

  function buildMessage(viaEmail) {
    var svc = value('category');
    if (value('service')) svc += ' – ' + value('service');
    return [
      'Hello ' + (CFG.tradingName || 'Amiri Building Services') + ',',
      '',
      'Name: ' + value('name'),
      'Phone: ' + value('phone'),
      'Postcode: ' + value('postcode').toUpperCase(),
      'Service: ' + svc,
      'Urgency: ' + value('urgency'),
      'Problem: ' + value('description'),
      '',
      viaEmail ? 'Photos: attached if I have any.' : 'Photos: I will send any photos of the problem in this chat.',
      '',
      'Please contact me regarding this job.'
    ].join('\n');
  }

  function open(url) {
    var w = window.open(url, '_blank');
    if (w) w.opener = null;
    else window.location.href = url;
  }

  function openWhatsApp() {
    open('https://wa.me/' + CFG.whatsappNumber + '?text=' + encodeURIComponent(buildMessage(false)));
  }
  function openEmail() {
    var subject = 'Enquiry: ' + value('category') + ' – ' + value('postcode').toUpperCase();
    window.location.href = 'mailto:' + CFG.email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(buildMessage(true));
  }

  var emailBtn = form.querySelector('[data-send-email]');
  if (emailBtn) {
    emailBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (validate()) openEmail();
    });
  }
  var waLinkEl = form.querySelector('[data-send-wa]');
  if (waLinkEl) {
    waLinkEl.addEventListener('click', function (e) {
      e.preventDefault();
      if (validate()) openWhatsApp();
    });
  }

  if (!API) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (validate()) openWhatsApp();
    });
    return;
  }

  /* ---- Sending to the receptionist API ---- */
  var MAX_FILES = 6;
  var MAX_PHOTO_MB = 25;   // before resizing in the browser
  var MAX_VIDEO_MB = 60;
  var files = [];
  var fileInput = form.querySelector('#eq-files');
  var fileList = form.querySelector('#eq-files-list');
  var fileHint = form.querySelector('#eq-files-hint');
  var fileHintText = fileHint ? fileHint.textContent : '';
  var submitBtn = form.querySelector('[data-submit]');
  var submitLabel = submitBtn.querySelector('span');
  var progress = form.querySelector('.eq-progress');
  var result = form.querySelector('#eq-result');
  var sending = false;
  var sentKey = null;

  function drawFiles() {
    while (fileList.firstChild) fileList.removeChild(fileList.firstChild);
    files.forEach(function (f, i) {
      var li = document.createElement('li');
      if (/^image\//.test(f.type)) {
        var img = document.createElement('img');
        img.alt = f.name;
        img.src = URL.createObjectURL(f);
        img.onload = function () { URL.revokeObjectURL(img.src); };
        li.appendChild(img);
      } else {
        li.textContent = 'Video';
      }
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remove ' + f.name);
      rm.textContent = '×';
      rm.addEventListener('click', function () { files.splice(i, 1); drawFiles(); });
      li.appendChild(rm);
      fileList.appendChild(li);
    });
  }
  if (fileInput) {
    fileInput.addEventListener('change', function () {
      var problems = [];
      Array.prototype.forEach.call(fileInput.files, function (f) {
        if (!/^(image|video)\//.test(f.type) || f.type === 'image/svg+xml') return problems.push(f.name + ' is not a photo or video.');
        var isVideo = /^video\//.test(f.type);
        var max = isVideo ? MAX_VIDEO_MB : MAX_PHOTO_MB;
        if (f.size > max * 1024 * 1024) return problems.push(f.name + ' is over ' + max + ' MB.');
        if (files.length >= MAX_FILES) return problems.push('You can add up to ' + MAX_FILES + ' files.');
        files.push(f);
      });
      fileInput.value = '';
      if (fileHint) {
        fileHint.textContent = problems.length ? problems.join(' ') : fileHintText;
        fileHint.classList.toggle('field-error', problems.length > 0);
      }
      drawFiles();
    });
  }

  // Optional Cloudflare Turnstile spam check (site key in site.config.json, aiChat.turnstileSiteKey).
  var tsKey = CFG.aiChat && CFG.aiChat.turnstileSiteKey;
  var tsBox = form.querySelector('.eq-turnstile');
  if (tsKey && tsBox) {
    tsBox.hidden = false;
    window.absFormTurnstile = function () { window.turnstile.render(tsBox, { sitekey: tsKey, size: 'flexible', appearance: 'interaction-only' }); };
    var ts = document.createElement('script');
    ts.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=absFormTurnstile';
    ts.async = true;
    document.head.appendChild(ts);
  }

  // Emergency chosen: point to the phone straight away, the form is not the fastest route.
  var emergencyNote = null;
  Array.prototype.forEach.call(form.querySelectorAll('input[name="urgency"]'), function (r) {
    r.addEventListener('change', function () {
      var on = urgencyCode() === 'Emergency';
      if (on && !emergencyNote) {
        emergencyNote = document.createElement('p');
        emergencyNote.className = 'eq-emergency';
        emergencyNote.innerHTML = '<strong>Emergency?</strong> For the fastest help, call <a href="tel:' + CFG.phoneTel + '">' + CFG.phoneDisplay + '</a> or WhatsApp us now. If there is fire, smoke, an electric shock or danger to life, call 999. If you smell gas, call 0800 111 999.';
        r.closest('fieldset').appendChild(emergencyNote);
      }
      if (emergencyNote) emergencyNote.hidden = !on;
    });
  });

  function urgencyCode() {
    var u = value('urgency');
    return /^Emergency/.test(u) ? 'Emergency' : /^Urgent/.test(u) ? 'Urgent' : u ? 'Planned' : '';
  }
  var SERVICE_CODE = { 'Electrical': 'Electrical', 'Plumbing (non-gas)': 'Plumbing', 'Property maintenance': 'Property Maintenance' };
  var WHEN = { Emergency: 'As soon as possible', Urgent: 'In the next few days', Planned: "I'm flexible" };

  // Details the back end has no field of its own for go at the top of the description,
  // so they always reach the email whichever version of the back end is running.
  function description() {
    var extra = [];
    if (value('service')) extra.push('Service: ' + value('service'));
    extra.push('Email: ' + value('email'));
    if (value('address')) extra.push('Address: ' + value('address'));
    return extra.join('\n') + '\n\n' + value('description');
  }

  function prepareFiles(list) {
    return Promise.all(list.map(function (f) {
      if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type) || !window.createImageBitmap) return Promise.resolve({ blob: f, name: f.name });
      return createImageBitmap(f).then(function (bmp) {
        var scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
        var c = document.createElement('canvas');
        c.width = Math.round(bmp.width * scale);
        c.height = Math.round(bmp.height * scale);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        return new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.85); });
      }).then(function (blob) {
        if (!blob || blob.size >= f.size) return { blob: f, name: f.name };
        return { blob: blob, name: f.name.replace(/\.[^.]+$/, '') + '.jpg' };
      }, function () { return { blob: f, name: f.name }; });
    }));
  }

  function upload(fd) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', API);
      xhr.timeout = 180000;
      xhr.upload.onprogress = function (e) {
        if (!e.lengthComputable) return;
        var pct = Math.min(99, Math.round(e.loaded / e.total * 100));
        progress.firstElementChild.style.width = pct + '%';
        progress.setAttribute('aria-valuenow', String(pct));
        if (files.length) submitLabel.textContent = 'Sending… ' + pct + '%';
      };
      xhr.onload = function () {
        var body = null;
        try { body = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
        if (xhr.status === 200 && body && body.ok) resolve(body); else reject({ status: xhr.status, body: body });
      };
      xhr.onerror = xhr.ontimeout = function () { reject({ status: 0 }); };
      xhr.send(fd);
    });
  }

  function showResult(ok, nodes) {
    result.className = 'eq-result ' + (ok ? 'eq-result--ok' : 'eq-result--error');
    while (result.firstChild) result.removeChild(result.firstChild);
    nodes.forEach(function (n) { result.appendChild(n); });
    result.hidden = false;
    result.focus();
  }
  function para(text, strong) {
    var p = document.createElement('p');
    if (strong) { var b = document.createElement('strong'); b.textContent = text; p.appendChild(b); } else p.textContent = text;
    return p;
  }
  function contactButtons() {
    var g = document.createElement('div');
    g.className = 'cta-group';
    g.innerHTML = '<a class="btn btn--gold" href="tel:' + CFG.phoneTel + '">Call ' + CFG.phoneDisplay + '</a>' +
      '<a class="btn btn--wa" href="https://wa.me/' + CFG.whatsappNumber + '" rel="noopener" target="_blank">WhatsApp us</a>';
    return g;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending || !validate()) return;
    var key = [value('phone'), value('description')].join('|');
    if (key === sentKey) return;   // already sent from this page
    sending = true;
    submitBtn.disabled = true;
    result.hidden = true;
    submitLabel.textContent = files.length ? 'Preparing photos…' : 'Sending…';
    prepareFiles(files).then(function (prepared) {
      var u = urgencyCode();
      var fd = new FormData();
      fd.append('service', SERVICE_CODE[value('category')] || 'Other');
      fd.append('urgency', u);
      fd.append('when', WHEN[u] || "I'm flexible");
      fd.append('postcode', value('postcode'));
      fd.append('description', description());
      fd.append('name', value('name'));
      fd.append('phone', value('phone'));
      fd.append('email', value('email'));
      fd.append('address', value('address'));
      fd.append('availability', '');
      fd.append('consent', 'yes');
      fd.append('page', location.pathname + ' (quote form)');
      fd.append('website', value('website'));
      fd.append('elapsed', String(Date.now() - shownAt));
      var tok = form.querySelector('[name="cf-turnstile-response"]');
      if (tok) fd.append('cf-turnstile-response', tok.value);
      prepared.forEach(function (f) { fd.append('files', f.blob, f.name); });
      submitLabel.textContent = 'Sending…';
      progress.hidden = false;
      return upload(fd);
    }).then(function (res) {
      sentKey = key;
      progress.hidden = true;
      form.classList.add('is-sent');
      var nodes = [
        para('Thank you, ' + value('name').split(' ')[0] + '. We have received your enquiry and will contact you shortly.', true),
        (function () { var p = para('Your reference: '); var b = document.createElement('strong'); b.className = 'eq-ref'; b.textContent = res.reference; p.appendChild(b); return p; })()
      ];
      var missing = files.length && !res.duplicate ? files.length - (res.filesReceived || 0) : 0;
      if (missing > 0) nodes.push(para('We could not receive ' + missing + ' of your files. Please send ' + (missing === 1 ? 'it' : 'them') + ' on WhatsApp with your reference.'));
      if (urgencyCode() === 'Emergency') {
        nodes.push(para('As this is an emergency, please also call or WhatsApp us now so we can help as quickly as possible.'));
        nodes.push(contactButtons());
      }
      showResult(true, nodes);
    }).catch(function (x) {
      sending = false;
      submitBtn.disabled = false;
      submitLabel.textContent = 'Try again';
      progress.hidden = true;
      var fields = x && x.body && x.body.fields;
      var msg = x && x.status === 429
        ? 'We have had several enquiries from this connection. Please call or WhatsApp us instead.'
        : x && x.status === 413
          ? 'Your photos or video are too large to send. Remove the video or send a shorter one, then try again.'
          : x && x.status === 400 && fields
            ? 'Some details were not accepted (' + fields.join(', ') + '). Please check them and try again.'
            : 'Sorry, your enquiry did not send. Please check your connection and try again, or send it by WhatsApp or email instead.';
      var alt = document.createElement('p');
      var wa = document.createElement('a'); wa.href = '#'; wa.textContent = 'Send on WhatsApp';
      wa.addEventListener('click', function (ev) { ev.preventDefault(); openWhatsApp(); });
      var em = document.createElement('a'); em.href = '#'; em.textContent = 'send by email';
      em.addEventListener('click', function (ev) { ev.preventDefault(); openEmail(); });
      alt.appendChild(wa); alt.appendChild(document.createTextNode(' or ')); alt.appendChild(em);
      alt.appendChild(document.createTextNode(' with these details, or call ' + CFG.phoneDisplay + '.'));
      showResult(false, [para(msg, true), alt]);
      if (window.turnstile && tsBox && tsKey) { try { window.turnstile.reset(tsBox); } catch (e2) { /* ignore */ } }
    }).then(function () { sending = false; });
  });
})();
