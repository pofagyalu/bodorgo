import jwt from 'jsonwebtoken';
import config from '../config';

export const jwtToken = ({ payload }, expiresIn = config.jwt.expiry) =>
  jwt.sign(payload, config.jwt.secret, {
    issuer: 'https://bodorgo.padlasfoto.duckdns.org',
    expiresIn,
  });

export const isTokenValid = (token) => jwt.verify(token, config.jwt.secret);

export const attachCookiesToResponse = ({ res, user }) => {
  const token = jwtToken({ payload: user });

  const oneDay = 24 * 3600000;
  const cookieOptions = {
    httpOnly: true,
    expires: new Date(Date.now() + config.jwt.cookieExpiry * oneDay),
    secure: config.nodeEnv === 'production',
    signed: true,
  };

  res.cookie('authToken', token, cookieOptions);
};
