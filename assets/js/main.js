/*
 * Amiri Building Services – site script (vanilla JS, no dependencies).
 * - Mobile menu
 * - Gentle scroll-reveal animations (off when the visitor prefers reduced motion)
 * - WhatsApp / email enquiry form (no server, nothing stored)
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
      if (use) use.setAttribute('href', '/assets/icons/sprite.svg#' + (open ? 'close' : 'menu'));
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
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') target.setAttribute('aria-invalid', 'true');
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

  function buildMessage() {
    var svc = value('category');
    if (value('service')) svc += ' – ' + value('service');
    return [
      'Hello ' + (CFG.tradingName || 'Amiri Building Services') + ',',
      '',
      'Name: ' + value('name'),
      'Postcode: ' + value('postcode').toUpperCase(),
      'Service: ' + svc,
      'Urgency: ' + value('urgency'),
      'Problem: ' + value('description'),
      '',
      'Please contact me regarding this job.'
    ].join('\n');
  }

  function open(url) {
    var w = window.open(url, '_blank');
    if (w) w.opener = null;
    else window.location.href = url;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validate()) return;
    open('https://wa.me/' + CFG.whatsappNumber + '?text=' + encodeURIComponent(buildMessage()));
  });

  var emailBtn = form.querySelector('[data-send-email]');
  if (emailBtn) {
    emailBtn.addEventListener('click', function () {
      if (!validate()) return;
      var subject = 'Enquiry: ' + value('category') + ' – ' + value('postcode').toUpperCase();
      window.location.href = 'mailto:' + CFG.email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(buildMessage());
    });
  }
})();
