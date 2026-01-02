export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' }
      });
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
            return new Response(JSON.stringify({ success: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });

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

    // Debug endpoints
    if (url.pathname === '/debug/env') {
      return new Response(JSON.stringify({
        processEnvHasClientId: !!(globalThis.process && process.env && process.env.CF_ACCESS_CLIENT_ID),
        hasStripeSecret: !!env.STRIPE_WEBHOOK_SECRET
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/debug/fetch-direct') {
      try {
        const clientId = env.CF_ACCESS_CLIENT_ID;
        const clientSecret = env.CF_ACCESS_CLIENT_SECRET;
        const headers = { 'User-Agent': 'XAOSTECH debug fetch' };
        if (clientId && clientSecret) {
          headers['CF-Access-Client-Id'] = clientId;
          headers['CF-Access-Client-Secret'] = clientSecret;
          headers['X-Proxy-CF-Injected'] = 'direct-test';
        }
        const resp = await fetch('https://api.xaostech.io/debug/headers', { method: 'GET', headers });
        const txt = await resp.text();
        return new Response(JSON.stringify({ status: resp.status, bodyStartsWith: txt.slice(0, 200) }), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'fetch failed', message: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

