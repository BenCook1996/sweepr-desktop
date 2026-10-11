const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function setup() {
  const product = await stripe.products.create({
    name: 'Sweepr Pro',
    description: 'Safe, Honest PC Cleaner',
  });

  const activationPrice = await stripe.prices.create({
    product: product.id,
    unit_amount: 199, // £1.99
    currency: 'gbp',
  });

  const monthlyPrice = await stripe.prices.create({
    product: product.id,
    unit_amount: 999, // £9.99
    currency: 'gbp',
    recurring: { interval: 'month' },
  });

  console.log('ACTIVATION_PRICE=' + activationPrice.id);
  console.log('MONTHLY_PRICE=' + monthlyPrice.id);
}

setup().catch(console.error);

