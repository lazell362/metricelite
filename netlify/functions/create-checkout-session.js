// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
});

// Mapping van product type naar de juiste config
const PRODUCT_CONFIG = {
  day_pass: {
    priceId: process.env.STRIPE_DAY_PASS_PRICE_ID,
    mode: 'payment', // eenmalige betaling
    label: 'Dagpas',
  },
  subscription: {
    priceId: process.env.STRIPE_SUBSCRIPTION_PRICE_ID,
    mode: 'subscription', // recurring
    label: 'Premium maandelijks',
  },
};

exports.handler = async (event) => {
  // CORS headers (zelfde origin, maar voor de zekerheid)
  const headers = {
    'Access-Control-Allow-Origin': 'https://tipstersledger.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // 1. Parse request
    const { productType } = JSON.parse(event.body || '{}');

    if (!productType || !PRODUCT_CONFIG[productType]) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Ongeldig product. Kies "day_pass" of "subscription".',
        }),
      };
    }

    const config = PRODUCT_CONFIG[productType];

    if (!config.priceId) {
      console.error(`Missing price ID env var for product: ${productType}`);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Server-configuratie incompleet. Neem contact op met support.',
        }),
      };
    }

    // 2. Authenticate user via Supabase JWT in Authorization header
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Niet ingelogd. Log eerst in.' }),
      };
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Sessie verlopen. Log opnieuw in.' }),
      };
    }

    // 3. Check of user al een Stripe customer ID heeft (uit eerdere aankopen)
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: existingPurchase } = await supabaseAdmin
      .from('purchases')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .not('stripe_customer_id', 'is', null)
      .limit(1)
      .maybeSingle();

    let customerId = existingPurchase?.stripe_customer_id;

    // Als geen bestaande customer: Stripe maakt er automatisch een aan via customer_email
    // Maar als we wel al een customerId hebben, gebruiken we die voor consistentie

    // 4. Maak Checkout Session
    const sessionParams = {
      mode: config.mode,
      line_items: [
        {
          price: config.priceId,
          quantity: 1,
        },
      ],
      success_url: `https://tipstersledger.com/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://tipstersledger.com/pricing?canceled=true`,
      // Locale voor de Checkout pagina
      locale: 'nl',
      // Belangrijk: koppel de user aan de session voor de webhook
      client_reference_id: user.id,
      metadata: {
        supabase_user_id: user.id,
        product_type: productType,
      },
    };

    // Customer koppeling: bestaande customer hergebruiken of nieuwe maken via email
    if (customerId) {
      sessionParams.customer = customerId;
    } else {
      sessionParams.customer_email = user.email;
      // Stripe maakt dan automatisch een Customer en koppelt deze
      sessionParams.customer_creation = config.mode === 'payment' ? 'always' : undefined;
      // Bij subscription mode wordt customer altijd automatisch aangemaakt
    }

    // Voor subscriptions: metadata ook op de subscription zetten
    if (config.mode === 'subscription') {
      sessionParams.subscription_data = {
        metadata: {
          supabase_user_id: user.id,
          product_type: productType,
        },
      };
    } else {
      // Voor eenmalige betalingen: metadata op payment_intent
      sessionParams.payment_intent_data = {
        metadata: {
          supabase_user_id: user.id,
          product_type: productType,
        },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    // 5. Return de URL waar frontend naartoe moet redirecten
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        url: session.url,
        sessionId: session.id,
      }),
    };
  } catch (error) {
    console.error('Checkout session error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Er ging iets mis bij het opzetten van de betaling. Probeer opnieuw.',
        detail: process.env.NODE_ENV === 'development' ? error.message : undefined,
      }),
    };
  }
};
