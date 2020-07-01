import { Devices } from '@bct/trading-zoo-node-models';
import configLib from 'config';
import { initialAttemptsCount } from '../contracts';

const config: any = configLib;

export default async ({ clock, secretGenerator, sms }, deviceId: string) => {
  const byDeviceId = { where: { device_id: deviceId } };

  const device = await Devices.findOne(byDeviceId);

  const { member_id: memberId, phone_number: phone, count_attempts: countAttempts } = device;

  if (!memberId) return { tokenRevoked: {} };

  if (countAttempts <= 0) return { phoneBanned: {} };

  let code;
  let secretCreated;

  if (device && device.secret_code && device.secret_created > clock.utcNow().subtract(5, 'm')) {
    code = device.secret_code;
    secretCreated = device.secret_created;
  } else {
    code = secretGenerator();
    secretCreated = clock.utcNow();
  }

  const values = {
    device_id: deviceId,
    secret_code: code,
    secret_created: secretCreated,
    count_attempts: initialAttemptsCount,
  };

  await Devices.update(values, byDeviceId);

  const result = await sms.sendMessage({ body: `${config.twilio.body} ${code}`, from: config.twilio.from, to: phone });

  if ('ok' in result) {
    return { attemptsLeft: initialAttemptsCount, smsSent: {} };
  }
  if ('code' in result) {
    await Devices.update(
      {
        secret_code: null,
        secret_created: null,
        count_attempts: initialAttemptsCount,
      },
      byDeviceId
    );
    return { twilioError: { code: result.code, message: result.errorMessage } };
  }
  return result;
};
