/**
 * Shared DB utilities — imported by all /api handlers.
 * ensureTables() bootstraps the schema on first invocation (idempotent).
 */

export async function ensureTables(sql) {
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
