/**
 * GET  /api/orders?page=1        — lista paginada de pedidos + stats
 * GET  /api/orders?id=42         — pedido individual
 * POST /api/orders/raffle-code   — atribui raffle_code manualmente a um order
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

  // --- GET individual ---
  if (req.method === 'GET' && req.query.id) {
    const rows = await sql`SELECT * FROM orders WHERE id = ${req.query.id} LIMIT 1`;
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    return res.status(200).json(rows[0]);
  }

  // --- GET list + stats ---
  if (req.method === 'GET') {
    const page   = Math.max(1, parseInt(req.query.page ?? '1'));
    const limit  = 50;
    const offset = (page - 1) * limit;
    const search = req.query.search ?? '';
    const shop   = req.query.shop ?? '';

    let ordersQ, countQ;

    if (search) {
      const like = `%${search}%`;
      ordersQ = sql`
        SELECT * FROM orders
        WHERE (customer_name ILIKE ${like} OR customer_email ILIKE ${like} OR transaction_id ILIKE ${like})
        ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}
      `;
      countQ = sql`
        SELECT COUNT(*) as total FROM orders
        WHERE (customer_name ILIKE ${like} OR customer_email ILIKE ${like} OR transaction_id ILIKE ${like})
      `;
    } else if (shop) {
      ordersQ = sql`SELECT * FROM orders WHERE shop_domain = ${shop} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`;
      countQ  = sql`SELECT COUNT(*) as total FROM orders WHERE shop_domain = ${shop}`;
    } else {
      ordersQ = sql`SELECT * FROM orders ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`;
      countQ  = sql`SELECT COUNT(*) as total FROM orders`;
    }

    const [orders, countRows, stats] = await Promise.all([
      ordersQ,
      countQ,
      sql`
        SELECT
          COUNT(*)::int                          AS total_orders,
          COALESCE(SUM(amount), 0)::float        AS total_revenue,
          COUNT(DISTINCT customer_email)::int    AS unique_customers,
          COUNT(CASE WHEN raffle_code IS NOT NULL THEN 1 END)::int AS codes_assigned
        FROM orders
        WHERE status = 'completed'
      `,
    ]);

    return res.status(200).json({
      orders,
      total:  parseInt(countRows[0]?.total ?? 0),
      stats:  stats[0],
      page,
      limit,
    });
  }

  // --- POST assign raffle code ---
  if (req.method === 'POST') {
    const { orderId, raffleCode } = req.body ?? {};
    if (!orderId || !raffleCode) return res.status(400).json({ error: 'orderId and raffleCode required' });

    await sql`UPDATE orders SET raffle_code = ${raffleCode} WHERE id = ${orderId}`;
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
