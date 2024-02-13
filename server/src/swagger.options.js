const swaggerOptions = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Bódorgó Klub - OpenAPI 3.0',
      version: '1.0.0',
      description:
        '\nSome useful links:\n- [Bódorgó repository](https://github.com/pofagyalu/bodorgo)',
      contact: {
        name: 'API support',
        email: 'pofagyalu@gmail.com',
      },
      license: {
        name: 'Apache 2.0',
        url: 'https://www.apache.org/licenses/LICENSE-2.0.html',
      },
    },
    servers: [
      { url: 'http://localhost:8808', description: 'Development server' },
      {
        url: 'https://api.bodorgo.padlas.duckdns.org/v1',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          bearerFormat: 'JWT',
          scheme: 'bearer',
        },
      },
    },
  },
  apis: ['**/*.yaml'],
  // apis: ['./routes*.js'],
};

export default swaggerOptions;
