import { Hono } from 'hono';
import { createApiProxyRoute } from '../shared/types/api-proxy-hono';
import { serveFaviconHono } from '../shared/types/favicon';
import { applySecurityHeaders } from '../shared/types/security';

interface Env {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  API_ACCESS_CLIENT_ID?: string;
  API_ACCESS_CLIENT_SECRET?: string;
}

interface Subscription {
  id: string;
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  plan: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'canceled' | 'past_due' | 'trialing';
  current_period_end: number;
  created_at: number;
  updated_at: number;
}

const app = new Hono<{ Bindings: Env }>();

// Global security headers middleware
app.use('*', async (c, next) => {
  await next();
  return applySecurityHeaders(c.res);
});

// ============ LANDING PAGE ============
app.get('/', (c) => {
  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>XAOSTECH Payments</title><link rel="icon" type="image/png" href="/api/data/assets/XAOSTECH_LOGO.png"><style>:root { --primary: #f6821f; --bg: #0a0a0a; --text: #e0e0e0; } * { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 2rem; } .container { max-width: 900px; width: 100%; } h1 { color: var(--primary); margin-bottom: 1rem; } .hero { text-align: center; padding: 4rem 2rem; } .hero h1 { font-size: 3rem; } .hero p { font-size: 1.25rem; opacity: 0.8; margin-top: 1rem; } .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 2rem; margin-top: 3rem; } .plan { background: #1a1a1a; border-radius: 12px; padding: 2rem; border: 1px solid #333; transition: transform 0.2s, border-color 0.2s; } .plan:hover { transform: translateY(-4px); border-color: var(--primary); } .plan h2 { color: var(--primary); margin-bottom: 0.5rem; } .plan .price { font-size: 2rem; font-weight: bold; margin: 1rem 0; } .plan .price span { font-size: 1rem; opacity: 0.6; } .plan ul { list-style: none; margin: 1.5rem 0; } .plan li { padding: 0.5rem 0; border-bottom: 1px solid #333; } .plan li:last-child { border-bottom: none; } .plan li::before { content: "✓ "; color: var(--primary); } .btn { display: inline-block; background: var(--primary); color: #000; padding: 0.75rem 2rem; border-radius: 6px; text-decoration: none; font-weight: bold; transition: opacity 0.2s; } .btn:hover { opacity: 0.9; } .btn.secondary { background: transparent; border: 2px solid var(--primary); color: var(--primary); } footer { margin-top: 4rem; opacity: 0.6; font-size: 0.9rem; }</style></head><body><div class="container"><div class="hero"><h1>💳 XAOSTECH Payments</h1><p>Secure subscription management powered by Stripe</p></div><div class="plans"><div class="plan"><h2>Free</h2><div class="price">$0<span>/month</span></div><ul><li>5GB storage</li><li>Basic support</li><li>1 project</li></ul><a href="https://account.xaostech.io" class="btn secondary">Current Plan</a></div><div class="plan"><h2>Pro</h2><div class="price">$12<span>/month</span></div><ul><li>50GB storage</li><li>Priority support</li><li>Unlimited projects</li><li>API access</li><li>Custom domains</li></ul><a href="/checkout?plan=pro" class="btn">Upgrade to Pro</a></div><div class="plan"><h2>Enterprise</h2><div class="price">$49<span>/month</span></div><ul><li>Unlimited storage</li><li>24/7 support</li><li>Unlimited projects</li><li>API access</li><li>SSO &amp; SLA</li></ul><a href="/checkout?plan=enterprise" class="btn">Contact Sales</a></div></div></div><footer>&copy; 2026 XAOSTECH. All rights reserved.</footer></body></html>';
  return c.html(html);
});

// ============ HEALTH CHECK ============
app.get('/health', (c) => c.json({ status: 'ok', service: 'payments' }));

// ============ API PROXY ============
// Routes /api/* requests to api.xaostech.io with API_ACCESS authentication
app.all('/api/*', createApiProxyRoute());

// ============ FAVICON ============
app.get('/favicon.ico', serveFaviconHono);

// ============ STRIPE WEBHOOK ============
app.post('/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');
  const webhookSecret = c.env.STRIPE_WEBHOOK_SECRET;
  
  if (!signature || !webhookSecret) {
    return c.json({ error: 'Missing signature or webhook secret' }, 400);
  }

  try {
    const body = await c.req.text();
    
    // Note: In production, verify signature using Stripe's crypto verification
    // const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    const event = JSON.parse(body);

    console.log('[WEBHOOK] Processing event:', event.type);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await handleCheckoutComplete(c, session);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await handleSubscriptionChange(c, subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionCanceled(c, subscription);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        console.log('[WEBHOOK] Payment succeeded:', invoice.id);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await handlePaymentFailed(c, invoice);
        break;
      }

      default:
        console.log('[WEBHOOK] Unhandled event type:', event.type);
    }

    return c.json({ received: true });
  } catch (err: any) {
    console.error('[WEBHOOK] Error processing webhook:', err);
    return c.json({ error: 'Webhook processing failed' }, 400);
  }
});

