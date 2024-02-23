import express from 'express';

import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import swaggerOptions from '../swagger.options';

const router = express.Router();
const swaggerSpec = swaggerJsdoc(swaggerOptions);

router.use(swaggerUi.serve, swaggerUi.setup(swaggerSpec));

export default router;
