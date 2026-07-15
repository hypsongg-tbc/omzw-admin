export default function handler(_req, res) {
  res.status(200).json({ status: 'ok', service: 'omzw-admin', ts: Date.now() });
}