// ============ SUBSCRIPTION ENDPOINTS ============

// Get current subscription status
app.get('/subscription/:userId', async (c) => {
  const userId = c.req.param('userId');
  const authUserId = c.req.header('X-User-ID');

  // Verify user is requesting their own subscription
  if (authUserId !== userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const sub = await c.env.DB.prepare(
      'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(userId).first<Subscription>();

    if (!sub) {
      return c.json({
        user_id: userId,
        plan: 'free',
        status: 'active',
        features: getFeatures('free'),
      });
    }

    return c.json({
      user_id: userId,
      plan: sub.plan,
      status: sub.status,
      current_period_end: sub.current_period_end,
      features: getFeatures(sub.plan),
    });
  } catch (err) {
    console.error('[SUBSCRIPTION] Error fetching:', err);
    return c.json({ error: 'Failed to fetch subscription' }, 500);
  }
});

// Create checkout session for upgrade
app.post('/checkout', async (c) => {
  const { userId, plan, successUrl, cancelUrl } = await c.req.json();

  if (!userId || !plan) {
    return c.json({ error: 'userId and plan required' }, 400);
  }

  const stripeKey = c.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return c.json({ error: 'Stripe not configured' }, 501);
  }

  try {
    const priceId = getPriceId(plan);
    if (!priceId) {
      return c.json({ error: 'Invalid plan' }, 400);
    }

    // Create Stripe Checkout Session
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'mode': 'subscription',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        'success_url': successUrl || 'https://xaostech.io/account?checkout=success',
        'cancel_url': cancelUrl || 'https://xaostech.io/pricing?checkout=canceled',
        'client_reference_id': userId,
        'metadata[user_id]': userId,
        'metadata[plan]': plan,
      }),
    });

    const session = await response.json();

    if (!response.ok) {
      console.error('[CHECKOUT] Stripe error:', session);
      return c.json({ error: 'Failed to create checkout session' }, 500);
    }

    return c.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (err) {
    console.error('[CHECKOUT] Error:', err);
    return c.json({ error: 'Failed to create checkout' }, 500);
  }
});

