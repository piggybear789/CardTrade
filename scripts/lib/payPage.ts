// Bank-rail smoke harness (scripts/smoke-stripe-bank-rails.ts): a tiny localhost server for the buyer's Pay step. Serves a page
// that mounts Stripe's Payment Element against a client secret and confirms it with the
// SAME calls components/sales/BankPaymentForm.tsx makes (Elements + PaymentElement
// layout 'tabs' + stripe.confirmPayment with a return_url and redirect: 'if_required').
import { createServer, type Server } from 'node:http';

export interface PayPage {
  url: (params: { pk: string; secret: string; mode?: 'next-action' }) => string;
  returnUrl: string;
  close: () => Promise<void>;
}

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Pay</title>
<script src="https://js.stripe.com/v3/"></script>
<style>body{font-family:sans-serif;max-width:480px;margin:24px auto}#status{margin-top:12px;white-space:pre-wrap}</style>
</head><body>
<form id="form"><div id="element"></div><button id="pay" type="submit">Pay</button></form>
<div id="status">loading</div>
<script>
const q = new URLSearchParams(location.search);
const stripe = Stripe(q.get('pk'));
// Card 3-D Secure: the same call components/sales/paymentChallenge.ts makes.
if (q.get('mode') === 'next-action') {
  window.__ready = true;
  document.getElementById('status').textContent = 'ready';
  document.getElementById('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const result = await stripe.handleNextAction({ clientSecret: q.get('secret') });
    window.__result = result.error
      ? { error: result.error.message, code: result.error.code }
      : { status: result.paymentIntent && result.paymentIntent.status };
    document.getElementById('status').textContent = 'done ' + JSON.stringify(window.__result);
  });
  throw new Error('next-action mode');
}
const elements = stripe.elements({ clientSecret: q.get('secret'), appearance: { theme: 'flat' } });
const element = elements.create('payment', { layout: 'tabs' });
element.on('ready', () => { document.getElementById('status').textContent = 'ready'; window.__ready = true; });
element.on('loaderror', (e) => { document.getElementById('status').textContent = 'loaderror ' + JSON.stringify(e.error); window.__loaderror = e.error; });
element.mount('#element');
document.getElementById('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  document.getElementById('status').textContent = 'confirming';
  const result = await stripe.confirmPayment({
    elements,
    confirmParams: { return_url: q.get('return') },
    redirect: 'if_required',
  });
  window.__result = result.error
    ? { error: result.error.message, code: result.error.code }
    : { status: result.paymentIntent && result.paymentIntent.status };
  document.getElementById('status').textContent = 'done ' + JSON.stringify(window.__result);
});
</script></body></html>`;

export async function startPayPage(port = 4719): Promise<PayPage> {
  const server: Server = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/return')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Returned</title><p id="returned">returned</p>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(HTML);
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const base = `http://localhost:${port}`;
  const returnUrl = `${base}/return`;
  return {
    returnUrl,
    url: ({ pk, secret, mode }) =>
      `${base}/?pk=${encodeURIComponent(pk)}&secret=${encodeURIComponent(secret)}&return=${encodeURIComponent(returnUrl)}${mode ? `&mode=${mode}` : ''}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
