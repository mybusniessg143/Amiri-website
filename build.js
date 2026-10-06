#!/usr/bin/env node
/*
 * Amiri Building Services – static site builder.
 *
 * Zero dependencies: needs only Node.js (v18+).
 *
 *   node build.js           build the site into ./dist
 *   node build.js --serve   build, then preview at http://localhost:8080
 *
 * What it does:
 *   1. Reads site.config.json (business details), src/photos.json (your own work
 *      photos) and src/images.json (website images, swappable stock placeholders).
 *   2. Wraps every page in src/pages/ with the shared layout (header, footer,
 *      mobile contact bar) from src/layout.html and src/partials/.
 *   3. Replaces {{tokens}} with values from the config, so phone numbers, emails,
 *      areas etc. are typed in ONE place only.
 *   4. Generates JSON-LD structured data, sitemap.xml, robots.txt,
 *      site.webmanifest and assets/js/config.js.
 *   5. Copies /assets and /static into ./dist.
 *
 * Cloudflare Pages: build command `node build.js`, output directory `dist`.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const cfg = JSON.parse(read('site.config.json'));
const photos = JSON.parse(read('src/photos.json'));
const images = JSON.parse(read('src/images.json'));
const DOMAIN = cfg.domain.replace(/\/+$/, '');
const BUILD_DATE = new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ helpers */

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function waUrl(text) {
  const base = `https://wa.me/${cfg.whatsapp.number}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

function mailtoUrl(subject, body) {
  const params = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${cfg.email.public}${params.length ? '?' + params.join('&') : ''}`;
}

