/* eslint-disable no-await-in-loop */
const { setupConnection, setupPublishing, shutdownConnection } = require('@bct/simple-amqp-client');
const { connect } = require('@bct/trading-zoo-node-models');
const config = require('config');
const { test } = require('tape');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');

const {
  DeviceTokenInvalidError,
  SessionTokenInvalidError,
  InvalidScopeError,
  Scope,
  initialAttemptsCount,
  TokenType,
} = require('../dist/api/contracts');
const { createSessionToken, createDeviceToken, validateToken } = require('../dist/api/jwt');

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

test('setup', async t => {
  connection = connect({ ...config.db, logger: { info: () => { } } });
  api = createApi({
    clock,
    secretGenerator: rng.next,
    sms,
  });

  await setupDaemon();
  const publishToUserData = await setupPublishing('UpdateUserBalancesRequest');
  PublishChannel.default.setPublishChannel('UpdateUserBalancesRequest', publishToUserData);

  t.end();
});

test('get two factor authentication status', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken } = await api.issueSessionToken(dt, rng.current, Scope.Trading);
  const { status } = await api.getTwofaStatus(sessionToken);

  t.ok(status.googleFactorEnabled === false, 'Expected disabled google 2fa status');
  t.end();
});

test('can\'t process to get two factor authentication status with session token revoked', async t => {
  const sessionToken = createSessionToken('Wrong-Client-id', Scope.Trading);
  const { tokenRevoked } = await api.getTwofaStatus(sessionToken);

  t.ok(tokenRevoked, 'Expected revoked session token error');
  t.end();
});

test('can get two factor authentication status with Trading scope', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken } = await api.issueSessionToken(dt, rng.current, Scope.Trading);
  const { status } = await api.getTwofaStatus(sessionToken);

  t.ok(status, 'Expected two factor authentication status');
  t.end();
});

test('issue google secret', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const { scope } = jwt.verify(sessionToken, config.jwt.session.secret);

  t.ok(scope === Scope.UpdateSecondFactor.toLowerCase(), 'Expected UpdateSecondFactor scope');

  const { secret } = await api.issueGoogleSecret(sessionToken);

  t.ok(secret.base, 'Expected secret for google 2fa');
  t.ok(secret.dataURL, 'Expected qrcode image for google 2fa');
  t.end();
});

test('can\'t process to issue google secret with session token revoked', async t => {
  const sessionToken = createSessionToken('Wrong-Client-id', Scope.UpdateSecondFactor);
  const { tokenRevoked } = await api.issueGoogleSecret(sessionToken);

  t.ok(tokenRevoked, 'Expected revoked session token error');
  t.end();
});

test('can\'t issue google secret with another scope rather than UpdateSecondFactor', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken } = await api.issueSessionToken(dt, rng.current, Scope.Trading);

  try {
    await api.issueGoogleSecret(sessionToken);
    t.fail('Expected InvalidScopeError');
  } catch (err) {
    t.ok(err instanceof InvalidScopeError, `Expected InvalidScopeError, got ${err}`);
  }

  t.end();
});

test('it\'s impossible to issue google secret with invalid session token', async t => {
  try {
    await api.issueGoogleSecret('WRONG-TOKEN');
    t.fail('Expected SessionTokenInvalidError');
  } catch (err) {
    t.ok(err instanceof SessionTokenInvalidError, `Expected SessionTokenInvalidError, got ${err}`);
  }
  t.end();
});

test('verify google secret under UpdateSecondFactor scope', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const { secret } = await api.issueGoogleSecret(sessionToken);
  const token = speakeasy.totp({
    secret: secret.base,
    encoding: 'base32',
  });

  const { success } = await api.verifyGoogleToken(sessionToken, token);
  t.ok(success, 'Expected google 2fa successful verification');
  t.end();
});

test('can\'t process to verify google secret with session token revoked', async t => {
  const sessionToken = createSessionToken('Wrong-Client-id', Scope.UpdateSecondFactor);
  const { tokenRevoked } = await api.verifyGoogleToken(sessionToken, 'Wrong-google-token');

  t.ok(tokenRevoked, 'Expected revoked session token error');
  t.end();
});

test('can\'t verify google 2fa with invalid google token', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  await api.issueGoogleSecret(sessionToken);

  const { codeIncorrect } = await api.verifyGoogleToken(sessionToken, 'Wrong-Google-Token');

  t.ok(codeIncorrect, 'Expected WrongCode error');
  t.end();
});

test(`after ${initialAttemptsCount} times in a row of entering wrong google token - google 2fa verification banned`, async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  await api.issueGoogleSecret(sessionToken);

  let result;
  for (let i = 0; i <= initialAttemptsCount; i += 1) {
    result = await api.verifyGoogleToken(sessionToken, 'Wrong-Google-Token');
  }

  t.ok(result.googleTwofaBanned, `Expected google 2fa verification banned after ${initialAttemptsCount} attempts`);
  t.end();
});