// Cancel subscription
app.post('/subscription/:userId/cancel', async (c) => {
  const userId = c.req.param('userId');
  const authUserId = c.req.header('X-User-ID');

  if (authUserId !== userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const stripeKey = c.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return c.json({ error: 'Stripe not configured' }, 501);
  }

  try {
    const sub = await c.env.DB.prepare(
      'SELECT stripe_subscription_id FROM subscriptions WHERE user_id = ? AND status = ?'
    ).bind(userId, 'active').first<{ stripe_subscription_id: string }>();

    if (!sub) {
      return c.json({ error: 'No active subscription' }, 404);
    }

    // Cancel at period end
    const response = await fetch(`https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'cancel_at_period_end': 'true',
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('[CANCEL] Stripe error:', err);
      return c.json({ error: 'Failed to cancel subscription' }, 500);
    }

    return c.json({ success: true, message: 'Subscription will cancel at period end' });
  } catch (err) {
    console.error('[CANCEL] Error:', err);
    return c.json({ error: 'Failed to cancel subscription' }, 500);
  }
});

// ============ HELPER FUNCTIONS ============

async function handleCheckoutComplete(c: any, session: any) {
  const userId = session.client_reference_id || session.metadata?.user_id;
  const plan = session.metadata?.plan || 'pro';
  const customerId = session.customer;
  const subscriptionId = session.subscription;

  if (!userId || !customerId) {
    console.error('[CHECKOUT] Missing userId or customerId');
    return;
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         stripe_customer_id = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id,
         plan = excluded.plan,
         status = 'active',
         updated_at = excluded.updated_at`
    ).bind(
      crypto.randomUUID(),
      userId,
      customerId,
      subscriptionId,
      plan,
      Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
      Math.floor(Date.now() / 1000),
      Math.floor(Date.now() / 1000)
    ).run();

    console.log('[CHECKOUT] Subscription created for user:', userId);
  } catch (err) {
    console.error('[CHECKOUT] DB error:', err);
  }
}

async function handleSubscriptionChange(c: any, subscription: any) {
  const customerId = subscription.customer;
  const status = subscription.status;
  const periodEnd = subscription.current_period_end;

  try {
    await c.env.DB.prepare(
      'UPDATE subscriptions SET status = ?, current_period_end = ?, updated_at = ? WHERE stripe_customer_id = ?'
    ).bind(status, periodEnd, Math.floor(Date.now() / 1000), customerId).run();

    console.log('[SUBSCRIPTION] Updated:', customerId, status);
  } catch (err) {
    console.error('[SUBSCRIPTION] Update error:', err);
  }
}

async function handleSubscriptionCanceled(c: any, subscription: any) {
  const customerId = subscription.customer;

  try {
    await c.env.DB.prepare(
      'UPDATE subscriptions SET status = ?, updated_at = ? WHERE stripe_customer_id = ?'
    ).bind('canceled', Math.floor(Date.now() / 1000), customerId).run();

    console.log('[SUBSCRIPTION] Canceled:', customerId);
  } catch (err) {
    console.error('[SUBSCRIPTION] Cancel error:', err);
  }
}

async function handlePaymentFailed(c: any, invoice: any) {
  const customerId = invoice.customer;

  try {
    await c.env.DB.prepare(
      'UPDATE subscriptions SET status = ?, updated_at = ? WHERE stripe_customer_id = ?'
    ).bind('past_due', Math.floor(Date.now() / 1000), customerId).run();

    console.log('[PAYMENT] Failed for customer:', customerId);
    // TODO: Send email notification to user
  } catch (err) {
    console.error('[PAYMENT] Failed update error:', err);
  }
}

function getPriceId(plan: string): string | null {
  // These should be set as environment variables in production
  const prices: Record<string, string> = {
    pro: 'price_pro_monthly', // Replace with actual Stripe price ID
    enterprise: 'price_enterprise_monthly',
  };
  return prices[plan] || null;
}

function getFeatures(plan: string): string[] {
  const features: Record<string, string[]> = {
    free: ['5GB storage', 'Basic support', '1 project'],
    pro: ['50GB storage', 'Priority support', 'Unlimited projects', 'API access', 'Custom domains'],
    enterprise: ['Unlimited storage', '24/7 support', 'Unlimited projects', 'API access', 'Custom domains', 'SSO', 'SLA'],
  };
  return features[plan] || features.free;
}

// ============ ERROR HANDLING ============
app.notFound((c) => c.json({ error: 'Not found', path: c.req.path }, 404));

app.onError((err, c) => {
  console.error('[PAYMENTS] Error:', err);
  return c.json({ error: 'Internal server error', message: err.message }, 500);
});

export default app;
