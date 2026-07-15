/**
 * POST /api/send-email
 * Dispara email de confirmação de participação via Resend.
 * Body: { orderId: number, template?: 'confirmation' | 'reminder' }
 */

import { neon }   from '@neondatabase/serverless';
import { Resend } from 'resend';

function auth(req, res) {
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!auth(req, res)) return;

  const { orderId, template = 'confirmation' } = req.body ?? {};
  if (!orderId) return res.status(400).json({ error: 'orderId is required' });

  const sql    = neon(process.env.DATABASE_URL);
  const rows   = await sql`SELECT * FROM orders WHERE id = ${orderId} LIMIT 1`;
  const order  = rows[0];

  if (!order) return res.status(404).json({ error: 'order not found' });
  if (!order.customer_email) return res.status(400).json({ error: 'order has no email' });

  const resend = new Resend(process.env.RESEND_API_KEY);

  const templates = {
    confirmation: {
      subject: `OMZW — Your draw entry is confirmed 🏠`,
      html: buildConfirmation(order),
    },
    reminder: {
      subject: `OMZW — Draw closing soon! Your entry #${order.transaction_id}`,
      html: buildReminder(order),
    },
  };

  const tpl = templates[template] ?? templates.confirmation;

  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to:   order.customer_email,
    subject: tpl.subject,
    html: tpl.html,
  });

  if (error) {
    console.error('[send-email] Resend error:', error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ ok: true, resendId: data?.id });
}

// --- Templates ---

function buildConfirmation(order) {
  const raffleBlock = order.raffle_code
    ? `<div style="background:#0d2235;border:1px solid #f5c842;border-radius:8px;padding:20px;text-align:center;margin:24px 0;">
         <p style="margin:0 0 8px;color:#aab4be;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Your Entry Code</p>
         <p style="margin:0;font-size:32px;font-weight:700;color:#f5c842;letter-spacing:4px;">${order.raffle_code}</p>
       </div>`
    : `<p style="color:#aab4be;">Your entry code will be assigned shortly and sent in a follow-up email.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#081f28;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#081f28;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="padding:0 0 32px;text-align:center;">
          <span style="font-size:28px;font-weight:900;color:#fff;letter-spacing:4px;text-transform:uppercase;">OMZW</span>
        </td></tr>

        <!-- Body card -->
        <tr><td style="background:#0d2235;border-radius:12px;padding:40px;">

          <h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:#fff;">You're in the draw! 🎉</h1>
          <p style="margin:0 0 24px;color:#aab4be;">Hi ${order.customer_name || 'there'}, your purchase was successful and your entry has been confirmed.</p>

          <!-- Order details -->
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #1e3a52;margin-bottom:20px;">
            <tr>
              <td style="padding:12px 0;color:#aab4be;font-size:14px;">Order</td>
              <td style="padding:12px 0;color:#fff;font-size:14px;text-align:right;">${order.transaction_id}</td>
            </tr>
            <tr style="border-top:1px solid #1e3a52;">
              <td style="padding:12px 0;color:#aab4be;font-size:14px;">Item</td>
              <td style="padding:12px 0;color:#fff;font-size:14px;text-align:right;">${order.product_title}</td>
            </tr>
            <tr style="border-top:1px solid #1e3a52;">
              <td style="padding:12px 0;color:#aab4be;font-size:14px;">Amount paid</td>
              <td style="padding:12px 0;color:#fff;font-size:14px;text-align:right;">£${parseFloat(order.amount).toFixed(2)}</td>
            </tr>
          </table>

          ${raffleBlock}

          <p style="color:#aab4be;font-size:13px;line-height:1.6;">
            Good luck! The winner will be announced on our website.
            No purchase is necessary to enter — see our <a href="https://omzw.co.uk/postal-entry" style="color:#f5c842;">free postal entry route</a>
            and <a href="https://omzw.co.uk/rules" style="color:#f5c842;">official rules</a>.
          </p>

        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px;text-align:center;">
          <p style="margin:0;color:#3a5570;font-size:12px;">
            OMZW Ltd · This is a prize draw, not a raffle or lottery.<br>
            © ${new Date().getFullYear()} OMZW. All rights reserved.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildReminder(order) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#081f28;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#081f28;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="padding:0 0 32px;text-align:center;">
          <span style="font-size:28px;font-weight:900;color:#fff;letter-spacing:4px;text-transform:uppercase;">OMZW</span>
        </td></tr>
        <tr><td style="background:#0d2235;border-radius:12px;padding:40px;">
          <h1 style="margin:0 0 16px;color:#f5c842;font-size:22px;">The draw is closing soon ⏰</h1>
          <p style="color:#aab4be;">Hi ${order.customer_name || 'there'}, just a reminder that you're entered in the current OMZW draw.</p>
          <p style="color:#aab4be;">Your entry: <strong style="color:#fff;">${order.raffle_code || order.transaction_id}</strong></p>
          <p style="color:#3a5570;font-size:12px;">No purchase necessary — see official rules at omzw.co.uk/rules</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
