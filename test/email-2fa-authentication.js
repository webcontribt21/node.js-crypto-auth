/* eslint-disable no-await-in-loop */
const { setupConnection, setupPublishing, shutdownConnection } = require('@bct/simple-amqp-client');
const { connect, SecondAuthentications } = require('@bct/trading-zoo-node-models');
const config = require('config');
const { test } = require('tape');
const speakeasy = require('speakeasy');

const {
  InvalidScopeError,
  Scope,
  initialAttemptsCount,
  TokenType,
} = require('../dist/api/contracts');
const { createSessionToken, validateToken } = require('../dist/api/jwt');

const PublishChannel = require('../dist/publish');

const { createApi } = require('../dist/api');

const {
  clock,
  generateRandomInt,
  generatePhoneNumber,
} = require('./utils');

let connection;
let api;

const rng = (() => {
  const state = {};

  state.next = () => {
    state.current = generateRandomInt(1000, 9999);
    return state.current;
  };

  return state;
})();

async function setupDaemon() {
  await setupConnection(config.amqp);
}

const randomString = length => {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;

  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }

  return result;
};

let emailSecret = randomString(24);

let emailSecretGenerator = () => {
  return emailSecret;
};

const EMAIL_CONFIRM_CODE = '2312';

const emailConfirmationCodeGenerator = () => {
  return EMAIL_CONFIRM_CODE;
};

class TestSender {
  constructor() {
    this.failNextTime = false;
  }

  setFail() {
    this.failNextTime = true;
  }

  sendMessage() {
    if (this.failNextTime) {
      this.failNextTime = false;
      return { wrongPhoneNumber: 'wrong' };
    }
    return { ok: {} };
  }
}

const sms = new TestSender();

const sendMail = {
  sendMessage: async () => { },
};

const emailTemplate = {
  generateVerificationHtml: (email, verificationLink) => { return email + verificationLink; },
  generateVerificationText: (email, verificationLink) => { return email + verificationLink; },
  generateCodeHtml: (email, code) => { return email + code; },
  generateCodeText: (email, code) => { return email + code; },
};

test('setup', async t => {
  connection = connect({ ...config.db, logger: { info: () => { } } });
  api = createApi({
    clock,
    secretGenerator: rng.next,
    sms,
    emailConfirmationCodeGenerator,
    emailSecretGenerator,
    sendMail,
    emailTemplate,
  });

  await setupDaemon();
  const publishToUserData = await setupPublishing('UpdateUserBalancesRequest');
  PublishChannel.default.setPublishChannel('UpdateUserBalancesRequest', publishToUserData);

  t.end();
});

// issueEmailVerificationSecret
test('issue email secret and send verification link to enable email 2fa', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const host = 'test.com';
  const email = 'test@gmail.com';

  const { success } = await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);

  t.ok(success, 'Expected secret for email 2fa verification');

  await SecondAuthentications.destroy({
    where: { email_secret: emailSecret },
  });

  t.end();
});

test('can\'t issue email secret with invalid email format', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const host = 'test.com';
  const email = 'test';

  const { wrongEmail } = await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);

  t.ok(wrongEmail, 'Expected wrong email');
  t.end();
});

test('can\'t issue email secret retrying more than 10 times of email secret generation', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const host = 'test.com';
  const email = 'test@gmail.com';

  await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);

  const { secretGenerationLimit } = await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);

  t.ok(secretGenerationLimit, 'Expect email secret generation limit');

  await SecondAuthentications.destroy({
    where: { email_secret: emailSecret },
  });

  t.end();
});

// verifyEmailSecret
test('verify email secret under UpdateSecondFactor scope', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const host = 'test.com';
  const email = 'test@gmail.com';
  await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);
  const { success } = await api.verifyEmailSecret(emailSecret);

  t.ok(success, 'Expected email 2fa successful verification');
  t.end();
});

test('can\'t verify email secret 10 mins later', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();
  clock.pause();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const host = 'test.com';
  const email = 'test@gmail.com';
  await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);
  clock.forward(11, 'm');

  const { emailSecretExpired } = await api.verifyEmailSecret(emailSecret);

  clock.reset();
  t.ok(emailSecretExpired, 'Expected email 2fa verification expired');

  await SecondAuthentications.destroy({
    where: { email_secret: emailSecret },
  });

  t.end();
});

test('can\'t verify email secret with wrong email secret', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const host = 'test.com';
  const email = 'test@gmail.com';
  await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);

  const { wrongEmailSecret } = await api.verifyEmailSecret('Wrong-Secret');

  t.ok(wrongEmailSecret, 'Expected wrong email secret');

  await SecondAuthentications.destroy({
    where: { email_secret: emailSecret },
  });

  t.end();
});

