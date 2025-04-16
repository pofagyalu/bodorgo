const config = {
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT,
  db: {
    clusterAddress: process.env.MONGODB_CLUSTER_ADDRESS,
    userName: process.env.MONGODB_USERNAME,
    password: process.env.MONGODB_PASSWORD,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiry: process.env.JWT_LIFETIME,
    cookieExpiry: process.env.JWT_COOKIE_EXPIRES_IN,
  },
  email: {
    from: process.env.EMAIL_FROM,
  },
  mailtrap: {
    host: process.env.MAILTRAP_EMAIL_HOST,
    port: process.env.MAILTRAP_EMAIL_PORT,
    user: process.env.MAILTRAP_EMAIL_USERNAME,
    password: process.env.MAILTRAP_EMAIL_PASSWORD,
  },
  sendgrid: {
    user: process.env.SENDGRID_USERNAME,
    password: process.env.SENDGRID_PASSWORD,
  },
  stripe: {
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    secretKey: process.env.STRIPE_SECRET_KEY,
  },
};

export default config;