// disableGoogle2FA
test('disable google 2fa', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken } = await api.issueSessionToken(dt, rng.current, Scope.UpdateSecondFactor);
  const { success } = await api.disableGoogle2FA(sessionToken);

  t.ok(success, 'Expected success 2fa google disabling');
  t.end();
});

test('can\'t disable google 2fa with another scope rather than UpdateSecondFactor', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const { sessionToken } = await api.issueSessionToken(dt, rng.current, Scope.Trading);

  try {
    await api.disableGoogle2FA(sessionToken);
    t.fail('Expected InvalidScopeError');
  } catch (err) {
    t.ok(err instanceof InvalidScopeError, `Expected InvalidScopeError, got ${err}`);
  }

  t.end();
});

test('can\'t process to disable google 2fa with session token revoked', async t => {
  const sessionToken = createSessionToken('Wrong-Client-id', Scope.UpdateSecondFactor);
  const { tokenRevoked } = await api.disableGoogle2FA(sessionToken);

  t.ok(tokenRevoked, 'Expected revoked session token error');
  t.end();
});

test('create session token with specific client id and scope', async t => {
  const clientId = '12';
  const sessionToken = createSessionToken(clientId, Scope.Trading);
  t.ok(sessionToken, 'Expected non-empty session token');

  const { scope, sub } = jwt.verify(sessionToken, config.jwt.session.secret);

  t.ok(sub === clientId, 'Expected the same client id');
  t.ok(scope === Scope.Trading.toLowerCase(), 'Expected Trading scope');
  t.end();
});

test('can\'t create session token with empty scope', async t => {
  try {
    createSessionToken('12');
    t.fail('Expected InvalidScopeError');
  } catch (err) {
    t.ok(err instanceof InvalidScopeError, `Expected InvalidScopeError, got ${err}`);
  }

  t.end();
});

test('create device token by specific device id', async t => {
  const deviceId = '12';
  const deviceToken = createDeviceToken(deviceId);
  t.ok(deviceToken, 'Expected non-empty device token');

  const { sub } = jwt.verify(deviceToken, config.jwt.device.secret);

  t.ok(sub === deviceId, 'Expected the same device id');
  t.end();
});

test('validate token with specific token type', async t => {
  const clientId = '12';
  const sessionToken = createSessionToken(clientId, Scope.Trading);
  const { id } = validateToken(sessionToken, TokenType.Session);

  t.ok(id === clientId, 'Expected the same id');
  t.end();
});

test('can\'t validate token with incorrect token type', async t => {
  try {
    const clientId = '12';
    const sessionToken = createSessionToken(clientId, Scope.Trading);
    validateToken(sessionToken, TokenType.Device);
    t.fail('Expected DeviceTokenInvalidError');
  } catch (err) {
    t.ok(err instanceof DeviceTokenInvalidError, `Expected DeviceTokenInvalidError, got ${err}`);
  }

  t.end();
});

// issueSensitiveSessionToken
test('generate sensitive session token passing google token when google 2fa is only enabled', async t => {
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
  const { sessionToken: sensitiveSessionToken } = await api.issueSensitiveSessionToken(sessionToken, token, '');

  t.ok(sensitiveSessionToken, 'Expected sensitive session token');
  t.end();
});

test('can\'t generate sensitive session token with wrong google token is required when google 2fa is enabled', async t => {
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
  const { googleTokenIncorrect } = await api.issueSensitiveSessionToken(sessionToken, 'Wrong-Google-Token', '');

  t.ok(googleTokenIncorrect, 'Expected google token incorrect');
  t.end();
});

test(`after ${initialAttemptsCount} times in a row of entering wrong google token - google 2fa banned`, async t => {
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

  let result;
  for (let i = 0; i <= initialAttemptsCount; i += 1) {
    result = await api.issueSensitiveSessionToken(sessionToken, 'Wrong-Secret', '');
  }

  t.ok(result.googleTwofaBanned, `Expected google 2fa verification banned after ${initialAttemptsCount} attempts`);
  t.end();
});

test('after google 2fa banned, it\'s impossible to issue sensitive session token with correct google code', async t => {
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
  for (let i = 0; i <= initialAttemptsCount; i += 1) {
    await api.issueSensitiveSessionToken(sessionToken, 'Wrong-Secret', '');
  }

  const { googleTwofaBanned } = await api.issueSensitiveSessionToken(sessionToken, token, '');

  t.ok(googleTwofaBanned, 'Expected google 2fa banned');
  t.end();
});

// TODO:
// too many requests for the single phone number / ip

test('teardown', async t => {
  if (connection) connection.close();
  shutdownConnection();
  t.end();
});
