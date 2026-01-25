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

// ============ FAMILY BILLING ============

// Get family plan for a user (parent or child)
app.get('/family/:userId', async (c) => {
  const userId = c.req.param('userId');
  const authUserId = c.req.header('X-User-ID');

  try {
    // Check if user is a parent with family plan
    const parentPlan = await c.env.DB.prepare(`
      SELECT fp.*, s.plan, s.status, s.current_period_end
      FROM family_plans fp
      JOIN subscriptions s ON fp.subscription_id = s.id
      WHERE fp.parent_user_id = ?
    `).bind(userId).first();

    if (parentPlan) {
      // Get family members
      const members = await c.env.DB.prepare(`
        SELECT * FROM family_members WHERE subscription_id = ? AND removed_at IS NULL
      `).bind(parentPlan.subscription_id).all();

      return c.json({
        role: 'parent',
        plan: parentPlan.plan,
        status: parentPlan.status,
        current_period_end: parentPlan.current_period_end,
        max_members: parentPlan.max_family_members,
        members: members.results || [],
        features: getFeatures(parentPlan.plan as string),
      });
    }

    // Check if user is a family member (child)
    const memberPlan = await c.env.DB.prepare(`
      SELECT fm.*, fp.max_family_members, s.plan, s.status, s.current_period_end
      FROM family_members fm
      JOIN family_plans fp ON fm.subscription_id = fp.subscription_id
      JOIN subscriptions s ON fm.subscription_id = s.id
      WHERE fm.member_user_id = ? AND fm.removed_at IS NULL
    `).bind(userId).first();

    if (memberPlan) {
      return c.json({
        role: 'member',
        member_type: memberPlan.member_type,
        plan: memberPlan.plan,
        status: memberPlan.status,
        parent_user_id: memberPlan.parent_user_id,
        features: getFeatures(memberPlan.plan as string),
      });
    }

    // No family plan - check for individual subscription
    const sub = await c.env.DB.prepare(
      'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(userId).first();

    return c.json({
      role: 'individual',
      plan: sub?.plan || 'free',
      status: sub?.status || 'active',
      features: getFeatures((sub?.plan as string) || 'free'),
      can_create_family: sub?.plan && sub.plan !== 'free',
    });
  } catch (err) {
    console.error('[FAMILY] Error fetching:', err);
    return c.json({ error: 'Failed to fetch family plan' }, 500);
  }
});

// Create family plan (requires pro/enterprise subscription)
app.post('/family', async (c) => {
  const { userId } = await c.req.json();
  const authUserId = c.req.header('X-User-ID');

  if (authUserId !== userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    // Check user has paid subscription
    const sub = await c.env.DB.prepare(
      'SELECT * FROM subscriptions WHERE user_id = ? AND status = ? AND plan != ?'
    ).bind(userId, 'active', 'free').first();

    if (!sub) {
      return c.json({ error: 'Pro or Enterprise subscription required for family plan' }, 403);
    }

    // Check if family plan already exists
    const existing = await c.env.DB.prepare(
      'SELECT id FROM family_plans WHERE parent_user_id = ?'
    ).bind(userId).first();

    if (existing) {
      return c.json({ error: 'Family plan already exists', family_plan_id: existing.id });
    }

    // Create family plan
    const id = crypto.randomUUID();
    const maxMembers = sub.plan === 'enterprise' ? 10 : 5;

    await c.env.DB.prepare(`
      INSERT INTO family_plans (id, subscription_id, parent_user_id, max_family_members, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, sub.id, userId, maxMembers, Math.floor(Date.now() / 1000)).run();

    return c.json({
      success: true,
      family_plan_id: id,
      max_members: maxMembers,
    });
  } catch (err) {
    console.error('[FAMILY] Create error:', err);
    return c.json({ error: 'Failed to create family plan' }, 500);
  }
});

// Add family member (for linking child accounts)
app.post('/family/:userId/members', async (c) => {
  const userId = c.req.param('userId');
  const { memberUserId, memberType = 'child' } = await c.req.json();
  const authUserId = c.req.header('X-User-ID');

  if (authUserId !== userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!memberUserId) {
    return c.json({ error: 'memberUserId required' }, 400);
  }

  try {
    // Get family plan
    const familyPlan = await c.env.DB.prepare(`
      SELECT fp.*, s.id as subscription_id
      FROM family_plans fp
      JOIN subscriptions s ON fp.subscription_id = s.id
      WHERE fp.parent_user_id = ?
    `).bind(userId).first();

    if (!familyPlan) {
      return c.json({ error: 'No family plan found. Create one first.' }, 404);
    }

    // Check member limit
    const memberCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM family_members WHERE subscription_id = ? AND removed_at IS NULL'
    ).bind(familyPlan.subscription_id).first();

    if ((memberCount?.count as number || 0) >= (familyPlan.max_family_members as number)) {
      return c.json({ error: 'Family member limit reached' }, 403);
    }

    // Check if member already in a family
    const existingMember = await c.env.DB.prepare(
      'SELECT id FROM family_members WHERE member_user_id = ? AND removed_at IS NULL'
    ).bind(memberUserId).first();

    if (existingMember) {
      return c.json({ error: 'User is already a family member' }, 409);
    }

    // Add member
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO family_members (id, subscription_id, parent_user_id, member_user_id, member_type, added_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, familyPlan.subscription_id, userId, memberUserId, memberType, Math.floor(Date.now() / 1000)).run();

    return c.json({
      success: true,
      member_id: id,
      message: `Family member added successfully`,
    });
  } catch (err) {
    console.error('[FAMILY] Add member error:', err);
    return c.json({ error: 'Failed to add family member' }, 500);
  }
});

// Remove family member
app.delete('/family/:userId/members/:memberId', async (c) => {
  const userId = c.req.param('userId');
  const memberId = c.req.param('memberId');
  const authUserId = c.req.header('X-User-ID');

  if (authUserId !== userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    // Verify ownership and remove
    const result = await c.env.DB.prepare(`
      UPDATE family_members SET removed_at = ?
      WHERE id = ? AND parent_user_id = ? AND removed_at IS NULL
    `).bind(Math.floor(Date.now() / 1000), memberId, userId).run();

    if (result.meta.changes === 0) {
      return c.json({ error: 'Member not found or already removed' }, 404);
    }

    return c.json({ success: true, message: 'Family member removed' });
  } catch (err) {
    console.error('[FAMILY] Remove member error:', err);
    return c.json({ error: 'Failed to remove family member' }, 500);
  }
});

// Get subscription for a user (including family inheritance)
app.get('/subscription/effective/:userId', async (c) => {
  const userId = c.req.param('userId');

  try {
    // Check direct subscription first
    const directSub = await c.env.DB.prepare(
      'SELECT * FROM subscriptions WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(userId, 'active').first();

    if (directSub && directSub.plan !== 'free') {
      return c.json({
        user_id: userId,
        plan: directSub.plan,
        status: directSub.status,
        source: 'direct',
        features: getFeatures(directSub.plan as string),
      });
    }

    // Check if user is a family member
    const familySub = await c.env.DB.prepare(`
      SELECT s.plan, s.status, fm.member_type, fp.parent_user_id
      FROM family_members fm
      JOIN subscriptions s ON fm.subscription_id = s.id
      JOIN family_plans fp ON fm.subscription_id = fp.subscription_id
      WHERE fm.member_user_id = ? AND fm.removed_at IS NULL AND s.status = 'active'
    `).bind(userId).first();

    if (familySub) {
      return c.json({
        user_id: userId,
        plan: familySub.plan,
        status: familySub.status,
        source: 'family',
        parent_user_id: familySub.parent_user_id,
        member_type: familySub.member_type,
        features: getFeatures(familySub.plan as string),
      });
    }

    // Default to free plan
    return c.json({
      user_id: userId,
      plan: 'free',
      status: 'active',
      source: 'default',
      features: getFeatures('free'),
    });
  } catch (err) {
    console.error('[SUBSCRIPTION] Effective lookup error:', err);
    return c.json({ error: 'Failed to determine subscription' }, 500);
  }
});

// ============ ERROR HANDLING ============
app.notFound((c) => c.json({ error: 'Not found', path: c.req.path }, 404));

app.onError((err, c) => {
  console.error('[PAYMENTS] Error:', err);
  return c.json({ error: 'Internal server error', message: err.message }, 500);
});

export default app;