function listToSentence(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function icon(name, extraClass = '') {
  return `<svg class="icon${extraClass ? ' ' + extraClass : ''}" aria-hidden="true" focusable="false"><use href="/assets/icons/sprite.svg#${name}"></use></svg>`;
}

function hashFile(p) {
  return crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 10);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/* ------------------------------------------------------- photo placeholders */

function renderPhoto(key) {
  const p = photos[key];
  if (!p) throw new Error(`Unknown photo key "${key}" – add it to src/photos.json`);
  if (p.src) {
    const avif = p.avif ? `<source type="image/avif" srcset="${esc(p.avif)}">` : '';
    return `<figure class="photo"><picture>${avif}<img src="${esc(p.src)}" width="${p.width}" height="${p.height}" alt="${esc(p.alt)}" loading="lazy" decoding="async"></picture><figcaption>${esc(p.label)}</figcaption></figure>`;
  }
  return `<figure class="photo photo--placeholder">
  <div class="photo__ph" role="img" aria-label="Placeholder – a real photo of ${esc(p.label.toLowerCase())} will be added here">
    ${icon('camera')}
    <span class="photo__tag">Photo placeholder</span>
    <strong>${esc(p.label)}</strong>
    <small>Real photo of our own work to be added</small>
  </div>
  <figcaption>${esc(p.label)}</figcaption>
</figure>`;
}

/* ------------------------------------------------------------ site images */

// Website images live in src/images.json. Unsplash addresses get a responsive
// srcset automatically; a local file (/assets/images/...) is used as it is.
const IMG_WIDTHS = [480, 800, 1200, 1600, 2000];
const IMG_SIZES = {
  full: '100vw',
  half: '(min-width: 960px) 50vw, 100vw',
  card: '(min-width: 1180px) 300px, (min-width: 600px) 50vw, 100vw'
};

function renderImg(key, eager, sizeName) {
  const im = images[key];
  if (!im || key.startsWith('_')) throw new Error(`Unknown image key "${key}" – add it to src/images.json`);
  const sizes = IMG_SIZES[sizeName || 'half'];
  if (!sizes) throw new Error(`Unknown image size "${sizeName}" for image "${key}"`);
  const pos = im.position && im.position !== 'center' ? ` img--${esc(im.position)}` : '';
  const load = eager ? ' fetchpriority="high"' : ' loading="lazy"';
  let src = im.src;
  let srcset = '';
  if (/^https:\/\/images\.unsplash\.com\//.test(im.src)) {
    const base = im.src.split('?')[0];
    const url = (w) => `${base}?w=${w}&q=72&auto=format&fit=crop`;
    src = url(1200);
    srcset = ` srcset="${esc(IMG_WIDTHS.map((w) => `${url(w)} ${w}w`).join(', '))}" sizes="${sizes}"`;
  }
  return `<img class="media${pos}" src="${esc(src)}"${srcset} width="${im.width || 1600}" height="${im.height || 1067}" alt="${esc(im.alt || '')}"${load} decoding="async">`;
}

/* ------------------------------------------------------- computed HTML bits */

const NAV = [
  {
    label: 'Services',
    children: [
      { href: '/electrical/', label: 'Electrical', note: 'Faults, sockets, lighting, consumer units' },
      { href: '/plumbing/', label: 'Plumbing', note: 'Leaks, taps, toilets (non-gas)' },
      { href: '/property-maintenance/', label: 'Property Maintenance', note: 'Repairs and minor installations' },
      { href: '/emergency-electrician/', label: 'Emergency Electrician', note: 'Call to confirm availability' },
      { href: '/emergency-plumbing/', label: 'Emergency Plumbing', note: 'Call to confirm availability' }
    ]
  },
  { href: '/landlords-commercial/', label: 'Landlords &amp; Commercial' },
  { href: '/areas/', label: 'Areas' },
  { href: '/about/', label: 'About' },
  { href: '/contact/', label: 'Contact' }
];

function navHtml(currentPath) {
  const link = (item) => `<a href="${item.href}"${currentPath === item.href ? ' aria-current="page"' : ''}>${item.label}</a>`;
  return NAV.map((item) => {
    if (!item.children) return `<li>${link(item)}</li>`;
    const active = item.children.some((c) => c.href === currentPath);
    const kids = item.children
      .map((c) => `<li><a href="${c.href}"${currentPath === c.href ? ' aria-current="page"' : ''}><strong>${c.label}</strong><small>${c.note}</small></a></li>`)
      .join('');
    return `<li class="nav-drop${active ? ' is-active' : ''}"><button class="nav-drop__btn" type="button" aria-expanded="false" aria-controls="nav-services">${item.label}${icon('chevron')}</button><ul class="nav-drop__menu" id="nav-services">${kids}</ul></li>`;
  }).join('\n');
}

// Trust badges near the top of the homepage. "Fully Insured" stays hidden until the
// owner has public liability insurance in force and marks the insurance credential
// as verified in site.config.json; until then "Professional & Reliable" is shown.
function trustBadgesHtml() {
  const ins = cfg.credentials.find((c) => c.key === 'insurance');
  const badge = (ic, title, sub, cls = '') => `<li class="trust-badge${cls}">${icon(ic)}<span><strong>${title}</strong><small>${sub}</small></span></li>`;
  let first;
  if (ins && ins.verified) first = badge('shield', 'Fully Insured', 'Details available on request');
  else first = badge('check', 'Professional &amp; Reliable', 'Clear, tidy, careful work');
  return [
    first,
    badge('pin', 'Local West London Service', `Based in ${esc(cfg.baseTown)}`),
    badge('building', 'Residential &amp; Commercial', 'Homes, landlords &amp; businesses'),
    badge('alert', 'Emergency Call-Outs', 'Call to confirm availability')
  ].join('\n');
}

function credentialsHtml() {
  const items = cfg.credentials
    .map((c) => {
      if (c.verified && c.value) {
        return `<li class="cred cred--verified">${icon('shield')}<div><span class="cred__label">${esc(c.label)}</span><span class="cred__value">${esc(c.value)}</span></div></li>`;
      }
      if (!cfg.showPlaceholders) return '';
      return `<li class="cred cred--placeholder">${icon('file')}<div><span class="cred__label">${esc(c.label)}</span><span class="cred__value">Owner to add verified details</span></div></li>`;
    })
    .filter(Boolean);
  if (!items.length) return '';
  return `<ul class="creds" aria-label="Credentials">${items.join('\n')}</ul>`;
}

function reviewsHtml() {
  if (cfg.reviews.length) {
    const cards = cfg.reviews
      .map((r) => {
        const stars = r.rating ? `<p class="review__stars" aria-label="${r.rating} out of 5 stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</p>` : '';
        const date = r.date ? ` · <time datetime="${esc(r.date)}">${esc(new Date(r.date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))}</time>` : '';
        return `<li class="t-card">${stars}<blockquote><p>${esc(r.text)}</p></blockquote><div class="t-card__who"><span class="t-card__avatar" aria-hidden="true">${esc(String(r.author).charAt(0))}</span><p><strong>${esc(r.author)}</strong>${r.source ? esc(r.source) : ''}${date}</p></div></li>`;
      })
      .join('\n');
    return `<ul class="t-grid">${cards}</ul>`;
  }
  if (!cfg.showPlaceholders) return '<p class="muted">We are a new company and will show genuine customer reviews here as they come in.</p>';
  // Clearly labelled placeholders: no invented names, quotes, star ratings or counts.
  return `<ul class="t-grid">
${[1, 2, 3]
  .map(
    (n) => `<li class="t-card t-card--placeholder"><span class="photo__tag">Placeholder ${n} – not a real review</span><blockquote><p>A genuine customer review will appear here once customers have left one on Google.</p></blockquote><div class="t-card__who"><span class="t-card__avatar" aria-hidden="true">?</span><p><strong>Customer name</strong>Area · Google review</p></div></li>`
  )
  .join('\n')}
</ul>`;
}

function reviewCtaHtml() {
  if (cfg.googleReviewUrl) {
    return `<a class="btn btn--outline" href="${esc(cfg.googleReviewUrl)}" rel="noopener" target="_blank">${icon('star')}Leave an honest Google review<span class="visually-hidden"> (opens in a new tab)</span></a>`;
  }
  if (!cfg.showPlaceholders) return '';
  return `<span class="placeholder-note">Owner to add: Google review link (googleReviewUrl in site.config.json)</span>`;
}

function socialHtml() {
  const names = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' };
  const links = Object.entries(cfg.social)
    .filter(([k, v]) => v && names[k])
    .map(([k, v]) => `<li><a href="${esc(v)}" rel="noopener" target="_blank">${icon(k)}<span>${names[k]}</span><span class="visually-hidden"> (opens in a new tab)</span></a></li>`);
  if (links.length) return `<ul class="social">${links.join('')}</ul>`;
  if (!cfg.showPlaceholders) return '';
  return `<p class="placeholder-note">Social links (Instagram, Facebook, TikTok, YouTube) will be added once the accounts are set up.</p>`;
}

function gbpHtml() {
  if (cfg.googleBusinessProfileUrl) {
    return `<a href="${esc(cfg.googleBusinessProfileUrl)}" rel="noopener" target="_blank">Find us on Google<span class="visually-hidden"> (opens in a new tab)</span></a>`;
  }
  return cfg.showPlaceholders ? `<span class="placeholder-note">Google Business Profile link to be added</span>` : '';
}

function hoursHtml() {
  if (cfg.hours.confirmed && cfg.hours.displayText) return esc(cfg.hours.displayText);
  return esc(cfg.availability.generalText);
}

function faqHtml(faq) {
  if (!faq || !faq.length) return '';
  return `<div class="faq">${faq
    .map((f) => `<details class="faq__item"><summary>${esc(f.q)}</summary><div class="faq__a"><p>${esc(f.a)}</p></div></details>`)
    .join('\n')}</div>`;
}

function breadcrumbsHtml(page) {
  if (page.path === '/' || !page.breadcrumb) return '';
  const trail = [{ name: 'Home', path: '/' }].concat(page.breadcrumbParent ? [page.breadcrumbParent] : []);
  return `<nav class="breadcrumbs container" aria-label="Breadcrumb"><ol>${trail
    .map((t) => `<li><a href="${t.path}">${esc(t.name)}</a></li>`)
    .join('')}<li><span aria-current="page">${esc(page.breadcrumb)}</span></li></ol></nav>`;
}

/* ------------------------------------------------------------ structured data */

const SERVICES = {
  electrical: [
    'Electrical fault finding', 'Emergency electrical call-outs', 'Power faults', 'Tripping circuits',
    'Socket installation and replacement', 'Switch installation and replacement', 'Lighting installation',
    'Downlights', 'Emergency lighting', 'Consumer unit work', 'Electrical repairs',
    'First fix and second fix electrical work', 'Domestic electrical work', 'Commercial electrical work',
    'Shop and small commercial installations'
  ],
  plumbing: [
    'Emergency water leaks', 'Accessible pipe leaks', 'Tap repairs and replacements', 'Toilet repairs',
    'Cistern problems', 'Isolation valves', 'Traps and waste pipes', 'Washing machine connections',
    'Dishwasher connections', 'Sink plumbing', 'General non-gas plumbing repairs'
  ],
  maintenance: [
    'General property repairs', 'Handyman work', 'Minor installation work', 'Property maintenance',
    'Repairs for landlords', 'Repairs for letting agents', 'Commercial property maintenance'
  ]
};

function businessJsonLd() {
  const sameAs = Object.values(cfg.social).filter(Boolean);
  if (cfg.googleBusinessProfileUrl) sameAs.push(cfg.googleBusinessProfileUrl);
  const catalog = (name, list) => ({
    '@type': 'OfferCatalog',
    name,
    itemListElement: list.map((s) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s } }))
  });
  const b = {
    '@context': 'https://schema.org',
    '@type': ['Electrician', 'Plumber'],
    '@id': `${DOMAIN}/#business`,
    name: cfg.tradingName,
    legalName: cfg.legalName,
    url: `${DOMAIN}/`,
    telephone: cfg.phone.international,
    email: cfg.email.public,
    logo: DOMAIN + cfg.logo.src,
    image: DOMAIN + cfg.ogImage,
    description:
      'Electrical work, non-gas plumbing repairs and property maintenance for homes, landlords, letting agents and small commercial premises in West Drayton and West London.',
    identifier: { '@type': 'PropertyValue', propertyID: 'Companies House company number', value: cfg.companyNumber },
    address: { '@type': 'PostalAddress', addressLocality: cfg.baseTown, addressRegion: 'Greater London', addressCountry: 'GB' },
    areaServed: cfg.areas.core.concat(cfg.areas.secondary).map((n) => ({ '@type': 'Place', name: n })),
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Building services',
      itemListElement: [
        catalog('Electrical services', SERVICES.electrical),
        catalog('Plumbing services (non-gas)', SERVICES.plumbing),
        catalog('Property maintenance', SERVICES.maintenance)
      ]
    }
  };
  if (sameAs.length) b.sameAs = sameAs;
  if (cfg.hours.confirmed && cfg.hours.openingHoursSpecification.length) {
    b.openingHoursSpecification = cfg.hours.openingHoursSpecification.map((h) => ({ '@type': 'OpeningHoursSpecification', ...h }));
  }
  // Deliberately NO aggregateRating / review / award fields: only genuine data.
  return b;
}

