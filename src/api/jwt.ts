import configLib from 'config';
import jwt, { JsonWebTokenError } from 'jsonwebtoken';
import { utc } from 'moment';
import {
  Scope,
  DeviceTokenInvalidError,
  SessionTokenInvalidError,
  SessionTokenExpiredError,
  DeviceTokenExpiredError,
  InvalidScopeError,
  TokenType
} from './contracts';

const config: any = configLib;

export const createSessionToken = (clientId: string, scope: Scope) => {
  const loweredScope = (scope || 'non-existent').toLowerCase();
  const expiresIn = config.jwt.session.expiresIn[loweredScope];

  if (!expiresIn) throw new InvalidScopeError('invalid scope');

  const payload = { sub: clientId, scope: loweredScope };
  return jwt.sign(payload, config.jwt.session.secret, { expiresIn });
};

export const createDeviceToken = (deviceId: string) => {
  const { expiresIn } = config.jwt.device;
  const payload = { sub: deviceId };
  return jwt.sign(payload, config.jwt.device.secret, { expiresIn });
};

export const validateToken = (token: string, tokenType: TokenType, options?: jwt.VerifyOptions) => {
  try {
    const secret = tokenType === TokenType.Session ? config.jwt.session.secret : config.jwt.device.secret;
    const { sub, eat, scope } = jwt.verify(token, secret, options) as any;
    return { id: sub, scope, expires: utc(eat) };
  } catch (err) {
    if (err instanceof JsonWebTokenError) {
      if (err.name === 'TokenExpiredError') {
        if (tokenType === TokenType.Session) {
          throw new SessionTokenExpiredError(err.message);
        }

        throw new DeviceTokenExpiredError(err.message);
      } else {
        if (tokenType === TokenType.Session) {
          throw new SessionTokenInvalidError(err.message);
        }

        throw new DeviceTokenInvalidError(err.message);
      }
    }

    throw err;
  }
};
