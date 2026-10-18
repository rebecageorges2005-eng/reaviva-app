# Reaviva API — Backend (Phase 1 MVP)

Node.js + Express + SQLite (`node:sqlite`, zero-config, file-based). Serves the frontend SPA from `../web` in production.

**Pagos: PayPal Subscriptions.** (Stripe fue evaluado y descartado en oct 2026: la cuenta Stripe USA no se puede activar sin Social Security Number.)

## Quick start

```bash
cd ~/workspace/reaviva-app/api
npm install
cp .env.example .env     # then fill in real values (see below)
npm start                # http://localhost:3000
# dev mode with auto-reload:
npm run dev
```

Requires **Node ≥ 22.5** (uses built-in `node:sqlite` — no native compilation — and global `fetch` for PayPal calls).

## Environment variables (`.env`)

| Var | Required | Description |
|---|---|---|
| `PORT` | no | Default `3000` |
| `JWT_SECRET` | **yes** | Long random string for signing login tokens |
| `FRONTEND_DIR` | no | Default `../web` — static files served by the API |
| `TRUST_PROXY` | no | Set `true` when deployed behind a proxy (Render/Railway) |
| `PAYPAL_MODE` | for payments | `sandbox` (pruebas) o `live` (cobros reales) |
| `PAYPAL_CLIENT_ID` | for payments | From developer.paypal.com → Apps & Credentials |
| `PAYPAL_CLIENT_SECRET` | for payments | From developer.paypal.com → Apps & Credentials |
| `PAYPAL_PLAN_MONTHLY` | for payments | Plan ID (`P-…`) de **$4.99 USD / mes** recurrente |
| `PAYPAL_PLAN_YEARLY` | for payments | Plan ID (`P-…`) de **$39.99 USD / año** recurrente |
| `PAYPAL_WEBHOOK_ID` | for payments | ID del webhook (verifica las firmas de PayPal) |
| `APP_URL` | for payments | Public URL of this server, e.g. `https://reaviva.tudominio.com` |

**Nothing is hardcoded.** Without the PayPal vars, `/api/paypal/*` returns `503` and the server logs a warning — everything else works.

## Pagos con PayPal — lo que Georges debe hacer

Todo en [developer.paypal.com](https://developer.paypal.com) (entra con su cuenta PayPal: `joshuageorges16@gmail.com`).

**Paso 1 — Crear la app (sandbox):**
1. Dashboard → asegúrate de estar en modo **Sandbox** (arriba a la derecha).
2. *Apps & Credentials* → **Create App** → nombre: `Reaviva` → Create.
3. Copia el **Client ID** y el **Secret** → pégalos en `.env` como `PAYPAL_CLIENT_ID` y `PAYPAL_CLIENT_SECRET`.

**Paso 2 — Crear el producto y los 2 planes:**
Pásale el Client ID + Secret a Muse y él los crea con la API de PayPal, o créalos manualmente:
- Producto: `Reaviva` (categoría: bienestar / digital goods).
- Plan 1: **$4.99 USD / mes** recurrente → copia su ID (`P-…`) → `PAYPAL_PLAN_MONTHLY`.
- Plan 2: **$39.99 USD / año** recurrente → copia su ID (`P-…`) → `PAYPAL_PLAN_YEARLY`.

**Paso 3 — Webhook (sandbox):**
1. Dashboard → *Webhooks* → **Add Webhook** (sandbox).
2. URL: `https://TU-DOMINIO/api/paypal/webhook`
3. Marca estos eventos:
   - `BILLING.SUBSCRIPTION.ACTIVATED`
   - `BILLING.SUBSCRIPTION.CANCELLED`
   - `BILLING.SUBSCRIPTION.SUSPENDED`
   - `BILLING.SUBSCRIPTION.EXPIRED`
   - `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
4. Copia el **Webhook ID** → `PAYPAL_WEBHOOK_ID` en `.env`.

**Paso 4 — Probar:** con `PAYPAL_MODE=sandbox`, usa una cuenta sandbox de comprador (Dashboard → *Accounts* → crea una *Personal* con saldo) para aprobar una suscripción de prueba.

**Paso 5 — Cobros reales:** repite los pasos 1–3 en modo **Live** (nueva app, nuevos planes, nuevo webhook) y cambia `PAYPAL_MODE=live` + las credenciales live en el servidor de producción.

## API reference

All `/api/*` (except auth + PayPal public endpoints + webhook) need `Authorization: Bearer <token>`.

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/signup` | `{name, email, password}` (min 8 chars) | → `{token, user}` |
| POST | `/api/auth/login` | `{email, password}` | → `{token, user}` |
| GET | `/api/me` | — | Current user incl. `subscribed` |
| GET | `/api/progress` | — | `{programStart, doneDays[], currentDay}` |
| POST | `/api/progress` | `{day: 1–30, done: true}` | Mark/unmark a day |
| GET | `/api/journal` | — | `{entries: {"YYYY-MM-DD": {mood, text}}}` |
| POST | `/api/journal` | `{date?, mood, text}` | Upsert (defaults to today) |
| DELETE | `/api/journal/:date` | — | Delete one entry |
| GET | `/api/paypal/plans` | — | `{mode, monthly, yearly}` — 503 si no configurado |
| POST | `/api/paypal/create-subscription` | `{plan: "monthly"\|"yearly", email}` | → `{id, approveUrl}` (redirigir al comprador) |
| GET | `/api/paypal/status` | `?email=…` | → `{subscribed}` según PayPal |
| POST | `/api/paypal/webhook` | raw PayPal event | Verifica firma; actualiza `subscribed` |
| GET | `/api/health` | — | `{ok, paypal: bool, time}` |

Flujo de pago (frontend `web/app.js`): `startCheckout(plan)` → `POST /api/paypal/create-subscription` → `window.location = approveUrl` → el comprador aprueba en PayPal → vuelve a `/?paypal=ok#app` → el frontend consulta `/api/paypal/status` y desbloquea. El webhook es la fuente de verdad (marca `subscribed` en `paypal_subscriptions` y en `users`).

## Database

SQLite file `reaviva.db` (created on first run, git-ignored). Tables:
- `users` (bcrypt password hash, `subscribed` flag, `paypal_subscription_id`)
- `paypal_subscriptions` (email PK, subscription_id, plan, status, updated_at) — fuente de verdad de pagos
- `progress` (user_id, day), `journal` (user_id, date, mood, text)

## Deploy notes

- Any host that runs Node 22+: `npm install && npm start`. Set env vars in the host's dashboard.
- `APP_URL` must be the public HTTPS URL or PayPal return links + webhook break.
- The same process serves API + frontend, so one deployment is enough for Phase 1.