function pageJsonLd(page) {
  const blocks = [businessJsonLd()];
  if (page.path === '/') {
    blocks.push({ '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${DOMAIN}/#website`, url: `${DOMAIN}/`, name: cfg.tradingName, inLanguage: 'en-GB', publisher: { '@id': `${DOMAIN}/#business` } });
  }
  if (page.service) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: page.service.name,
      serviceType: page.service.serviceType || page.service.name,
      description: page.service.description || page.description,
      url: DOMAIN + page.path,
      provider: { '@id': `${DOMAIN}/#business` },
      areaServed: cfg.areas.core.concat(cfg.areas.secondary).map((n) => ({ '@type': 'Place', name: n }))
    });
  }
  if (page.path !== '/' && page.breadcrumb) {
    const trail = [{ name: 'Home', path: '/' }].concat(page.breadcrumbParent ? [page.breadcrumbParent] : [], [{ name: page.breadcrumb, path: page.path }]);
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: DOMAIN + t.path }))
    });
  }
  if (page.faq && page.faq.length) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: page.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
    });
  }
  return blocks
    .map((b) => `<script type="application/ld+json">${JSON.stringify(b).replace(/</g, '\\u003c')}</script>`)
    .join('\n');
}

/* ------------------------------------------------------------- templating */

const partialCache = {};
function partial(name) {
  if (!partialCache[name]) partialCache[name] = fs.readFileSync(path.join(SRC, 'partials', `${name}.html`), 'utf8');
  return partialCache[name];
}