test('can\'t issue email verification if email 2fa is already enabled', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const host = 'test.com';
  const email = 'test@gmail.com';
  await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);
  await api.verifyEmailSecret(emailSecret);
  const { twoFactorEnabled } = await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);

  t.ok(twoFactorEnabled, 'Expected 2fa enabled');
  t.end();
});

// disableEmail2FA
test('disable email 2fa', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const { success } = await api.disableEmail2FA(secondFactorSessionToken);

  t.ok(success, 'Expected success 2fa email disabling');
  t.end();
});

test('can\'t disable email 2fa with another scope rather than UpdateSecondFactor', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken } = await api.issueSessionToken(dt, rng.current, Scope.Trading);

  try {
    await api.disableEmail2FA(sessionToken);
    t.fail('Expected InvalidScopeError');
  } catch (err) {
    t.ok(err instanceof InvalidScopeError, `Expected InvalidScopeError, got ${err}`);
  }

  t.end();
});

test('can\'t process to disable email 2fa with session token revoked', async t => {
  const sessionToken = createSessionToken('Wrong-Client-id', Scope.UpdateSecondFactor);
  const { tokenRevoked } = await api.disableEmail2FA(sessionToken);

  t.ok(tokenRevoked, 'Expected revoked session token error');
  t.end();
});

// sendEmailConfirmationCode
test('generate email 2fa confirmation code and sent it via email with Trading scope', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const host = 'test.com';
  const email = 'test@gmail.com';
  await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);
  await api.verifyEmailSecret(emailSecret);

  const { id } = validateToken(secondFactorSessionToken, TokenType.Session);
  const sessionToken = createSessionToken(id, Scope.Trading);
  const { success } = await api.sendEmailConfirmationCode(sessionToken);

  t.ok(success, 'Expected send secret email');
  t.end();
});

test('can\'t generate email 2fa confirmation code with another scope than Trading scope', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const host = 'test.com';
  const email = 'test@gmail.com';
  await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);
  await api.verifyEmailSecret(emailSecret);

  try {
    await api.sendEmailConfirmationCode(secondFactorSessionToken);
    t.fail('Expected InvalidScopeError');
  } catch (err) {
    t.ok(err instanceof InvalidScopeError, `Expected InvalidScopeError, got ${err}`);
  }

  t.end();
});

test('can\'t generate email 2fa confirmation code without passing previous email 2fa verification', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const host = 'test.com';
  const email = 'test@gmail.com';
  await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);

  const { id } = validateToken(secondFactorSessionToken, TokenType.Session);
  const sessionToken = createSessionToken(id, Scope.Trading);
  const { noVerificationInProgress } = await api.sendEmailConfirmationCode(sessionToken);

  t.ok(noVerificationInProgress, 'Expected no verification in progress');

  await SecondAuthentications.destroy({
    where: { email_secret: emailSecret },
  });

  t.end();
});

// issueSensitiveSessionToken
test('generate sensitive session token passing email code when email 2fa is only enabled', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const host = 'test.com';
  const email = 'test@gmail.com';
  await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);
  await api.verifyEmailSecret(emailSecret);

  const { id } = validateToken(secondFactorSessionToken, TokenType.Session);
  const sessionToken = createSessionToken(id, Scope.Trading);
  await api.sendEmailConfirmationCode(sessionToken);
  const { sessionToken: sensitiveSessionToken } = await api.issueSensitiveSessionToken(sessionToken, '', EMAIL_CONFIRM_CODE);

  t.ok(sensitiveSessionToken, 'Expected sensitive session token');
  t.end();
});

test('generate sensitive session token passing google token and email code when both of 2fa are enabled', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const { secret } = await api.issueGoogleSecret(secondFactorSessionToken);
  const token = speakeasy.totp({
    secret: secret.base,
    encoding: 'base32',
  });

  await api.verifyGoogleToken(secondFactorSessionToken, token);

  const host = 'test.com';
  const email = 'test@gmail.com';
  await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);
  await api.verifyEmailSecret(emailSecret);

  const { id } = validateToken(secondFactorSessionToken, TokenType.Session);
  const sessionToken = createSessionToken(id, Scope.Trading);
  await api.sendEmailConfirmationCode(sessionToken);
  const { sessionToken: sensitiveSessionToken } = await api.issueSensitiveSessionToken(sessionToken, token, EMAIL_CONFIRM_CODE);

  t.ok(sensitiveSessionToken, 'Expected sensitive session token');
  t.end();
});

test('generate sensitive session token without passing secret if 2FA disabled', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  await api.issueGoogleSecret(secondFactorSessionToken);

  const { id } = validateToken(secondFactorSessionToken, TokenType.Session);
  const sessionToken = createSessionToken(id, Scope.Trading);
  const { sessionToken: sensitiveSessionToken } = await api.issueSensitiveSessionToken(sessionToken, '', '');

  t.ok(sensitiveSessionToken, 'Expected sensitive session token');
  t.end();
});

