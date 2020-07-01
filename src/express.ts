import express from 'express';
import { RequestHandler, Request, Response } from 'express-serve-static-core';
import { buildLogger } from '@bct/b-logger';
import bodyParser from 'body-parser';
import api from './api';
import cors from 'cors';
import {
  Scope,
  DeviceTokenRequiredError,
  DeviceTokenInvalidError,
  DeviceTokenExpiredError,
  SessionTokenRequiredError,
  SessionTokenInvalidError,
  SessionTokenExpiredError,
  InvalidScopeError,
} from './api/contracts';

import configLib from 'config';
const config: any = configLib;

const logger = buildLogger('express');

const app = express();

const issueDeviceToken: RequestHandler = (_, res) => {
  res.json({
    ok: { deviceToken: api.createDeviceToken() },
  });
};

const extractToken: RequestHandler = (req, res, next) => {
  try {
    let token = req.headers.authorization;
    const referer = req.headers.referer;
    if (token && token.startsWith('Bearer ')) {
      // Remove Bearer from string
      token = token.slice(7, token.length);
    }

    if (!token) {
      res.status(401);
    } else if (!referer) {
      res.status(406);
    } else {
      res.locals.token = token;
      res.locals.referer = referer;
      next();
    }
  } catch (err) {
    logger.error('Cannot read token', err);
    res.status(400).json({ message: 'Cannot read token.' });
  }
};

const reissueSessionToken: AsyncHandler = async (_, res) => {
  const result = await api.reissueSessionToken(res.locals.token);

  if ('sessionToken' in result) {
    res.json({ ok: { sessionToken: result.sessionToken } });
  } else {
    res.json({ signin_required: {} });
  }
};

const sendVerificationCode: AsyncHandler = async (req, res) => {
  if (!req.body.phoneNumber) {
    res.status(400).json({ message: 'phoneNumber required.' });
    return;
  }

  const result = await api.requestSmsCode(res.locals.token, req.body.phoneNumber);
  if ('smsSent' in result) {
    res.json({ ok: { attemptsCount: result.attemptsLeft }, message: 'Confirmation code was sent.' });
  } else if ('phoneBanned' in result) {
    res.status(403).json({ message: 'too many attempts.' });
  } else if ('wrongPhoneNumber' in result) {
    res.status(400).json({ message: result.wrongPhoneNumber });
  } else if ('authenticationInProgress' in result) {
    res
      .status(409)
      .json({ message: 'Authentication already in process on another device, please finish it or wait 5min.' });
  } else if ('twilioError' in result) {
    res.status(500).json(result);
  }
};

const sendTwofaVerificationCode: AsyncHandler = async (_, res) => {
  const result = await api.requestTwofaSmsCode(res.locals.token);
  if ('smsSent' in result) {
    res.json({ ok: { attemptsCount: result.attemptsLeft }, message: 'Confirmation code was sent.' });
  } else if ('phoneBanned' in result) {
    res.status(403).json({ message: 'too many attempts.' });
  } else if ('tokenRevoked' in result) {
    res.status(403).json({ message: 'Device token revoked.' });
  } else if ('twilioError' in result) {
    res.status(500).json(result);
  }
};

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

const handleErrors = (next: AsyncHandler) => async (req: Request, res: Response) => {
  try {
    await next(req, res);
  } catch (err) {
    if (err instanceof DeviceTokenRequiredError) {
      res.status(400).json({ message: 'Device token required.', code: 400 });
    } else if (err instanceof SessionTokenRequiredError) {
      res.status(400).json({ message: 'Session token required.', code: 401 });
    } else if (err instanceof InvalidScopeError) {
      res.status(401).json({ message: 'Invalid scope.', code: 402 });
    } else if (err instanceof DeviceTokenInvalidError) {
      res.status(403).json({ message: 'Invalid device token.', code: 403 });
    } else if (err instanceof SessionTokenInvalidError) {
      res.status(403).json({ message: 'Invalid session token.', code: 404 });
    } else if (err instanceof DeviceTokenExpiredError) {
      res.status(404).json({ message: 'Expired device token.', code: 405 });
    } else if (err instanceof SessionTokenExpiredError) {
      res.status(404).json({ message: 'Expired session token.', code: 405 });
    }
    logger.error('Unhandled exception', err);
    res.status(500).json({ internal_error: {}, code: 500 });
  }
};

