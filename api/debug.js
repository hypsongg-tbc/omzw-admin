/**
 * GET /api/debug — temporary diagnostics, remove after fix
 */

export default async function handler(req, res) {
  const report = {
    node: process.version,
    db_url_set: !!process.env.DATABASE_URL,
    db_url_prefix: process.env.DATABASE_URL?.slice(0, 30) ?? 'NOT SET',
    admin_secret_set: !!process.env.ADMIN_SECRET,
    neon_import: null,
    neon_connect: null,
    error: null,
  };

  try {
    const { neon } = await import('@neondatabase/serverless');
    report.neon_import = 'ok';

    if (process.env.DATABASE_URL) {
      const sql = neon(process.env.DATABASE_URL);
      const rows = await sql`SELECT 1 AS ping`;
      report.neon_connect = rows[0]?.ping === 1 ? 'ok' : 'unexpected result';
    } else {
      report.neon_connect = 'skipped (no DATABASE_URL)';
    }
  } catch (err) {
    report.error = { message: err.message, type: err.constructor.name, stack: err.stack?.split('\n').slice(0, 6) };
  }

  return res.status(200).json(report);
}
