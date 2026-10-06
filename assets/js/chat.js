/*
 * Website chat UI for the future AI receptionist.
 *
 * This file is ONLY loaded when aiChat.enabled = true in site.config.json
 * (AI_CHAT_ENABLED). Keep it false until the secure back end described in
 * AI_RECEPTIONIST_PLAN.md is live and tested.
 *
 * SECURITY: this file never talks to Claude, OpenAI, Meta or Google directly
 * and must never contain an API key. It only POSTs to our own endpoint
 * (default /api/chat, a Cloudflare Pages Function), which holds the secrets.
 *
 * Expected endpoint contract:
 *   POST { sessionId, message, page }  ->  200 { reply: string, handoff?: boolean }
 */
(function () {
  'use strict';
  var CFG = window.SITE_CONFIG || {};
  if (!CFG.AI_CHAT_ENABLED) return;

  var sessionId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  var busy = false;

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text) e.textContent = text;
    return e;
  }

  var launcher = el('button', { type: 'button', class: 'chat-launcher', 'aria-expanded': 'false', 'aria-controls': 'chat-panel' }, 'Chat with us');
  var panel = el('section', { id: 'chat-panel', class: 'chat-panel', 'aria-labelledby': 'chat-title', hidden: '' });
  var head = el('div', { class: 'chat-panel__head' });
  head.appendChild(el('h2', { id: 'chat-title' }, 'Amiri Building Services'));
  var close = el('button', { type: 'button', 'aria-label': 'Close chat' }, '✕');
  head.appendChild(close);
  var notice = el('p', { class: 'chat-panel__notice' },
    'You are chatting with an automated assistant. It can take job details and answer basic questions. It cannot confirm prices or bookings – a person will follow up. For emergencies, call ' + (CFG.phoneDisplay || '') + '. See our privacy notice.');
  var log = el('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
  var form = el('form', { class: 'chat-form' });
  var label = el('label', { for: 'chat-input', class: 'visually-hidden' }, 'Your message');
  var input = el('input', { id: 'chat-input', type: 'text', maxlength: '800', autocomplete: 'off' });
  var send = el('button', { type: 'submit', class: 'btn btn--primary btn--sm' }, 'Send');
  form.appendChild(label); form.appendChild(input); form.appendChild(send);
  [head, notice, log, form].forEach(function (n) { panel.appendChild(n); });
  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  function add(text, who) {
    log.appendChild(el('p', { class: 'chat-msg chat-msg--' + who }, text));
    log.scrollTop = log.scrollHeight;
  }

  function setOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      if (!log.childNodes.length) add('Hello – what can we help with today? Tell us the problem and your postcode.', 'bot');
      input.focus();
    } else {
      launcher.focus();
    }
  }
  launcher.addEventListener('click', function () { setOpen(panel.hidden); });
  close.addEventListener('click', function () { setOpen(false); });
  panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = input.value.trim();
    if (!msg || busy) return;
    add(msg, 'user');
    input.value = '';
    busy = true;
    send.disabled = true;
    fetch(CFG.aiChatEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, message: msg, page: location.pathname })
    })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) { add(String(data.reply || ''), 'bot'); })
      .catch(function () {
        add('Sorry, the chat is not available right now. Please call ' + (CFG.phoneDisplay || '') + ' or send us a WhatsApp message.', 'bot');
      })
      .then(function () { busy = false; send.disabled = false; });
  });
})();