class Parser {
  public static parseEnum<T>(value: string, enumType: T): T[keyof T] | undefined {
    if (!value) {
      return undefined;
    }

    for (const property in enumType) {
      const enumMember = enumType[property];
      if (typeof enumMember === 'string') {
        if (enumMember.toUpperCase() === value.toUpperCase()) {
          const key = (enumMember as string) as keyof typeof enumType;
          return enumType[key];
        }
      }
    }
    return undefined;
  }
}

const issueSessionToken: AsyncHandler = async ({ body: { secretCode, scope } }, res) => {
  const result = await api.issueSessionToken(res.locals.token, secretCode, Parser.parseEnum(scope, Scope));

  if ('sessionToken' in result) {
    res.json({
      ok: { sessionToken: result.sessionToken },
      message: 'Verification is success.',
    });
  } else if ('codeIncorrect' in result) {
    res.status(422).json({
      wrongCode: { attemptsCount: result.attemptsLeft },
      message: 'Verification code is wrong.',
    });
  } else if ('noVerificationInProgress' in result) {
    res.status(422).json({
      noVerificationInProgress: {},
      message: 'No verification in the progress.',
    });
  } else if ('phoneBanned' in result) {
    res.status(403).json({
      noVerificationInProgress: {},
      message: 'Too many attempts.',
    });
  }
};

const getTwofaStatus: AsyncHandler = async (_, res) => {
  const result = await api.getTwofaStatus(res.locals.token);

  if ('status' in result) {
    res.json({ ok: { status: result.status } });
  } else if ('tokenRevoked' in result) {
    res.status(403).json({ message: 'Session token revoked.' });
  }
};

const issueGoogleSecret: AsyncHandler = async (_, res) => {
  const result = await api.issueGoogleSecret(res.locals.token);

  if ('secret' in result) {
    res.json({ ok: { secret: result.secret } });
  } else if ('tokenRevoked' in result) {
    res.status(403).json({ message: 'Session token revoked.' });
  }
};

const verifyGoogleToken: AsyncHandler = async ({ body: { googleToken } }, res) => {
  if (!googleToken) {
    res.status(406).json({ message: 'Google token required.' });
    return;
  }

  const result = await api.verifyGoogleToken(res.locals.token, googleToken);

  if ('success' in result) {
    res.json({
      message: 'Successful google token verification.'
    });
  } else if ('tokenRevoked' in result) {
    res.status(403).json({ message: 'Session token revoked.' });
  } else if ('noVerificationInProgress' in result) {
    res.status(422).json({ message: 'No google 2fa verification in the progress.' });
  } else if ('googleTwofaBanned' in result) {
    res.status(403).json({ message: 'No more attempts to guess the google token.' });
  } else if ('codeIncorrect' in result) {
    res.status(422).json({ message: 'Verification google token is wrong.', attemptsLeft: result.attemptsLeft });
  }
};

const disableGoogle2FA: AsyncHandler = async (_, res) => {
  const result = await api.disableGoogle2FA(res.locals.token);

  if ('success' in result) {
    res.json({ message: 'Google 2FA is disabled.' });
  } else if ('tokenRevoked' in result) {
    res.status(403).json({ message: 'UpdateSecondFactor scope session token revoked.' });
  }
};

const issueEmailVerificationSecret: AsyncHandler = async ({ body: { email } }, res) => {
  const referer = res.locals.referer;

  if (!referer) {
    res.status(406).json({ message: 'Invalid host.' });
    return;
  }

  if (!email) {
    res.status(406).json({ message: 'Email required.' });
    return;
  }

  const result = await api.issueEmailVerificationSecret(res.locals.token, referer.substring(0, referer.length - 1), email);

  if ('success' in result) {
    res.json({ message: 'Verification email is sent.' });
  } else if ('tokenRevoked' in result) {
    res.status(403).json({ message: 'Session token revoked.' });
  } else if ('wrongEmail' in result) {
    res.status(422).json({ message: result.wrongEmail });
  } else if ('secretGenerationLimit' in result) {
    res.status(403).json({ message: 'Email secret generation limit. Please try again later.' });
  } else if ('twoFactorEnabled' in result) {
    res.status(201).json({ message: 'Email 2fa is already enabled.' });
  }
};

