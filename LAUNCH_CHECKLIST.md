# Launch checklist

Work through this before pointing amiribuildingservices.com at the new site. Test on the free `*.pages.dev` address first.

## Content you must supply or confirm
- [ ] Upload the final logo and replace favicons and the social share image (README §6)
- [ ] Replace placeholder photos with real photos of your own work (`src/photos.json`, README §5)
- [ ] Verify legal company details: AMIRI BUILDING SERVICES LTD, company no. 17472711, registered office (check against Companies House)
- [ ] **Verify registered jurisdiction (England and Wales)**, then set `jurisdictionVerified: true` in site.config.json
- [ ] Verify service areas (`areas` in site.config.json) and the local text on /areas/
- [ ] Verify phone number 07438 635942
- [ ] Verify email info@amiribuildingservices.com receives mail
- [ ] Confirm business hours (or leave `hours.confirmed: false`)
- [ ] Confirm qualifications. Add to `credentials` only what you can evidence
- [ ] Confirm insurance wording (insurer, cover level). Only add if the policy is in force
- [ ] Confirm years of experience / ECS card / accreditations, or leave unverified
- [ ] Confirm call-out pricing and complete or remove Terms section 5
- [ ] Remove all placeholder reviews (they disappear automatically when `showPlaceholders` is `false`; add only genuine reviews)
- [ ] Add the Google review link (`googleReviewUrl`) and Google Business Profile link
- [ ] Add social links once accounts exist
- [ ] Write your own short story on the About page (placeholder note in `src/pages/about.html`)
- [ ] Read every page and check you are happy with all wording and promises, especially "How we work" (About), "Why customers call us" (Home), the pricing FAQ, and "Clear records for every job" (Landlords page)
- [ ] Review Privacy notice and Terms with PRIVACY_REVIEW_CHECKLIST.md; update the "Last updated" dates
- [ ] Set `showPlaceholders: false` and rebuild; check no yellow "owner to add" boxes remain

## Testing
- [ ] Check mobile layout on a real phone (iPhone and Android if possible)
- [ ] Test the Call button (opens the dialler with 07438 635942)
- [ ] Test the WhatsApp button (opens a chat with the business number and pre-filled text)
- [ ] Test the enquiry form: errors show for empty fields; WhatsApp message is correctly filled; "Send by email instead" works
- [ ] Test "Send photos on WhatsApp"
- [ ] Test email links (open the email app addressed to info@)
- [ ] Test the sticky mobile bar on every page
- [ ] Test every page and every menu link; test the mobile menu
- [ ] Test the 404 page (visit /does-not-exist)
- [ ] Keyboard-only test: Tab through a page; focus is always visible; menu works with Enter/Escape
- [ ] Run accessibility checks (Lighthouse Accessibility, or wave.webaim.org)
- [ ] Run performance tests (pagespeed.web.dev on mobile, aim for 90+ in all categories)
- [ ] Validate structured data (search.google.com/test/rich-results and validator.schema.org)
- [ ] Check https://amiribuildingservices.com/sitemap.xml and /robots.txt load
- [ ] Check security headers (securityheaders.com)
- [ ] Share a page link in WhatsApp to check the preview image and title

## Domain, DNS and email
- [ ] Follow DNS_MIGRATION_CHECKLIST.md in full
- [ ] Preserve Google Workspace DNS/MX records
- [ ] Check SPF (one `v=spf1` record including Google)
- [ ] Check DKIM (Google Admin → Gmail → Authenticate email shows "Authenticating email")
- [ ] Check DMARC (`_dmarc` record present; consider adding if missing)
- [ ] Test Gmail sending and receiving after any DNS change (info@ and waris@)
- [ ] HTTPS works on root and www; www redirects to root

## Google and analytics
- [ ] Connect Google Search Console (Domain property)
- [ ] Submit the sitemap
- [ ] Link the website to your Google Business Profile (service-area business; keep the home address hidden)
- [ ] Enable Cloudflare Web Analytics
- [ ] Confirm no other tracking scripts were added

## After launch
- [ ] Ask happy customers for honest Google reviews
- [ ] Add new job photos regularly
- [ ] Review Search Console monthly for errors
- [ ] Keep `AI_CHAT_ENABLED` (`aiChat.enabled`) false until the back end in AI_RECEPTIONIST_PLAN.md is built and tested
