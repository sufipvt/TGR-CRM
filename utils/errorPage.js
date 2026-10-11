// Standalone HTML error page used for 404s, 500s and failed page loads.
function sendErrorPage(res, status, message) {
  res.status(status).send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>TrueGrowth CRM</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#f8fafc; color:#111827; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
  .box { text-align:center; padding:40px; max-width:420px; }
  .icon { font-size:48px; margin-bottom:16px; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { color:#6b7280; font-size:14px; margin:0 0 24px; }
  a { display:inline-block; background:#1a56db; color:#fff; text-decoration:none; padding:10px 22px; border-radius:8px; font-size:14px; font-weight:600; }
</style></head>
<body><div class="box">
  <div class="icon">\u26A0\uFE0F</div>
  <h1>Something went wrong</h1>
  <p>${message}</p>
  <a href="/app">Return to Dashboard</a>
</div></body></html>`);
}

module.exports = { sendErrorPage };