test('can\'t generate sensitive session token without another scope rather than Trading scope', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);

  try {
    await api.issueSensitiveSessionToken(secondFactorSessionToken, '', '');
    t.fail('Expected InvalidScopeError');
  } catch (err) {
    t.ok(err instanceof InvalidScopeError, `Expected InvalidScopeError, got ${err}`);
  }
  t.end();
});

test('can\'t generate sensitive session token with empty google token when google 2fa is enabled', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const { secret } = await api.issueGoogleSecret(secondFactorSessionToken);
  const token = speakeasy.totp({
    secret: secret.base,
    encoding: 'base32',
  });

  await api.verifyGoogleToken(secondFactorSessionToken, token);

  const { id } = validateToken(secondFactorSessionToken, TokenType.Session);
  const sessionToken = createSessionToken(id, Scope.Trading);

  try {
    await api.issueSensitiveSessionToken(sessionToken, '', '');
    t.fail('Expected google token required error');
  } catch (err) {
    t.ok(err === 'Google token required.', 'Expected google token required error');
  }

  t.end();
});

test('can\'t generate sensitive session token with invalid email verification link when email 2fa is enabled', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const host = 'test.com';
  const email = 'test@gmail.com';
  await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);
  await api.verifyEmailSecret(emailSecret);

  const { id } = validateToken(secondFactorSessionToken, TokenType.Session);
  const sessionToken = createSessionToken(id, Scope.Trading);

  try {
    await api.issueSensitiveSessionToken(sessionToken, '', '');
    t.fail('Expected email code required error');
  } catch (err) {
    t.ok(err === 'Email code required.', 'Expected email code required error');
  }

  t.end();
});

test('can\'t generate sensitive session token with wrong email code when email 2fa is enabled', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const host = 'test.com';
  const email = 'test@gmail.com';
  await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);
  await api.verifyEmailSecret(emailSecret);

  const { id } = validateToken(secondFactorSessionToken, TokenType.Session);
  const sessionToken = createSessionToken(id, Scope.Trading);
  const { emailCodeIncorrect } = await api.issueSensitiveSessionToken(sessionToken, '', 'wrong-email-code');

  t.ok(emailCodeIncorrect, 'Expected email code incorrect');
  t.end();
});

test(`after ${initialAttemptsCount} times in a row of entering wrong email token - email 2fa banned`, async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const host = 'test.com';
  const email = 'test@gmail.com';
  await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);
  await api.verifyEmailSecret(emailSecret);

  const { id } = validateToken(secondFactorSessionToken, TokenType.Session);
  const sessionToken = createSessionToken(id, Scope.Trading);

  let result;
  for (let i = 0; i <= initialAttemptsCount; i += 1) {
    result = await api.issueSensitiveSessionToken(sessionToken, '', 'Wrong-Email-Code');
  }

  t.ok(result.emailTwofaBanned, `Expected email 2fa banned after ${initialAttemptsCount} attempts`);
  t.end();
});

test('after email 2fa banned, it\'s impossible to issue sensitive session token with correct email code', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const host = 'test.com';
  const email = 'test@gmail.com';
  await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);
  await api.verifyEmailSecret(emailSecret);

  const { id } = validateToken(secondFactorSessionToken, TokenType.Session);
  const sessionToken = createSessionToken(id, Scope.Trading);

  for (let i = 0; i <= initialAttemptsCount; i += 1) {
    await api.issueSensitiveSessionToken(sessionToken, '', 'Wrong-Email-Code');
  }

  const r = await api.requestSmsCode(dt, phone);
  t.ok(r && r.attemptsLeft, `Expected success request #1 with attemptsLimits, got ${JSON.stringify(r)}`);

  // we haven't decide of the proper result of such operation
  // const r2 = await api.issueSessionToken(dt, rng.current);
  // t.ok(r2.emailTwofaBanned, `Expected success sessionToken #1, got ${JSON.stringify(r2)}`);

  t.end();
});

test('email verification after google auth enabled', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken: secondFactorSessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);

  const { secret } = await api.issueGoogleSecret(secondFactorSessionToken);
  const token = speakeasy.totp({
    secret: secret.base,
    encoding: 'base32',
  });
  await api.verifyGoogleToken(secondFactorSessionToken, token);

  const host = 'test.com';
  const email = 'test@gmail.com';

  await api.issueEmailVerificationSecret(secondFactorSessionToken, host, email);

  const result = await api.verifyEmailSecret(emailSecret);
  t.ok(result.success, `Expected success email verification, got: ${JSON.stringify(result)}`);

  t.end();
});

// TODO:
// too many requests for the single phone number / ip

test('teardown', async t => {
  if (connection) connection.close();
  shutdownConnection();
  t.end();
});
