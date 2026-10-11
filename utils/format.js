// Display formatting helpers (also exposed to EJS views via app.locals).
function formatMoney(n) {
  return '\u20B9' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
function formatDate(d) {
  if (!d) return '\u2014';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateTime(d) {
  if (!d) return '\u2014';
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
// Value for an <input type="datetime-local">, in the business timezone (not UTC).
function toDateTimeInput(d) {
  if (!d) return '';
  const x = new Date(d);
  const p = n => String(n).padStart(2, '0');
  return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()) + 'T' + p(x.getHours()) + ':' + p(x.getMinutes());
}
function formatMoneyPdf(n) {
  return 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

module.exports = { formatMoney, formatDate, formatDateTime, formatMoneyPdf, toDateTimeInput };