const verifyEmailSecret: AsyncHandler = async ({ params: { secret }, query: { redirectHost } }, res) => {
  if (!secret) {
    res.redirect(`${redirectHost}/2fa/confirm/406`);
    return;
  }

  if (!redirectHost) {
    res.status(406).json({ message: 'Redirect host required.' });
    return;
  }

  const result = await api.verifyEmailSecret(secret);

  if ('success' in result) {
    res.redirect(`${redirectHost}/2fa/confirm/200`);
  } else if ('wrongEmailSecret' in result) {
    res.redirect(`${redirectHost}/2fa/confirm/422`);
  } else if ('emailSecretExpired' in result) {
    res.redirect(`${redirectHost}/2fa/confirm/401`);
  }
};

const disableEmail2FA: AsyncHandler = async (_, res) => {
  const result = await api.disableEmail2FA(res.locals.token);

  if ('success' in result) {
    res.json({ message: 'Email 2FA is disabled.' });
  } else if ('tokenRevoked' in result) {
    res.status(403).json({ message: 'UpdateSecondFactor scope session token revoked.' });
  }
};

const sendEmailConfirmationCode: AsyncHandler = async (_, res) => {
  const result = await api.sendEmailConfirmationCode(res.locals.token);

  if ('success' in result) {
    res.json({ message: 'Email code is sent via email.' });
  } else if ('tokenRevoked' in result) {
    res.status(403).json({ message: 'UpdateSecondFactor scope session token revoked.' });
  } else if ('noVerificationInProgress' in result) {
    res.status(422).json({
      noVerificationInProgress: {},
      message: 'Email is invalid or email 2fa is disabled.',
    });
  }
};

const issueSensitiveSessionToken: AsyncHandler = async ({ body: { googleToken, secretCode } }, res) => {
  const result = await api.issueSensitiveSessionToken(res.locals.token, googleToken, secretCode);

  if ('sessionToken' in result) {
    res.json({
      ok: { sessionToken: result.sessionToken },
      message: 'Verification is success',
    });
  } else if ('tokenRevoked' in result) {
    res.status(403).json({ message: 'Session token revoked.' });
  } else if ('googleTwofaBanned' in result) {
    res.status(403).json({ message: 'No more attempts to verify google token.' });
  } else if ('emailTwofaBanned' in result) {
    res.status(403).json({ message: 'No more attempts to verify email code.' });
  } else if ('googleTokenIncorrect' in result) {
    res.status(422).json({
      wrongCode: { attemptsCount: result.attemptsLeft },
      message: 'Google Token is wrong.',
    });
  } else if ('emailCodeIncorrect' in result) {
    res.status(422).json({
      wrongCode: { attemptsCount: result.attemptsLeft },
      message: 'Email code is wrong.',
    });
  }
};

app.use(cors(config.app.cors || {}));
app.use(bodyParser.json({ type: 'json' }));
app.post('/api/tokens/device', issueDeviceToken);
app.get('/api/tokens/session', extractToken, handleErrors(reissueSessionToken));
app.post('/api/sms/send-code', extractToken, handleErrors(sendVerificationCode));
app.get('/api/sms/twofa-send-code', extractToken, handleErrors(sendTwofaVerificationCode));
app.post('/api/sms/verify', extractToken, handleErrors(issueSessionToken));
app.get('/api/twofa/status', extractToken, handleErrors(getTwofaStatus));
app.get('/api/twofa/setup-google', extractToken, handleErrors(issueGoogleSecret));
app.post('/api/twofa/verify-google', extractToken, handleErrors(verifyGoogleToken));
app.post('/api/twofa/disable-google', extractToken, handleErrors(disableGoogle2FA));
app.post('/api/twofa/setup-email', extractToken, handleErrors(issueEmailVerificationSecret));
app.get('/api/twofa/verify-email/:secret', handleErrors(verifyEmailSecret));
app.post('/api/twofa/disable-email', extractToken, handleErrors(disableEmail2FA));
app.post('/api/twofa/generate-email-code', extractToken, handleErrors(sendEmailConfirmationCode));
app.post('/api/twofa/verify', extractToken, handleErrors(issueSensitiveSessionToken));

export default app;
