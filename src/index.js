import { getSecurityHeaders } from '../shared/types/security';
import { createProxyHandler } from '../shared/types/api-proxy';
import { serveFavicon } from '../shared/types/favicon';

const proxyHandler = createProxyHandler();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Delegate /api/* requests to shared API proxy so API_ACCESS_* is injected
    if (url.pathname.startsWith('/api/')) {
      const proxied = await proxyHandler({ request, locals: { runtime: { env } } });
      return applySecurityHeadersJS(proxied);
    }

    function applySecurityHeadersJS(response) {
      const headers = new Headers(response.headers || {});
      const sec = getSecurityHeaders();
      for (const k in sec) headers.set(k, sec[k]);
      return new Response(response.body, { status: response.status || 200, headers });
    }

    if (url.pathname === '/health') {
      const r = new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' }
      });
      return applySecurityHeadersJS(r);
    }

    // Stripe webhook endpoint
    if (url.pathname === '/webhook' && request.method === 'POST') {
      const signature = request.headers.get('stripe-signature');
      const body = await request.text();

      // Verify signature (requires STRIPE_WEBHOOK_SECRET)
      // TODO: Implement signature verification

      try {
        const event = JSON.parse(body);

        switch (event.type) {
          case 'payment_intent.succeeded':
            // Handle successful payment
            return applySecurityHeadersJS(new Response(JSON.stringify({ success: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }));

          case 'customer.subscription.created':
          case 'customer.subscription.updated':
            // Handle subscription change
            return new Response(JSON.stringify({ success: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });

          default:
            return new Response(JSON.stringify({ success: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
        }
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Webhook processing failed' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Serve favicon via shared handler
    if (url.pathname === '/favicon.ico') {
      return serveFavicon(request, env, proxyHandler, applySecurityHeadersJS);
    }

    return new Response('Not found', { status: 404 });
  }
};
