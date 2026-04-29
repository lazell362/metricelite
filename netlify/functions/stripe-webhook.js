// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];

  if (!sig) {
    console.error('Webhook called without stripe-signature header');
    return { statusCode: 400, body: 'Missing signature' };
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET env var not set');
    return { statusCode: 500, body: 'Server config error' };
  }

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  console.log(`✅ Received event: ${stripeEvent.type} (${stripeEvent.id})`);

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(stripeEvent.data.object);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionChange(stripeEvent.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(stripeEvent.data.object);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(stripeEvent.data.object);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(stripeEvent.data.object);
        break;
      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error(`Error handling ${stripeEvent.type}:`, err);
    return { statusCode: 500, body: `Handler error: ${err.message}` };
  }
};

async function handleCheckoutCompleted(session) {
  const userId = session.metadata?.supabase_user_id || session.client_reference_id;
  const productType = session.metadata?.product_type;

  if (!userId) {
    console.error('No supabase_user_id in session metadata:', session.id);
    return;
  }

  if (!productType) {
    console.error('No product_type in session metadata:', session.id);
    return;
  }

  const { data: existing } = await supabaseAdmin
    .from('purchases')
    .select('id')
    .eq('stripe_session_id', session.id)
    .maybeSingle();

  if (existing) {
    console.log(`Session ${session.id} already processed, skipping`);
    return;
  }

  if (productType === 'day_pass') {
    const accessEndsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabaseAdmin.from('purchases').insert({
      user_id: userId,
      stripe_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent,
      stripe_customer_id: session.customer,
      product_type: 'day_pass',
      amount_cents: session.amount_total,
      currency: session.currency,
      access_starts_at: new Date().toISOString(),
      access_ends_at: accessEndsAt,
      status: 'completed',
    });

    if (error) throw error;
    console.log(`✅ Day pass granted to user ${userId} until ${accessEndsAt}`);

  } else if (productType === 'subscription') {
    const { error } = await supabaseAdmin.from('purchases').insert({
      user_id: userId,
      stripe_session_id: session.id,
      stripe_subscription_id: session.subscription,
      stripe_customer_id: session.customer,
      product_type: 'subscription',
      amount_cents: session.amount_total,
      currency: session.currency,
      access_starts_at: new Date().toISOString(),
      access_ends_at: null,
      status: 'completed',
    });

    if (error) throw error;
    console.log(`✅ Subscription started for user ${userId}: ${session.subscription}`);
  }
}

async function handleSubscriptionChange(subscription) {
  const userId = subscription.metadata?.supabase_user_id;

  if (!userId) {
    console.warn(`Subscription ${subscription.id} has no supabase_user_id metadata`);
    return;
  }

  let accessEndsAt = null;
  let status = 'completed';

  if (subscription.cancel_at_period_end) {
    accessEndsAt = new Date(subscription.current_period_end * 1000).toISOString();
  } else if (subscription.status === 'active' || subscription.status === 'trialing') {
    accessEndsAt = null;
  } else if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
    accessEndsAt = new Date(subscription.current_period_end * 1000).toISOString();
  } else if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
    accessEndsAt = new Date().toISOString();
    status = 'cancelled';
  }

  const { error } = await supabaseAdmin
    .from('purchases')
    .update({
      access_ends_at: accessEndsAt,
      status: status,
    })
    .eq('stripe_subscription_id', subscription.id);

  if (error) throw error;
  console.log(
    `✅ Subscription ${subscription.id} updated: status=${subscription.status}, ` +
    `cancel_at_period_end=${subscription.cancel_at_period_end}, access_ends_at=${accessEndsAt}`
  );
}

async function handleSubscriptionDeleted(subscription) {
  const { error } = await supabaseAdmin
    .from('purchases')
    .update({
      access_ends_at: new Date().toISOString(),
      status: 'cancelled',
    })
    .eq('stripe_subscription_id', subscription.id);

  if (error) throw error;
  console.log(`✅ Subscription ${subscription.id} fully cancelled`);
}

async function handleInvoicePaid(invoice) {
  if (!invoice.subscription) return;

  const subscription = await stripe.subscriptions.retrieve(invoice.subscription);

  let accessEndsAt = null;
  if (subscription.cancel_at_period_end) {
    accessEndsAt = new Date(subscription.current_period_end * 1000).toISOString();
  }

  const { error } = await supabaseAdmin
    .from('purchases')
    .update({
      access_ends_at: accessEndsAt,
      status: 'completed',
    })
    .eq('stripe_subscription_id', invoice.subscription);

  if (error) throw error;
  console.log(`✅ Invoice ${invoice.id} paid, subscription ${invoice.subscription} extended`);
}

async function handleInvoicePaymentFailed(invoice) {
  if (!invoice.subscription) return;

  const { error } = await supabaseAdmin
    .from('purchases')
    .update({
      status: 'completed',
    })
    .eq('stripe_subscription_id', invoice.subscription);

  if (error) throw error;
  console.log(`⚠️ Payment failed for subscription ${invoice.subscription}, Stripe will retry`);
}
