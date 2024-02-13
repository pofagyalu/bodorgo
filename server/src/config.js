const config = {
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT,
  db: {
    clusterAddress: process.env.MONGODB_CLUSTER_ADDRESS,
    userName: process.env.MONGODB_USERNAME,
    password: process.env.MONGODB_PASSWORD,
  },
};

export default config;
