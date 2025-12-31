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

    return new Response('Not found', { status: 404 });
  }
};
