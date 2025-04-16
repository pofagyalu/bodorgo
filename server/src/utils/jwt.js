import jwt from 'jsonwebtoken';
import config from '../config';

export const jwtToken = ({ payload }) =>
  jwt.sign(payload, config.jwt.secret, {
    issuer: 'https://bodorgo.padlasfoto.duckdns.org',
  });

export const isTokenValid = (token) => jwt.verify(token, config.jwt.secret);

export const attachCookiesToResponse = ({ res, user, refreshToken }) => {
  const accessTokenJWT = jwtToken({ payload: { user } });
  const refreshTokenJWT = jwtToken({ payload: { user, refreshToken } });

  const oneDay = 24 * 3600000;
  const longerExp = 30 * 24 * 3600000;

  res.cookie('accessToken', accessTokenJWT, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    signed: true,
    expires: new Date(Date.now() + oneDay),
  });
  res.cookie('refreshToken', refreshTokenJWT, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    signed: true,
    expires: new Date(Date.now() + longerExp),
  });
};
