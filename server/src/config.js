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
    expiry: process.env.JWT_EXPIRES_IN,
  },
  mailtrap: {
    host: process.env.MAILTRAP_EMAIL_HOST,
    port: process.env.MAILTRAP_EMAIL_PORT,
    user: process.env.MAILTRAP_EMAIL_USERNAME,
    password: process.env.MAILTRAP_EMAIL_PASSWORD,
    from: process.env.MAILTRAP_EMAIL_FROM,
  },
};

export default config;
