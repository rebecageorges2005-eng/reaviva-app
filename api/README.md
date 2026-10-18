/* Reaviva — Phase 1 MVP web app
 * Static site, no build step. Entry: index.html
 *
 * STRUCTURE
 *  index.html   — landing + app shell (SPA views)
 *  styles.css   — design system (warm, calming, mobile-first)
 *  program.js   — 30-day program content (condensed from the guide)
 *  app.js       — routing, auth placeholder, journal, progress, PayPal checkout
 *
 * WHAT'S REAL vs PLACEHOLDER
 *  REAL:
 *   - Landing page (ES, secular, mobile-first)
 *   - 30-day program content with progressive unlock (localStorage)
 *   - Emotional journal: mood check-in + free text, saved per-date in localStorage
 *   - Progress: day completion, streak, % complete, month calendar
 *   - Freemium gate: days 1-7 free, days 8-30 locked behind paywall UI
 *  PLACEHOLDER:
 *   - Auth: email stored in localStorage only (no backend). See app.js AUTH section.
 *   - Payments: via backend /api/paypal/* (PayPal Subscriptions).
 *     startCheckout(plan) creates the subscription server-side and redirects
 *     the buyer to PayPal; on return (?paypal=ok) the app refreshes
 *     /api/paypal/status. Without PayPal credentials the buttons show
 *     "Pagos próximamente". (Stripe was removed: no US SSN to activate it.)
 *   - Testimonials: placeholder quotes on landing (marked as such in HTML comments).
 *   - No server: all data lives in the visitor's browser (localStorage).
 *
 * PREVIEW
 *  cd ~/workspace/reaviva-app/web && python3 -m http.server 8080
 *  then open http://localhost:8080  (or just open index.html in a browser;
 *  localStorage works from file:// in most browsers but a local server is safer)
 */