function render(tpl, ctx, file) {
  // 1. partials (recursive)
  let out = tpl;
  for (let i = 0; i < 10 && /\{\{>\s*[\w-]+\s*\}\}/.test(out); i++) {
    out = out.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, n) => partial(n));
  }
  // 2. helpers. {{#placeholders}}...{{/placeholders}} only shows while showPlaceholders is true.
  out = out
    .replace(/\{\{#placeholders\}\}([\s\S]*?)\{\{\/placeholders\}\}/g, (_, inner) => (cfg.showPlaceholders ? inner : ''))
    .replace(/\{\{photo\s+([\w-]+)\s*\}\}/g, (_, k) => renderPhoto(k))
    .replace(/\{\{img(!?)\s+([\w-]+)(?:\s+(\w+))?\s*\}\}/g, (_, eager, k, size) => renderImg(k, Boolean(eager), size))
    .replace(/\{\{icon\s+([\w-]+)\s*\}\}/g, (_, k) => icon(k))
    .replace(/\{\{wa:([^}]*)\}\}/g, (_, t) => esc(waUrl(t.trim())))
    .replace(/\{\{mail:([^|}]*)(?:\|([^}]*))?\}\}/g, (_, s, b) => esc(mailtoUrl(s.trim(), (b || '').trim())));
  // 3. values. html.* is inserted raw; everything else is escaped.
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = getPath(ctx, key);
    if (v === undefined || v === null) throw new Error(`${file}: unknown token {{${key}}}`);
    return key.startsWith('html.') ? String(v) : esc(v);
  });
  return out;
}

