/* eslint-disable no-await-in-loop */
const { setupConnection, setupPublishing, shutdownConnection } = require('@bct/simple-amqp-client');
const { connect } = require('@bct/trading-zoo-node-models');
const config = require('config');
const { test } = require('tape');
const jwt = require('jsonwebtoken');
const validate = require('uuid-validate');

const {
  DeviceTokenRequiredError,
  DeviceTokenInvalidError,
  Scope,
} = require('../dist/api/contracts');

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

const wrongCode = () => rng.current - 5;

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

test('can ask new device tokens', t => {
  const token = api.createDeviceToken();
  t.ok(token, 'Expected non empty token');

  const { sub } = jwt.decode(token);
  t.ok(sub, 'Expected non empty subject (deviceId)');
  t.ok(validate(sub), 'Expected deviceId as uuid');
  t.end();
});

test('cannot issue session token without device token', async t => {
  try {
    await api.reissueSessionToken();
    t.fail('Expected DeviceTokenRequiredError');
  } catch (err) {
    t.ok(err instanceof DeviceTokenRequiredError, `Expected DeviceTokenRequiredError, got ${err}`);
  }

  t.end();
});

test('invalid device token throws an error', async t => {
  try {
    await api.reissueSessionToken('WRONG-TOKEN', Scope.Trading);
    t.fail('Expected DeviceTokenInvalidError');
  } catch (err) {
    t.ok(err instanceof DeviceTokenInvalidError, `Expected DeviceTokenInvalidError, got ${err}`);
  }

  t.end();
});

test("newly created device token returns result that verification wasn't passed", async t => {
  const dt = api.createDeviceToken();

  for (const s of Object.keys(Scope)) {
    const result = await api.reissueSessionToken(dt, s);
    t.ok(result.smsVerificationIncomplete);
  }

  t.end();
});

test('passing correct sms secret for trading scope issues session token', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  const smsResult = await api.requestSmsCode(dt, phone);
  t.ok(smsResult.attemptsLeft);

  const result = await api.issueSessionToken(dt, rng.current, Scope.Trading);
  t.ok(result, 'Expected non empty result');
  t.ok(result.sessionToken, 'Expected successful case');

  const token = jwt.decode(result.sessionToken);
  t.ok(token, 'Expected non-empty jwt-token');
  t.ok(token.sub, 'Expected non-empty subject');

  t.end();
});

test('issue session token with unknown device fails with "Verification not started error"', async t => {
  const dt = api.createDeviceToken();
  const result = await api.issueSessionToken(dt, wrongCode(), Scope.Trading);
  t.ok(result, 'Expected non-empty result');
  t.ok(result.noVerificationInProgress, 'Expected noVerificationInProgress error');

  t.end();
});

test('requesting sms to wrong phone number fails', async t => {
  const dt = api.createDeviceToken();
  const r = await api.requestSmsCode(dt, '+7-SOME-CRAP');
  t.ok(r);
  t.ok(r.wrongPhoneNumber);

  t.end();
});

test('replying with wrongCode if sender reported that error', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  sms.setFail();
  const r = await api.requestSmsCode(dt, phone);

  t.ok(r, 'Expected reply');
  t.ok(r.wrongPhoneNumber, 'Expected error is wrongPhoneNumber');

  t.end();
});

test("it's not possible to pass authentication for the same phone on multiple devices simultaneously", async t => {
  const dt1 = api.createDeviceToken();
  const dt2 = api.createDeviceToken();
  const phone = generatePhoneNumber();

  const smsResult1 = await api.requestSmsCode(dt1, phone);
  t.ok(smsResult1);
  t.ok(smsResult1.attemptsLeft);

  const smsResult2 = await api.requestSmsCode(dt2, phone);
  t.ok(smsResult2);
  t.ok(smsResult2.authenticationInProgress);

  t.end();
});

test('its possible to pass authentication for the same phone on multiple devices in 5 min', async t => {
  const dt1 = api.createDeviceToken();
  const dt2 = api.createDeviceToken();
  const phone = generatePhoneNumber();

  clock.pause();

  const smsResult1 = await api.requestSmsCode(dt1, phone);
  t.ok(smsResult1);
  t.ok(smsResult1.attemptsLeft);

  clock.forward(10, 'm');

  const smsResult2 = await api.requestSmsCode(dt2, phone);
  t.ok(smsResult2);
  t.ok(smsResult2.attemptsLeft);
  clock.reset();

  t.end();
});

test('passing wrong code decreases attempts count', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  const smsResult = await api.requestSmsCode(dt, phone);
  t.ok(smsResult.attemptsLeft);

  const tokenResult = await api.issueSessionToken(dt, wrongCode(), Scope.Trading);
  t.ok(tokenResult.codeIncorrect);
  t.equal(tokenResult.attemptsLeft, smsResult.attemptsLeft - 1, 'Expected decreased count of attempts');

  t.end();
});

test('after 5 times in a row of entering wrong code - phone number gets banned', async t => {
  clock.pause();

  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  const smsResult = await api.requestSmsCode(dt, phone);
  t.ok(smsResult.attemptsLeft);

  let result;
  for (let i = 0; i < smsResult.attemptsLeft; i += 1) {
    result = await api.issueSessionToken(dt, wrongCode(), Scope.Trading);
  }
  t.ok(result.phoneBanned, 'Expected phone banned after 5 attempts');

  // sending new request in 20 minutes from the second device

  clock.forward(20, 'm');

  const freshDeviceToken = await api.createDeviceToken();
  const secondSmsRequest = await api.requestSmsCode(freshDeviceToken, phone);
  t.ok(secondSmsRequest.phoneBanned, 'Expected phoneBanned after 5 attempts while resend secret');

  clock.reset();
  t.end();
});

