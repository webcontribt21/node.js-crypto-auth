import uuid from 'uuid';
import { utc } from 'moment';
import { createDeviceToken as createToken, validateToken } from './jwt';
import { mailgunSender } from './mailgunSender';
import {
  DeviceTokenRequiredError,
  SessionTokenRequiredError,
  Api,
  ApiCreateOptions,
  Scope,
  TokenType,
  InvalidScopeError,
} from './contracts';
import twilioSender from './twilioSmsSender';
import emailTemplate from './emailTemplate';
import { generateRandomInt, generateEmailSecret } from '../utils';

import requestSmsCode from './methods/requestSmsCode';
import requestTwofaSmsCode from './methods/requestTwofaSmsCode';
import reissueSessionToken from './methods/reissueSessionToken';
import issueSessionToken from './methods/issueSessionToken';
import getTwofaStatus from './methods/getTwofaStatus';
import issueGoogleSecret from './methods/issueGoogleSecret';
import verifyGoogleToken from './methods/verifyGoogleToken';
import disableGoogle2FA from './methods/disableGoogle2FA';
import issueEmailVerificationSecret from './methods/issueEmailVerificationSecret';
import verifyEmailSecret from './methods/verifyEmailSecret';
import disableEmail2FA from './methods/disableEmail2FA';
import sendEmailConfirmationCode from './methods/sendEmailConfirmationCode';
import issueSensitiveSessionToken from './methods/issueSensitiveSessionToken';

const validateDeviceToken = <T>(token: string, innerFunction: (id: string) => Promise<T>) => {
  if (!token) throw new DeviceTokenRequiredError();

  const { id } = validateToken(token, TokenType.Device);

  return innerFunction(id);
};

const validateSessionToken = <T>(token: string, expectedScopes: Scope[], innerFunction: (id: string) => Promise<T>) => {
  if (!token) throw new SessionTokenRequiredError();

  const { id, scope } = validateToken(token, TokenType.Session);

  const lowerExpectedScopes = expectedScopes.map(scope => {
    return scope.toLowerCase();
  });

  if (lowerExpectedScopes.indexOf(scope) === -1) {
    throw new InvalidScopeError('invalid scope');
  }

  return innerFunction(id);
};

const defaultClock = { utcNow: () => utc() };

const defaultGenerator = () => generateRandomInt(1000, 9999);

const emailSecretGenerator = () => generateEmailSecret(24);

export const defaultOptions: ApiCreateOptions = {
  clock: defaultClock,
  sms: twilioSender,
  secretGenerator: defaultGenerator,
  emailConfirmationCodeGenerator: defaultGenerator,
  emailSecretGenerator: emailSecretGenerator,
  sendMail: mailgunSender,
  emailTemplate
};

export const createApi = (opts: ApiCreateOptions): Api => {
  const apiCreateOptions = {
    ...defaultOptions,
    ...(opts || {}),
  } as ApiCreateOptions;

  const {
    secretGenerator,
    sms,
    clock,
  } = apiCreateOptions;

  return {
    createDeviceToken: () => {
      const deviceId = uuid();
      return createToken(deviceId);
    },

    reissueSessionToken: token => validateDeviceToken(token, reissueSessionToken),

    requestSmsCode: (token, phone: string) =>
      validateDeviceToken(token, deviceId => requestSmsCode({ secretGenerator, sms, clock }, deviceId, phone)),

    requestTwofaSmsCode: token =>
      validateDeviceToken(token, deviceId => requestTwofaSmsCode({ secretGenerator, sms, clock }, deviceId)),

    issueSessionToken: (token, secretCode, scope) =>
      validateDeviceToken(token, deviceId => issueSessionToken(deviceId, secretCode, scope)),

    getTwofaStatus: token =>
      validateSessionToken(token, [Scope.Trading, Scope.UpdateSecondFactor, Scope.Sensitive], clientId =>
        getTwofaStatus(clientId)
      ),

    issueGoogleSecret: token =>
      validateSessionToken(token, [Scope.UpdateSecondFactor], clientId => issueGoogleSecret(clientId)),

    verifyGoogleToken: (token, googleToken) =>
      validateSessionToken(token, [Scope.UpdateSecondFactor], clientId => verifyGoogleToken(clientId, googleToken)),

    disableGoogle2FA: token =>
      validateSessionToken(token, [Scope.UpdateSecondFactor], clientId => disableGoogle2FA(clientId)),

    issueEmailVerificationSecret: (token, host: string, email: string) =>
      validateSessionToken(token, [Scope.UpdateSecondFactor], clientId =>
        issueEmailVerificationSecret(apiCreateOptions, clientId, host, email)
      ),

    verifyEmailSecret: secret => verifyEmailSecret({ clock }, secret),

    disableEmail2FA: token =>
      validateSessionToken(token, [Scope.UpdateSecondFactor], clientId => disableEmail2FA(clientId)),

    sendEmailConfirmationCode: token =>
      validateSessionToken(token, [Scope.Trading], clientId =>
        sendEmailConfirmationCode(apiCreateOptions, clientId)
      ),

    issueSensitiveSessionToken: (token, googleToken, secretCode) =>
      validateSessionToken(token, [Scope.Trading], clientId =>
        issueSensitiveSessionToken(clientId, googleToken, secretCode)
      ),
  };
};

export default createApi(defaultOptions);