function parsePage(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^<!--page\s*([\s\S]*?)-->\s*/);
  if (!m) throw new Error(`${file}: missing <!--page {...} --> header`);
  let meta;
  try {
    meta = JSON.parse(m[1]);
  } catch (e) {
    throw new Error(`${file}: invalid JSON in page header – ${e.message}`);
  }
  return { meta, body: raw.slice(m[0].length) };
}

/* ------------------------------------------------------------------ build */

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  copyDir(path.join(ROOT, 'assets'), path.join(OUT, 'assets'));
  copyDir(path.join(ROOT, 'static'), OUT);

  // Public, non-secret runtime config for the browser.
  const browserCfg = {
    tradingName: cfg.tradingName,
    phoneTel: cfg.phone.tel,
    phoneDisplay: cfg.phone.display,
    whatsappNumber: cfg.whatsapp.number,
    email: cfg.email.public,
    AI_CHAT_ENABLED: Boolean(cfg.aiChat.enabled),
    aiChatEndpoint: cfg.aiChat.endpoint
  };
  fs.writeFileSync(
    path.join(OUT, 'assets/js/config.js'),
    `/* Generated by build.js from site.config.json – do not edit here. Never put secrets in this file. */\nwindow.SITE_CONFIG = Object.freeze(${JSON.stringify(browserCfg, null, 2)});\n`
  );

  const versions = {
    css: hashFile(path.join(OUT, 'assets/css/styles.css')),
    js: hashFile(path.join(OUT, 'assets/js/main.js')),
    cfg: hashFile(path.join(OUT, 'assets/js/config.js')),
    chat: hashFile(path.join(OUT, 'assets/js/chat.js'))
  };

  const layout = fs.readFileSync(path.join(SRC, 'layout.html'), 'utf8');
  const pageFiles = fs.readdirSync(path.join(SRC, 'pages')).filter((f) => f.endsWith('.html')).sort();
  const sitemap = [];

  const shared = {
    areasInline: esc(listToSentence(cfg.areas.core)),
    secondaryInline: esc(listToSentence(cfg.areas.secondary)),
    areasCoreList: cfg.areas.core.map((a) => `<li>${icon('pin')}${esc(a)}</li>`).join(''),
    areasSecondaryList: cfg.areas.secondary.map((a) => `<li>${esc(a)}</li>`).join(''),
    credentials: credentialsHtml(),
    reviews: reviewsHtml(),
    reviewCta: reviewCtaHtml(),
    social: socialHtml(),
    gbp: gbpHtml(),
    hours: hoursHtml(),
    registeredOffice: cfg.registeredOffice.lines.map(esc).join('<br>'),
    jurisdictionFlag:
      !cfg.jurisdictionVerified && cfg.showPlaceholders
        ? ' <span class="placeholder-note">(jurisdiction to be verified by owner before launch)</span>'
        : '',
    chat: cfg.aiChat.enabled ? `<script src="/assets/js/chat.js?v=${versions.chat}" defer></script>` : '',
    analytics: cfg.analytics.cloudflareWebAnalyticsToken
      ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${esc(cfg.analytics.cloudflareWebAnalyticsToken)}"}'></script>`
      : '',
    trustBadges: trustBadgesHtml(),
    year: String(new Date().getFullYear()),
    preconnect: Object.values(images).some((im) => im && /^https:\/\/images\.unsplash\.com\//.test(im.src || ''))
      ? '<link rel="preconnect" href="https://images.unsplash.com">'
      : ''
  };

  for (const f of pageFiles) {
    const { meta, body } = parsePage(path.join(SRC, 'pages', f));
    const page = {
      bodyClass: '',
      waText: 'Hello Amiri Building Services, I would like to ask about a job. My postcode is: ',
      formCategory: '',
      ogType: 'website',
      robots: meta.noindex ? 'noindex, follow' : 'index, follow',
      ...meta
    };
    page.canonical = DOMAIN + (page.path === '/404.html' ? '/404.html' : page.path);
    page.waUrl = waUrl(page.waText);
    // 'Get a quote' goes to the form on this page, or to the contact page if there isn't one.
    page.quoteUrl = body.includes('{{> enquiry-form}}') ? '#enquiry' : '/contact/#enquiry';
    page.ogImage = DOMAIN + cfg.ogImage;

    const ctx = {
      ...cfg,
      page,
      v: versions,
      html: {
        ...shared,
        nav: navHtml(page.path),
        breadcrumbs: breadcrumbsHtml(page),
        faq: faqHtml(page.faq),
        jsonld: page.noindex ? '' : pageJsonLd(page),
        content: ''
      }
    };
    ctx.html.content = render(body, ctx, f);
    const html = render(layout, ctx, 'layout.html');
    if (/\{\{/.test(html)) throw new Error(`${f}: unresolved {{ token left in output`);

    const outFile = page.path.endsWith('/') ? path.join(OUT, page.path, 'index.html') : path.join(OUT, page.path);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, html);
    if (!page.noindex) sitemap.push({ loc: DOMAIN + page.path, priority: page.priority || 0.5, changefreq: page.changefreq || 'monthly' });
  }

  sitemap.sort((a, b) => b.priority - a.priority);
  fs.writeFileSync(
    path.join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap
      .map((s) => `  <url>\n    <loc>${s.loc}</loc>\n    <lastmod>${BUILD_DATE}</lastmod>\n    <changefreq>${s.changefreq}</changefreq>\n    <priority>${s.priority.toFixed(1)}</priority>\n  </url>`)
      .join('\n')}\n</urlset>\n`
  );
  fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${DOMAIN}/sitemap.xml\n`);
  fs.writeFileSync(
    path.join(OUT, 'site.webmanifest'),
    JSON.stringify(
      {
        name: cfg.tradingName,
        short_name: 'Amiri',
        description: `${cfg.tagline} – ${cfg.regionLabel}`,
        start_url: '/',
        display: 'browser',
        background_color: '#faf7f2',
        theme_color: '#16191e',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      null,
      2
    ) + '\n'
  );

  console.log(`Built ${pageFiles.length} pages into ${path.relative(ROOT, OUT)}/`);
}

/* ------------------------------------------------------------ preview server */

function serve(port = 8080) {
  const http = require('http');
  const types = { '.woff2': 'font/woff2', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.avif': 'image/avif', '.jpg': 'image/jpeg', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };
  http
    .createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      let file = path.join(OUT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (!fs.existsSync(file) && fs.existsSync(file + '/index.html')) file += '/index.html';
      if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'content-type': types['.html'] });
        return res.end(fs.readFileSync(path.join(OUT, '404.html')));
      }
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    })
    .listen(port, () => console.log(`Preview: http://localhost:${port}  (Ctrl+C to stop)`));
}

try {
  build();
  if (process.argv.includes('--serve')) serve(Number(process.env.PORT) || 8080);
} catch (err) {
  console.error(`\nBuild failed: ${err.message}\n`);
  process.exit(1);
}
