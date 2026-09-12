// import { createRemoteJWKSet, jwtVerify } from 'jose';
// import config from '../config.js';

// export const JWKS = createRemoteJWKSet(new URL(config.oridzs.jwks));

// export async function verifyAccessToken(token) {
//   const { payload } = await jwtVerify(token, JWKS, {
//     issuer: config.oridzs.issuer,
//     // audience: config.oridzs.audience,
//   });

//   return payload; // contains sub, email, name, etc.
// }
