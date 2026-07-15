/**
 * POST /api/webhook
 * Receives orders/paid webhook from Shopify White stores.
 * Verifies HMAC-SHA256, inserts order into Neon DB.
 * Port direto de shopify-webhook.php → Node.js ESM.
 */

import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';

// Disable body parser — precisamos do raw body para o HMAC
export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(400).json({ error: 'bad request' });

  const raw    = await rawBody(req);
  const hmacH  = req.headers['x-shopify-hmac-sha256'] ?? '';
  const domain = req.headers['x-shopify-shop-domain'] ?? '';
  const topic  = req.headers['x-shopify-topic'] ?? '';

  if (!raw.length || !domain || !hmacH) {
    return res.status(400).json({ error: 'missing required headers' });
  }

  const sql = neon(process.env.DATABASE_URL);
  await ensureTables(sql);

  // Busca o client_secret da loja registada
  const stores = await sql`
    SELECT codigo, client_secret FROM shopify_stores
    WHERE shop_domain = ${domain} LIMIT 1
  `;
  const store = stores[0];

  if (!store?.client_secret) {
    return res.status(401).json({ error: 'unknown shop' });
  }

  // Verificação HMAC — base64(HMAC-SHA256(rawBody, client_secret))
  const calc = crypto.createHmac('sha256', store.client_secret)
    .update(raw).digest('base64');

  if (!crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hmacH))) {
    return res.status(401).json({ error: 'invalid hmac' });
  }

  // Resposta 200 imediata — Shopify exige resposta em < 5s
  res.status(200).json({ ok: true });

  if (!topic.toLowerCase().includes('orders')) return;

  const o = JSON.parse(raw.toString('utf8'));
  if (!o?.id) return;

  // Idempotência — transaction_id único por loja+pedido
  const txid = `SH-${store.codigo}-${o.id}`;
  const exists = await sql`
    SELECT id FROM orders WHERE transaction_id = ${txid} LIMIT 1
  `;
  if (exists[0]) return; // já registado

  // --- Mapeamento de campos Shopify → orders ---
  const cust  = o.customer ?? {};
  const ship  = o.shipping_address ?? o.billing_address ?? {};
  const fname = cust.first_name ?? ship.first_name ?? '';
  const lname = cust.last_name  ?? ship.last_name  ?? '';
  const name  = `${fname} ${lname}`.trim();
  const email = o.email ?? o.contact_email ?? cust.email ?? '';
  const phone = o.phone ?? ship.phone ?? cust.phone ?? '';
  const amount = parseFloat(o.total_price ?? 0);

  const titles = (o.line_items ?? []).map(li => {
    let t = li.title ?? '';
    if (li.variant_title) t += ` — ${li.variant_title}`;
    return t;
  }).filter(Boolean);
  const productTitle = titles.join(' + ');

  // UTMs: note_attributes → fallback para landing_site query string
  const utm = { source: '', medium: '', campaign: '' };
  for (const na of (o.note_attributes ?? [])) {
    const k = (na.name ?? '').toLowerCase();
    if (k === 'utm_source')   utm.source   = na.value ?? '';
    if (k === 'utm_medium')   utm.medium   = na.value ?? '';
    if (k === 'utm_campaign') utm.campaign = na.value ?? '';
  }
  const landing = o.landing_site ?? '';
  if ((!utm.source || !utm.medium) && landing.includes('?')) {
    try {
      const q = Object.fromEntries(new URL(`https://x.com${landing}`).searchParams);
      utm.source   ||= q.utm_source   ?? '';
      utm.medium   ||= q.utm_medium   ?? '';
      utm.campaign ||= q.utm_campaign ?? '';
    } catch (_) { /* URL parse failed — skip */ }
  }

  const createdAt  = o.created_at ? new Date(o.created_at).toISOString() : new Date().toISOString();
  const checkoutId = o.checkout_id?.toString() ?? null;

  await sql`
    INSERT INTO orders (
      transaction_id, status,
      customer_name, customer_email, customer_phone,
      product_title, amount,
      street, postal_code, city, district,
      shop_domain, shopify_checkout_id,
      utm_source, utm_medium, utm_campaign,
      completed_at, created_at
    ) VALUES (
      ${txid}, 'completed',
      ${name}, ${email}, ${phone},
      ${productTitle}, ${amount},
      ${ship.address1 ?? ''}, ${ship.zip ?? ''}, ${ship.city ?? ''}, ${ship.province ?? ''},
      ${domain}, ${checkoutId},
      ${utm.source}, ${utm.medium}, ${utm.campaign},
      NOW(), ${createdAt}
    )
    ON CONFLICT (transaction_id) DO NOTHING
  `;
}

// --- Schema bootstrap (cria tabelas se não existirem) ---
async function ensureTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS shopify_stores (
      id           SERIAL PRIMARY KEY,
      shop_domain  TEXT UNIQUE NOT NULL,
      client_secret TEXT NOT NULL,
      codigo       TEXT NOT NULL,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id                   SERIAL PRIMARY KEY,
      transaction_id       TEXT UNIQUE NOT NULL,
      status               TEXT DEFAULT 'completed',
      customer_name        TEXT,
      customer_email       TEXT,
      customer_phone       TEXT,
      product_title        TEXT,
      amount               DECIMAL(10,2),
      street               TEXT,
      postal_code          TEXT,
      city                 TEXT,
      district             TEXT,
      shop_domain          TEXT,
      shopify_checkout_id  TEXT,
      utm_source           TEXT,
      utm_medium           TEXT,
      utm_campaign         TEXT,
      raffle_code          TEXT,
      completed_at         TIMESTAMPTZ DEFAULT NOW(),
      created_at           TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS session_intents (
      id          SERIAL PRIMARY KEY,
      session_id  TEXT UNIQUE NOT NULL,
      draw_id     TEXT NOT NULL,
      tier        TEXT NOT NULL,
      entries     INTEGER NOT NULL,
      status      TEXT DEFAULT 'pending',
      order_id    TEXT,
      raffle_code TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}
