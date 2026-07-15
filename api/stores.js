/**
 * GET    /api/stores         — lista todas as lojas registadas
 * POST   /api/stores         — adiciona/actualiza loja { shop_domain, client_secret, codigo }
 * DELETE /api/stores         — remove loja { shop_domain }
 */

import { neon } from '@neondatabase/serverless';

function auth(req, res) {
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!auth(req, res)) return;

  const sql = neon(process.env.DATABASE_URL);
  await ensureTables(sql);

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, shop_domain, codigo, created_at FROM shopify_stores ORDER BY id
    `;
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    const { shop_domain, client_secret, codigo } = req.body ?? {};
    if (!shop_domain || !client_secret || !codigo) {
      return res.status(400).json({ error: 'shop_domain, client_secret e codigo são obrigatórios' });
    }
    await sql`
      INSERT INTO shopify_stores (shop_domain, client_secret, codigo)
      VALUES (${shop_domain}, ${client_secret}, ${codigo})
      ON CONFLICT (shop_domain)
      DO UPDATE SET client_secret = EXCLUDED.client_secret, codigo = EXCLUDED.codigo
    `;
    return res.status(200).json({ ok: true, shop_domain });
  }

  if (req.method === 'DELETE') {
    const { shop_domain } = req.body ?? {};
    if (!shop_domain) return res.status(400).json({ error: 'shop_domain required' });
    await sql`DELETE FROM shopify_stores WHERE shop_domain = ${shop_domain}`;
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}

// --- Schema bootstrap (idempotent) ---
async function ensureTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS shopify_stores (
      id            SERIAL PRIMARY KEY,
      shop_domain   TEXT UNIQUE NOT NULL,
      client_secret TEXT NOT NULL,
      codigo        TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
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
