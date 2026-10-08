/*
 * Amiri AI Receptionist – website chat assistant (guided mode).
 *
 * Loaded ONLY when aiChat.enabled = true in site.config.json (or when a
 * preview build is made with AI_CHAT_PREVIEW=1). While it is off, no chat
 * code or styles are sent to visitors.
 *
 * Guided mode runs entirely in the visitor's browser: it asks a fixed set of
 * questions, then builds an enquiry summary the customer sends to us by
 * WhatsApp or email. Nothing leaves the device until they press send.
 * If aiChat.submitEndpoint is set (functions/api/enquiry.js, see
 * AI_RECEPTIONIST_PLAN.md), the customer instead ticks a consent box and
 * presses Submit: the enquiry, photos and video are uploaded to our own back
 * end, which stores them and emails the business automatically. If that
 * fails, WhatsApp and email buttons appear so the enquiry is never stuck.
 *
 * Rules built in (owner's brief): no prices or bookings promised, no 24/7
 * claims, non-gas plumbing only, and no technical repair instructions – only
 * fixed safety messages (keep away, call 999 / the gas emergency line).
 *
 * SECURITY: never put an API key in this file. All text is inserted with
 * textContent, never innerHTML.
 */
(function () {
  'use strict';
  var CFG = window.SITE_CONFIG || {};
  if (!CFG.AI_CHAT_ENABLED) return;
  var AI = CFG.aiChat || {};
  var PRICING = CFG.pricing || {};
  var STORE_KEY = 'abs-chat-v1';
  var MAX_FILES = 6;
  var MAX_PHOTO_MB = 25;   // before compression; photos are resized to ~2000px before upload
  var MAX_VIDEO_MB = 60;
  var AUTO = Boolean(AI.submitEndpoint);   // automatic submission to our own back end
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var SERVICES = ['Electrical', 'Plumbing', 'Property Maintenance', 'Other'];
  var URGENCY_LABEL = { Emergency: 'EMERGENCY', Urgent: 'URGENT', Planned: 'Planned / non-emergency' };
  var WHEN = ['As soon as possible', 'In the next few days', 'In the next 2 weeks', "I'm flexible"];

  /* ------------------------------------------------------------ helpers */

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    if (text != null) e.textContent = text;
    return e;
  }
  function icon(name) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '/assets/icons/sprite.svg#' + name);
    svg.appendChild(use);
    return svg;
  }
  function linkBtn(href, cls, iconName, text, extra) {
    var a = el('a', Object.assign({ href: href, class: 'abs-chat-btn ' + cls }, extra || {}));
    if (iconName) a.appendChild(icon(iconName));
    a.appendChild(el('span', null, text));
    return a;
  }
  function waLink(text) {
    return 'https://wa.me/' + (CFG.whatsappNumber || '') + (text ? '?text=' + encodeURIComponent(text) : '');
  }
  function store(data) {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* private mode */ }
  }
  function restore() {
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; }
  }
  function forget() {
    try { sessionStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  }
  function newRef() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'ABS-' + p(d.getDate()) + p(d.getMonth() + 1) + String(d.getFullYear()).slice(2) + '-' + Math.floor(1000 + Math.random() * 9000);
  }

  /* ------------------------------------------------------------- state */

  var state = {
    step: 'service',
    answers: {},
    transcript: [],   // [{who, text}] replayed if the visitor changes page
    notices: {},      // fixed safety notices already shown
    ref: newRef()
  };
  var files = [];     // File objects; cannot survive a page change

  /* ---------------------------------------------------------------- UI */

  var launcher = el('button', { type: 'button', class: 'abs-chat-launcher', 'aria-expanded': 'false', 'aria-controls': 'abs-chat' });
  launcher.appendChild(icon('chat'));
  launcher.appendChild(el('span', null, 'Get help'));

  var panel = el('section', { id: 'abs-chat', class: 'abs-chat', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'abs-chat-title', hidden: true });
  var head = el('header', { class: 'abs-chat__head' });
  var titleWrap = el('div', { class: 'abs-chat__title' });
  titleWrap.appendChild(el('h2', { id: 'abs-chat-title' }, CFG.tradingName || 'Amiri Building Services'));
  titleWrap.appendChild(el('p', null, 'Enquiry assistant'));
  var restartBtn = el('button', { type: 'button', class: 'abs-chat__restart' }, 'Start again');
  var closeBtn = el('button', { type: 'button', class: 'abs-chat__close', 'aria-label': 'Close chat' });
  closeBtn.appendChild(icon('close'));
  head.appendChild(titleWrap);
  head.appendChild(restartBtn);
  head.appendChild(closeBtn);

  var urgentBar = el('div', { class: 'abs-chat__urgent', hidden: true });
  urgentBar.appendChild(el('p', null, 'Emergency? Call or WhatsApp us now.'));
  var urgentActions = el('div', { class: 'abs-chat__urgent-actions' });
  urgentActions.appendChild(linkBtn('tel:' + CFG.phoneTel, 'abs-chat-btn--call', 'phone', 'Call Now'));
  urgentActions.appendChild(linkBtn(waLink('EMERGENCY: I need help urgently.'), 'abs-chat-btn--wa', 'whatsapp', 'WhatsApp', { rel: 'noopener', target: '_blank' }));
  urgentBar.appendChild(urgentActions);

  var log = el('div', { class: 'abs-chat__log', role: 'log', 'aria-live': 'polite', tabindex: '0' });
  var dock = el('div', { class: 'abs-chat__dock' });

  [head, urgentBar, log, dock].forEach(function (n) { panel.appendChild(n); });
  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  var muted = false;   // true while re-asking a question after a page change
  function say(text, who, opts) {
    if (muted) return null;
    var p = el('p', { class: 'abs-chat__msg abs-chat__msg--' + (who || 'bot') + (opts && opts.tone ? ' abs-chat__msg--' + opts.tone : '') }, text);
    log.appendChild(p);
    if (!(opts && opts.replay)) state.transcript.push({ who: who || 'bot', text: text, tone: opts && opts.tone });
    log.scrollTop = log.scrollHeight;
    return p;
  }
  function append(node) {
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
  }
  function clearDock() { while (dock.firstChild) dock.removeChild(dock.firstChild); }
  function save() { store(state); }

  function chips(options, onPick) {
    clearDock();
    var wrap = el('div', { class: 'abs-chat__chips', role: 'group' });
    options.forEach(function (opt) {
      var b = el('button', { type: 'button', class: 'abs-chat__chip' }, opt.label || opt);
      b.addEventListener('click', function () { onPick(opt.value || opt.label || opt, opt.label || opt); });
      wrap.appendChild(b);
    });
    dock.appendChild(wrap);
    var first = wrap.querySelector('button');
    if (first && !panel.hidden) first.focus();
  }

  function textInput(opts, onSubmit) {
    clearDock();
    var form = el('form', { class: 'abs-chat__form', novalidate: true });
    var id = 'abs-chat-in';
    form.appendChild(el('label', { for: id, class: 'visually-hidden' }, opts.label));
    var field = opts.multiline
      ? el('textarea', { id: id, rows: '3', maxlength: String(opts.max || 800), placeholder: opts.placeholder || '' })
      : el('input', { id: id, type: opts.type || 'text', maxlength: String(opts.max || 120), placeholder: opts.placeholder || '', autocomplete: opts.autocomplete || 'off', inputmode: opts.inputmode || false, enterkeyhint: 'send' });
    var sendBtn = el('button', { type: 'submit', class: 'abs-chat__send', 'aria-label': 'Send' });
    sendBtn.appendChild(icon('arrow'));
    var err = el('p', { class: 'abs-chat__error', role: 'alert', hidden: true });
    var row = el('div', { class: 'abs-chat__row' });
    row.appendChild(field);
    row.appendChild(sendBtn);
    form.appendChild(row);
    form.appendChild(err);
    if (opts.skip) {
      var skip = el('button', { type: 'button', class: 'abs-chat__skip' }, opts.skip);
      skip.addEventListener('click', function () { onSubmit(''); });
      form.appendChild(skip);
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = field.value.trim();
      var problem = opts.validate ? opts.validate(v) : (v ? '' : 'Please type an answer.');
      if (problem) { err.textContent = problem; err.hidden = false; field.focus(); return; }
      onSubmit(v);
    });
    if (opts.multiline) {
      field.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); }
      });
    }
    dock.appendChild(form);
    if (!panel.hidden) field.focus();
  }

  /* ------------------------------------------------- fixed safety text */

  var SAFETY = {
    gasLeak: {
      test: /smell(ing|s)? (of )?gas|gas (leak|smell)|leaking gas|carbon monoxide|\bco alarm/i,
      text: 'If you can smell gas or a carbon monoxide alarm is sounding, leave the property and call the National Gas Emergency Service on 0800 111 999 straight away. We do not work on gas.'
    },
    danger: {
      test: /spark|smok(e|ing)|fire|flames?|burning|scorch|melt|electric shock|electrocut|shocked|exposed wire|live wire|bare wire|water (near|in|on|into|coming through|dripping on).{0,30}(socket|switch|light|fuse|consumer unit|electric)/i,
      text: 'For your safety, keep away from anything that is sparking, smoking, scorched or wet near electrics, and please don\'t try to repair it yourself. If there is fire or smoke, or someone has had an electric shock, call 999 now.'
    },
    gasWork: {
      test: /\b(gas|boiler|combi)\b/i,
      text: 'Please note we only do non-gas plumbing. Boilers and gas appliances need a Gas Safe registered engineer, but we can still help with any non-gas part of the job.'
    },
    price: {
      test: /how much|price|cost|quote|£|\bcharge|fee\b/i,
      text: 'We can\'t give a price in this chat because every job needs to be assessed first. ' + [PRICING.quoteFree, PRICING.maybeCharged, PRICING.explain].filter(Boolean).join(' ')
    }
  };
  function safetyCheck(text) {
    ['gasLeak', 'danger', 'gasWork', 'price'].forEach(function (k) {
      if (state.notices[k]) return;
      if (k === 'gasWork' && state.notices.gasLeak) return;
      if (SAFETY[k].test.test(text)) {
        state.notices[k] = true;
        say(SAFETY[k].text, 'bot', { tone: k === 'price' || k === 'gasWork' ? 'info' : 'alert' });
        if (k === 'gasLeak' || k === 'danger') showUrgent();
      }
    });
  }
  function showUrgent() { urgentBar.hidden = false; }

  /* ------------------------------------------------------------ validation */

  function normPostcode(v) {
    var m = v.toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
    return m ? { full: m[1] + ' ' + m[2], outward: m[1] } : null;
  }
  function normPhone(v) {
    var d = v.replace(/[\s()-]/g, '');
    if (/^\+44\d{9,10}$/.test(d)) return d;
    if (/^07\d{9}$/.test(d)) return d.slice(0, 5) + ' ' + d.slice(5);
    if (/^0\d{9,10}$/.test(d)) return d;
    return null;
  }

  /* ------------------------------------------------------------- steps */

  var STEPS = {
    service: function () {
      say('Hello, thanks for getting in touch with ' + (CFG.tradingName || 'us') + '. I\'ll ask a few quick questions so we can get back to you with the right help. What service do you need?');
      chips(SERVICES, function (v) {
        say(v, 'user');
        state.answers.service = v;
        if (v === 'Plumbing') say('Good to know. Just so you\'re aware, we only do non-gas plumbing (no boilers or gas appliances).', 'bot', { tone: 'info' });
        go('urgency');
      });
    },
    urgency: function () {
      say('How soon does this need sorting?\n\nEmergency: something is unsafe or causing damage right now.\nUrgent: it needs looking at soon, but nothing is dangerous.\nPlanned: a job that can be booked in.');
      chips([
        { label: 'Emergency', value: 'Emergency' },
        { label: 'Urgent', value: 'Urgent' },
        { label: 'Planned / non-emergency', value: 'Planned' }
      ], function (v, label) {
        say(label, 'user');
        state.answers.urgency = v;
        if (v === 'Emergency') {
          showUrgent();
          var box = el('div', { class: 'abs-chat__card abs-chat__card--urgent' });
          box.appendChild(el('p', { class: 'abs-chat__card-title' }, 'For emergencies, please call or WhatsApp us now'));
          if (CFG.emergencyText) box.appendChild(el('p', null, CFG.emergencyText));
          var acts = el('div', { class: 'abs-chat__actions' });
          acts.appendChild(linkBtn('tel:' + CFG.phoneTel, 'abs-chat-btn--call abs-chat-btn--lg', 'phone', 'Call Now ' + (CFG.phoneDisplay || '')));
          acts.appendChild(linkBtn(waLink('EMERGENCY (' + state.answers.service + '): I need help urgently.'), 'abs-chat-btn--wa abs-chat-btn--lg', 'whatsapp', 'WhatsApp us', { rel: 'noopener', target: '_blank' }));
          box.appendChild(acts);
          box.appendChild(el('p', { class: 'abs-chat__small' }, 'If there is fire, smoke, an electric shock or any danger to life, call 999. If you smell gas, call 0800 111 999.'));
          append(box);
          say('You can also carry on here and we\'ll put your details together for you.');
        } else if (v === 'Urgent') {
          say('Thanks, we\'ll mark this as urgent. If you\'d rather speak to us straight away, you can call or WhatsApp us at any point.');
          var quick = el('div', { class: 'abs-chat__actions abs-chat__actions--pair' });
          quick.appendChild(linkBtn('tel:' + CFG.phoneTel, 'abs-chat-btn--call', 'phone', 'Call Now'));
          quick.appendChild(linkBtn(waLink('URGENT (' + state.answers.service + '): I need help soon.'), 'abs-chat-btn--wa', 'whatsapp', 'WhatsApp', { rel: 'noopener', target: '_blank' }));
          append(quick);
        }
        go('postcode');
      });
    },
    postcode: function () {
      say('What\'s the postcode where the work is needed?');
      textInput({ label: 'Postcode', placeholder: 'e.g. UB7 9AA', autocomplete: 'postal-code', max: 10,
        validate: function (v) { return normPostcode(v) ? '' : 'Please enter a full UK postcode, for example UB7 9AA.'; }
      }, function (v) {
        var pc = normPostcode(v);
        say(pc.full, 'user');
        state.answers.postcode = pc.full;
        var covered = (AI.coveredPostcodeAreas || []).indexOf(pc.outward) !== -1;
        if (!covered) say('Thanks. That may be outside our usual area, but we\'ll check and let you know if we can help.', 'bot', { tone: 'info' });
        go('photos');
      });
    },
    photos: function () {
      say('Could you add some photos or a short video of the problem? It helps us understand the job before we get back to you.');
      renderPhotoPicker();
    },
    description: function () {
      say('Please describe the problem in a sentence or two.');
      textInput({ label: 'Describe the problem', multiline: true, max: 800, placeholder: 'e.g. Kitchen sockets stopped working this morning',
        validate: function (v) { return v.length >= 5 ? '' : 'Please add a few words about the problem.'; }
      }, function (v) {
        say(v, 'user');
        state.answers.description = v;
        safetyCheck(v);
        go('name');
      });
    },
    name: function () {
      say('Thanks. What\'s your name?');
      textInput({ label: 'Your name', autocomplete: 'name', max: 80,
        validate: function (v) { return v.length >= 2 ? '' : 'Please enter your name.'; }
      }, function (v) {
        say(v, 'user');
        state.answers.name = v;
        go('phone');
      });
    },
    phone: function () {
      say('And the best phone number to reach you on?');
      textInput({ label: 'Phone number', type: 'tel', inputmode: 'tel', autocomplete: 'tel', max: 20, placeholder: 'e.g. 07123 456789',
        validate: function (v) { return normPhone(v) ? '' : 'Please enter a UK phone number, for example 07123 456789.'; }
      }, function (v) {
        say(v, 'user');
        state.answers.phone = normPhone(v);
        go('when');
      });
    },
    when: function () {
      say('When do you need the work done?');
      chips(WHEN, function (v) {
        say(v, 'user');
        state.answers.when = v;
        go('availability');
      });
    },
    availability: function () {
      say('Any days or times that suit you best? (optional)');
      textInput({ label: 'Your availability', max: 160, placeholder: 'e.g. Weekday mornings, or after 5pm', skip: 'Skip',
        validate: function () { return ''; }
      }, function (v) {
        if (v) say(v, 'user');
        state.answers.availability = v;
        go('summary');
      });
    },
    summary: function () {
      renderSummary();
    },
    done: function () {
      renderConfirmation(state.result || {});
    }
  };

  function go(step) {
    state.step = step;
    STEPS[step]();
    save();
  }

  /* ------------------------------------------------------------ photos */

  var fileWidgetCount = 0;
  // Add/remove photos and video. Used on the photos step and on the Submit card.
  function fileWidget(onChange, compact) {
    var id = 'abs-chat-files-' + (++fileWidgetCount);
    var wrap = el('div', { class: 'abs-chat__photos' + (compact ? ' abs-chat__photos--compact' : '') });
    var input = el('input', { type: 'file', id: id, accept: 'image/*,video/*', multiple: true, class: 'visually-hidden abs-chat__file-input' });
    var pick = el('label', { for: id, class: 'abs-chat-btn abs-chat-btn--outline' + (compact ? ' abs-chat-btn--sm' : '') });
    pick.appendChild(icon('camera'));
    var pickText = el('span', null, 'Add photos or video');
    pick.appendChild(pickText);
    var thumbs = el('ul', { class: 'abs-chat__thumbs', 'aria-label': 'Selected files' });
    var msg = el('p', { class: 'abs-chat__error', role: 'alert', hidden: true });

    function draw() {
      while (thumbs.firstChild) thumbs.removeChild(thumbs.firstChild);
      files.forEach(function (f, i) {
        var li = el('li');
        if (/^image\//.test(f.type)) {
          var img = el('img', { alt: f.name });
          img.src = URL.createObjectURL(f);
          img.onload = function () { URL.revokeObjectURL(img.src); };
          li.appendChild(img);
        } else {
          li.appendChild(el('span', { class: 'abs-chat__vid' }, 'Video'));
        }
        var rm = el('button', { type: 'button', 'aria-label': 'Remove ' + f.name }, '×');
        rm.addEventListener('click', function () { files.splice(i, 1); draw(); onChange(); });
        li.appendChild(rm);
        thumbs.appendChild(li);
      });
      if (compact) pickText.textContent = files.length ? 'Add or change photos' : 'Add photos or video';
    }
    input.addEventListener('change', function () {
      var problems = [];
      Array.prototype.forEach.call(input.files, function (f) {
        if (!/^(image|video)\//.test(f.type)) return problems.push(f.name + ' is not a photo or video.');
        var isVideo = /^video\//.test(f.type);
        var max = isVideo ? MAX_VIDEO_MB : MAX_PHOTO_MB;
        if (f.size > max * 1024 * 1024) return problems.push(f.name + ' is over ' + max + ' MB.' + (isVideo ? ' Please send a shorter video.' : ''));
        if (files.length >= MAX_FILES) return problems.push('You can add up to ' + MAX_FILES + ' files.');
        files.push(f);
      });
      input.value = '';
      msg.textContent = problems.join(' ');
      msg.hidden = !problems.length;
      draw();
      onChange();
    });
    wrap.appendChild(input);
    wrap.appendChild(pick);
    wrap.appendChild(thumbs);
    wrap.appendChild(msg);
    draw();
    wrap.focusInput = function () { input.focus(); };
    return wrap;
  }

  function renderPhotoPicker() {
    clearDock();
    var next = el('button', { type: 'button', class: 'abs-chat__chip abs-chat__chip--primary' }, 'Skip for now');
    var widget = fileWidget(function () { next.textContent = files.length ? 'Done – continue' : 'Skip for now'; });
    next.textContent = files.length ? 'Done – continue' : 'Skip for now';
    next.addEventListener('click', function () {
      state.answers.photos = files.length;
      say(files.length ? files.length + (files.length === 1 ? ' file added' : ' files added') : 'No photos for now', 'user');
      go('description');
    });
    widget.appendChild(el('p', { class: 'abs-chat__small' }, AUTO
      ? 'Up to ' + MAX_FILES + ' files. Videos up to ' + MAX_VIDEO_MB + ' MB (about 30 seconds). Nothing is sent until you press Submit at the end.'
      : 'Your photos stay on your device until you choose to send them to us.'));
    widget.appendChild(next);
    dock.appendChild(widget);
    if (!panel.hidden) widget.focusInput();
  }

  /* ----------------------------------------------------------- summary */

  function summaryRows() {
    var a = state.answers;
    var when = a.when + (a.availability ? ' – ' + a.availability : '');
    var rows = [
      ['Reference', state.ref],
      ['Service', a.service],
      ['Urgency', URGENCY_LABEL[a.urgency] || a.urgency],
      ['Postcode', a.postcode],
      ['Problem', a.description],
      ['Photos/video', AUTO ? filesLabel() : (a.photos ? a.photos + ' to follow' : 'None yet')],
      ['Name', a.name],
      ['Phone', a.phone],
      ['When', when]
    ];
    // In automatic mode the reference comes from the server after submitting.
    return AUTO ? rows.slice(1) : rows;
  }
  function filesLabel() {
    var p = files.filter(function (f) { return /^image\//.test(f.type); }).length;
    var v = files.length - p;
    if (!files.length) return 'None';
    return [p ? p + (p === 1 ? ' photo' : ' photos') : '', v ? v + (v === 1 ? ' video' : ' videos') : ''].filter(Boolean).join(', ');
  }
  function summaryText() {
    var u = state.answers.urgency;
    var head = (u === 'Emergency' ? 'EMERGENCY ENQUIRY' : u === 'Urgent' ? 'URGENT ENQUIRY' : 'New enquiry') + ' – via website chat';
    return [head].concat(summaryRows().map(function (r) { return r[0] + ': ' + r[1]; })).join('\n');
  }

  function renderSummary() {
    if (AUTO) return renderSubmit();
    clearDock();
    var a = state.answers;
    say('Thanks, ' + a.name.split(' ')[0] + '. Here\'s a summary of your enquiry. Nothing has been sent yet, so please choose how to send it to us.');

    var card = el('div', { class: 'abs-chat__card abs-chat__summary' });
    card.appendChild(el('p', { class: 'abs-chat__card-title' }, 'Your enquiry'));
    var dl = el('dl');
    summaryRows().forEach(function (r) {
      var row = el('div', { class: r[0] === 'Urgency' && a.urgency !== 'Planned' ? 'is-urgent' : null });
      row.appendChild(el('dt', null, r[0]));
      row.appendChild(el('dd', null, r[1]));
      dl.appendChild(row);
    });
    card.appendChild(dl);
    append(card);

    // The send options sit in the conversation (not the bottom bar) so the
    // whole summary can be scrolled and read on a small phone screen.
    var box = el('div', { class: 'abs-chat__send-box' });
    var acts = el('div', { class: 'abs-chat__actions abs-chat__actions--stack' });
    if (a.urgency !== 'Planned') {
      acts.appendChild(linkBtn('tel:' + CFG.phoneTel, 'abs-chat-btn--call abs-chat-btn--lg', 'phone', 'Call Now ' + (CFG.phoneDisplay || '')));
    }
    var text = summaryText();
    var wa = linkBtn(waLink(text), 'abs-chat-btn--wa abs-chat-btn--lg', 'whatsapp', 'Send on WhatsApp', { rel: 'noopener', target: '_blank' });
    wa.addEventListener('click', function () { sent('WhatsApp'); });
    acts.appendChild(wa);

    if (files.length && navigator.canShare && navigator.canShare({ files: files })) {
      var share = el('button', { type: 'button', class: 'abs-chat-btn abs-chat-btn--outline' });
      share.appendChild(icon('camera'));
      share.appendChild(el('span', null, 'Share photos to WhatsApp'));
      share.addEventListener('click', function () {
        navigator.share({ files: files, text: 'Photos for enquiry ' + state.ref }).catch(function () { /* cancelled */ });
      });
      acts.appendChild(share);
    }

    var subject = (a.urgency === 'Planned' ? '' : a.urgency.toUpperCase() + ': ') + a.service + ' enquiry ' + state.ref + ' (' + a.postcode + ')';
    var mail = linkBtn('mailto:' + (CFG.email || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text + (a.photos ? '\n\n(Please attach your photos or video to this email.)' : '')), 'abs-chat-btn--dark', 'mail', 'Send by email');
    mail.addEventListener('click', function () { sent('email'); });
    acts.appendChild(mail);

    var copy = el('button', { type: 'button', class: 'abs-chat__skip' }, 'Copy summary');
    copy.addEventListener('click', function () {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(text).then(function () { copy.textContent = 'Copied'; }, function () { /* ignore */ });
    });
    acts.appendChild(copy);
    box.appendChild(acts);

    var notes = [
      a.photos ? 'Please attach your ' + (a.photos === 1 ? 'photo or video' : a.photos + ' photos or videos') + ' when the message opens.' : '',
      'We can\'t confirm a price or booking in this chat. ' + [PRICING.quoteFree, PRICING.maybeCharged].filter(Boolean).join(' ')
    ].filter(Boolean);
    box.appendChild(el('p', { class: 'abs-chat__small' }, notes.join(' ')));
    var priv = el('p', { class: 'abs-chat__small' }, 'We only use these details to reply to your enquiry. ');
    priv.appendChild(el('a', { href: '/privacy/' }, 'Privacy notice'));
    box.appendChild(priv);
    append(box);
  }

  function sent(channel) {
    if (state.notices['sent-' + channel]) return;
    state.notices['sent-' + channel] = true;
    setTimeout(function () {
      say('Thanks. Once your ' + channel + ' message is sent, we\'ll get back to you as soon as we can. Your reference is ' + state.ref + '.');
      save();
    }, 400);
  }

  /* ------------------------------------------- automatic submission */

  function renderSubmit() {
    clearDock();
    var a = state.answers;
    say('Thanks, ' + a.name.split(' ')[0] + '. Please check your details below, then press Submit to send your enquiry to us.');

    var card = el('div', { class: 'abs-chat__card abs-chat__summary' });
    card.appendChild(el('p', { class: 'abs-chat__card-title' }, 'Your enquiry'));
    var dl = el('dl');
    function drawRows() {
      while (dl.firstChild) dl.removeChild(dl.firstChild);
      summaryRows().forEach(function (r) {
        var row = el('div', { class: r[0] === 'Urgency' && a.urgency !== 'Planned' ? 'is-urgent' : null });
        row.appendChild(el('dt', null, r[0]));
        row.appendChild(el('dd', null, r[1]));
        dl.appendChild(row);
      });
    }
    drawRows();
    card.appendChild(dl);
    // Photos can be added or changed here too (e.g. after a page change).
    card.appendChild(fileWidget(function () { state.answers.photos = files.length; save(); drawRows(); }, true));
    append(card);

    var box = el('form', { class: 'abs-chat__send-box', novalidate: true });
    if (a.urgency === 'Emergency') {
      var urgentActs = el('div', { class: 'abs-chat__actions abs-chat__actions--pair' });
      urgentActs.appendChild(linkBtn('tel:' + CFG.phoneTel, 'abs-chat-btn--call', 'phone', 'Call Now'));
      urgentActs.appendChild(linkBtn(waLink('EMERGENCY (' + a.service + '): I need help urgently.'), 'abs-chat-btn--wa', 'whatsapp', 'WhatsApp', { rel: 'noopener', target: '_blank' }));
      box.appendChild(el('p', { class: 'abs-chat__small abs-chat__small--strong' }, 'Emergency? For the fastest help, call or WhatsApp us now as well.'));
      box.appendChild(urgentActs);
    }

    var consent = el('div', { class: 'abs-chat__consent' });
    var cb = el('input', { type: 'checkbox', id: 'abs-chat-consent', required: true });
    var lab = el('label', { for: 'abs-chat-consent' });
    lab.appendChild(document.createTextNode('I agree that ' + ((CFG.tradingName || 'Amiri Building Services') + ' Ltd') + ' can use the details, photos and video I have given to respond to my enquiry. They are stored securely and deleted after 12 months if they do not lead to work. '));
    lab.appendChild(el('a', { href: '/privacy/', target: '_blank', rel: 'noopener' }, 'Privacy notice'));
    consent.appendChild(cb);
    consent.appendChild(lab);
    box.appendChild(consent);

    var ts = null;
    if (AI.turnstileSiteKey) { ts = el('div', { class: 'abs-chat__turnstile' }); box.appendChild(ts); loadTurnstile(ts); }

    var err = el('p', { class: 'abs-chat__error', role: 'alert', hidden: true });
    var submit = el('button', { type: 'submit', class: 'abs-chat-btn abs-chat-btn--gold abs-chat-btn--lg abs-chat-btn--block' });
    submit.appendChild(icon('check'));
    var submitLabel = el('span', null, 'Submit enquiry');
    submit.appendChild(submitLabel);
    var progress = el('div', { class: 'abs-chat__progress', hidden: true, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Upload progress' });
    var bar = el('span');
    progress.appendChild(bar);
    box.appendChild(err);
    box.appendChild(submit);
    box.appendChild(progress);
    box.appendChild(el('p', { class: 'abs-chat__small' }, 'We can\'t confirm a price or booking in this chat. ' + [PRICING.quoteFree, PRICING.maybeCharged].filter(Boolean).join(' ')));
    append(box);

    box.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!cb.checked) { err.textContent = 'Please tick the box to agree, so we can use your details to reply.'; err.hidden = false; cb.focus(); return; }
      err.hidden = true;
      submit.disabled = true;
      cb.disabled = true;
      submitLabel.textContent = files.length ? 'Preparing photos…' : 'Sending…';
      prepareFiles(files).then(function (prepared) {
        var fd = new FormData();
        ['service', 'urgency', 'postcode', 'description', 'name', 'phone', 'when', 'availability'].forEach(function (k) { fd.append(k, a[k] || ''); });
        fd.append('consent', 'yes');
        fd.append('page', location.pathname);
        fd.append('website', '');   // honeypot: always empty for real visitors
        var tok = box.querySelector('[name="cf-turnstile-response"]');
        if (tok) fd.append('cf-turnstile-response', tok.value);
        prepared.forEach(function (f) { fd.append('files', f.blob, f.name); });
        submitLabel.textContent = 'Sending…';
        progress.hidden = false;
        return upload(fd, function (pct) {
          bar.style.width = pct + '%';
          progress.setAttribute('aria-valuenow', String(pct));
          if (prepared.length) submitLabel.textContent = 'Sending… ' + pct + '%';
        });
      }).then(function (res) {
        state.result = { reference: res.reference, filesReceived: res.filesReceived || 0, filesSent: files.length };
        box.parentNode && box.parentNode.removeChild(box);
        // Photos can no longer be changed once the enquiry has been sent.
        Array.prototype.forEach.call(log.querySelectorAll('.abs-chat__photos--compact'), function (w) {
          Array.prototype.forEach.call(w.querySelectorAll('label, input, button'), function (n) { n.parentNode.removeChild(n); });
        });
        state.step = 'done';
        renderConfirmation(state.result);
        save();
      }).catch(function (x) {
        submit.disabled = false;
        cb.disabled = false;
        submitLabel.textContent = 'Try again';
        progress.hidden = true;
        var msg = x && x.status === 429
          ? 'We\'ve had several enquiries from this connection. Please call or WhatsApp us instead.'
          : x && x.status === 413
            ? 'Your photos or video are too large to send. Please remove the video or send a shorter one, then try again.'
            : 'Sorry, your enquiry didn\'t send. Please check your connection and try again, or send it by WhatsApp or email below.';
        err.textContent = msg;
        err.hidden = false;
        renderFallback(box);
        if (window.turnstile && ts) { try { window.turnstile.reset(ts); } catch (e2) { /* ignore */ } }
      });
    });
  }

  function upload(fd, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', AI.submitEndpoint);
      xhr.timeout = 180000;
      xhr.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(Math.min(99, Math.round(e.loaded / e.total * 100))); };
      xhr.onload = function () {
        var body = null;
        try { body = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
        if (xhr.status === 200 && body && body.ok) { onProgress(100); resolve(body); } else reject({ status: xhr.status, body: body });
      };
      xhr.onerror = xhr.ontimeout = function () { reject({ status: 0 }); };
      xhr.send(fd);
    });
  }

  // Resize large photos in the browser (max 2000px, JPEG) so uploads are
  // quick on mobile data. Videos and anything that can't be read go as-is.
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

  function renderConfirmation(res) {
    clearDock();
    var a = state.answers;
    var card = el('div', { class: 'abs-chat__card abs-chat__confirm', role: 'status' });
    var tick = el('div', { class: 'abs-chat__confirm-icon' });
    tick.appendChild(icon('check'));
    card.appendChild(tick);
    card.appendChild(el('p', { class: 'abs-chat__card-title' }, 'Thank you. ' + (CFG.tradingName || 'Amiri Building Services') + ' has received your enquiry and will contact you shortly.'));
    if (res.reference) {
      var ref = el('p', { class: 'abs-chat__ref' }, 'Your reference: ');
      ref.appendChild(el('strong', null, res.reference));
      card.appendChild(ref);
    }
    if (a.urgency === 'Emergency') {
      card.appendChild(el('p', null, 'As this is an emergency, please also call or WhatsApp us now so we can help as quickly as possible.'));
      var acts = el('div', { class: 'abs-chat__actions' });
      acts.appendChild(linkBtn('tel:' + CFG.phoneTel, 'abs-chat-btn--call abs-chat-btn--lg', 'phone', 'Call Now ' + (CFG.phoneDisplay || '')));
      acts.appendChild(linkBtn(waLink('EMERGENCY: enquiry ' + (res.reference || '') + ' (' + a.service + ', ' + a.postcode + ')'), 'abs-chat-btn--wa abs-chat-btn--lg', 'whatsapp', 'WhatsApp us', { rel: 'noopener', target: '_blank' }));
      card.appendChild(acts);
      card.appendChild(el('p', { class: 'abs-chat__small' }, 'If there is fire, smoke, an electric shock or any danger to life, call 999. If you smell gas, call 0800 111 999.'));
    } else if (a.urgency === 'Urgent') {
      card.appendChild(el('p', null, 'If you\'d like to talk to us sooner, you can call ' + (CFG.phoneDisplay || 'us') + ' or WhatsApp us.'));
    }
    if (res.filesSent && res.filesReceived < res.filesSent) {
      var missing = res.filesSent - res.filesReceived;
      var note = el('p', { class: 'abs-chat__small abs-chat__small--strong' }, 'We couldn\'t receive ' + missing + (missing === 1 ? ' of your files' : ' of your files') + '. Please send ' + (missing === 1 ? 'it' : 'them') + ' on WhatsApp with your reference. ');
      note.appendChild(el('a', { href: waLink('Photos for enquiry ' + (res.reference || '')), target: '_blank', rel: 'noopener' }, 'Open WhatsApp'));
      card.appendChild(note);
    }
    append(card);
  }

  // Shown only if automatic sending fails: the customer can still reach us.
  function renderFallback(box) {
    if (box.querySelector('.abs-chat__fallback')) return;
    var a = state.answers;
    var text = summaryText();
    var wrap = el('div', { class: 'abs-chat__actions abs-chat__actions--stack abs-chat__fallback' });
    wrap.appendChild(linkBtn(waLink(text), 'abs-chat-btn--wa', 'whatsapp', 'Send on WhatsApp instead', { rel: 'noopener', target: '_blank' }));
    var subject = (a.urgency === 'Planned' ? '' : a.urgency.toUpperCase() + ': ') + a.service + ' enquiry (' + a.postcode + ')';
    wrap.appendChild(linkBtn('mailto:' + (CFG.email || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text), 'abs-chat-btn--dark', 'mail', 'Send by email instead'));
    box.appendChild(wrap);
  }

  var turnstileLoading = null;
  function loadTurnstile(container) {
    if (!turnstileLoading) {
      turnstileLoading = new Promise(function (resolve) {
        window.absTurnstileReady = resolve;
        var sc = document.createElement('script');
        sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=absTurnstileReady';
        sc.async = true;
        document.head.appendChild(sc);
      });
    }
    turnstileLoading.then(function () {
      window.turnstile.render(container, { sitekey: AI.turnstileSiteKey, size: 'flexible', appearance: 'interaction-only' });
    });
  }

  /* ------------------------------------------------------ open / close */

  var lastFocus = null;
  function setOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    document.documentElement.classList.toggle('abs-chat-open', open);
    if (open) {
      lastFocus = document.activeElement;
      if (!log.childNodes.length) start();
      var f = dock.querySelector('input:not([type=file]), textarea, button, label');
      (f || closeBtn).focus();
    } else if (lastFocus && lastFocus.focus) {
      lastFocus.focus();
    } else {
      launcher.focus();
    }
  }

  function start() {
    var saved = restore();
    if (saved && saved.step && STEPS[saved.step] && saved.transcript && saved.transcript.length) {
      state = saved;
      state.transcript.forEach(function (m) { say(m.text, m.who, { tone: m.tone, replay: true }); });
      if (state.answers.urgency === 'Emergency' || state.notices.gasLeak || state.notices.danger) showUrgent();
      // Photos can't survive a page change; ask again rather than lose them silently.
      if (state.step !== 'service' && state.step !== 'done' && state.answers.photos && !files.length && state.step !== 'photos') {
        say(AUTO
          ? 'Welcome back. Your photos weren\'t kept when you changed page, so please add them again before you submit.'
          : 'Welcome back. Your photos weren\'t kept when you changed page, so please attach them when you send your message.', 'bot', { tone: 'info' });
      }
      // Re-show the current question's controls without repeating it in the chat.
      muted = true;
      STEPS[state.step]();
      muted = false;
      return;
    }
    go('service');
  }

  function restart() {
    forget();
    files = [];
    state = { step: 'service', answers: {}, transcript: [], notices: {}, ref: newRef(), result: null };
    while (log.firstChild) log.removeChild(log.firstChild);
    urgentBar.hidden = true;
    go('service');
  }

  launcher.addEventListener('click', function () { setOpen(panel.hidden); });
  closeBtn.addEventListener('click', function () { setOpen(false); });
  restartBtn.addEventListener('click', restart);
  panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-open-chat]');
    if (t) { e.preventDefault(); setOpen(true); }
  });
})();