test('same phone numbers bound to the same client ids', async t => {
  const dt1 = api.createDeviceToken();
  const phone = generatePhoneNumber();

  const dt2 = api.createDeviceToken();

  await api.requestSmsCode(dt1, phone);
  const st1 = await api.issueSessionToken(dt1, rng.current, Scope.Trading);
  t.ok(st1.sessionToken, 'Expected session token from initial authentication');
  const { sub: clientId1 } = jwt.decode(st1.sessionToken);

  const r2 = await api.requestSmsCode(dt2, phone);
  t.ok(r2.attemptsLeft, 'Expected non zero attempts for the second registration');
  const st2 = await api.issueSessionToken(dt2, rng.current, Scope.Trading);
  t.ok(st2.sessionToken, 'Expected session token from second authentication');
  const { sub: clientId2 } = jwt.decode(st2.sessionToken);

  t.equal(clientId1, clientId2, 'Expected different clientIds for different numbers');

  t.end();
});

test('different phone numbers bound to different client ids', async t => {
  const dt1 = api.createDeviceToken();
  const phone1 = generatePhoneNumber();

  const dt2 = api.createDeviceToken();
  const phone2 = generatePhoneNumber();

  await api.requestSmsCode(dt1, phone1);
  const st1 = await api.issueSessionToken(dt1, rng.current, Scope.Trading);
  const { sub: clientId1 } = jwt.decode(st1.sessionToken);

  await api.requestSmsCode(dt2, phone2);
  const st2 = await api.issueSessionToken(dt2, rng.current, Scope.Trading);
  const { sub: clientId2 } = jwt.decode(st2.sessionToken);

  t.notEqual(clientId1, clientId2, 'Expected different clientIds for different numbers');

  t.end();
});

test('send sms code for UpdateSecondFactor scope session with verified device token', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  const smsResult = await api.requestSmsCode(dt, phone);
  t.ok(smsResult.attemptsLeft);

  const result = await api.issueSessionToken(dt, rng.current, Scope.Trading);
  t.ok(result, 'Expected non empty result');
  t.ok(result.sessionToken, 'Expected successful case');

  const { smsSent } = await api.requestTwofaSmsCode(dt);

  t.ok(smsSent, 'Expected sms sent');
  t.end();
});

test('can\'t send sms code for UpdateSecondFactor scope session without issuing session token', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);

  const { tokenRevoked } = await api.requestTwofaSmsCode(dt);

  t.ok(tokenRevoked, 'Expected tokenRevoked error');
  t.end();
});

test('reissue trading scope', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  const initial = await api.issueSessionToken(dt, rng.current, Scope.Trading);
  const second = await api.reissueSessionToken(dt, Scope.Trading);
  t.ok(second.sessionToken, 'Expected successful token');

  const { sub: sub1 } = jwt.decode(initial.sessionToken);
  const { sub: sub2 } = jwt.decode(second.sessionToken);

  t.equal(sub1, sub2, 'Expected the same subject');

  t.end();
});

test('reissue sensitive scope', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);
  await api.issueSessionToken(dt, rng.current, Scope.Sensitive);
  const second = await api.reissueSessionToken(dt);

  const { scope } = jwt.decode(second.sessionToken);

  t.equal('trading', scope, 'Reissued token always has Trading scope');

  t.end();
});

const sendTwoRequests = async (...delay) => {
  clock.pause();

  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  await api.requestSmsCode(dt, phone);

  const { current: first } = rng;

  clock.forward(...delay);

  await api.requestSmsCode(dt, phone);

  const { current: second } = rng;

  clock.reset();

  return { first, second };
};

test('allows to send the second sms request with the same code', async t => {
  const { first, second } = await sendTwoRequests(10, 's');
  t.equal(first, second, 'Expected the same code sent within 5m period');
  t.end();
});

test('allows to send the second sms request with the same code', async t => {
  const { first, second } = await sendTwoRequests(6, 'm');
  t.notEqual(first, second, 'Expected different codes sent with more than 5m period');
  t.end();
});

test('subsequent authentication works', async t => {
  const dt = api.createDeviceToken();
  const phone = generatePhoneNumber();

  const r = await api.requestSmsCode(dt, phone);
  t.ok(r && r.attemptsLeft, `Expected success request #1 with attemptsLimits, got ${JSON.stringify(r)}`);

  const r1 = await api.issueSessionToken(dt, rng.current);
  t.ok(r1 && r1.sessionToken, `Expected success sessionToken #1, got ${JSON.stringify(r1)}`);

  const r2 = await api.requestSmsCode(dt, phone);
  t.ok(r2 && r2.attemptsLeft, `Expected success request #2 with attemptsLimits, got ${JSON.stringify(r2)}`);

  const r3 = await api.issueSessionToken(dt, rng.current);
  t.ok(r3 && r3.sessionToken, `Expected success sessionToken #2, got ${JSON.stringify(r3)}`);

  t.end();
});

// TODO:
// too many requests for the single phone number / ip

test('teardown', async t => {
  if (connection) connection.close();
  shutdownConnection();
  t.end();
});
