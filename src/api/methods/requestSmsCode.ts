import { Devices } from '@bct/trading-zoo-node-models';
import { Op } from 'sequelize';
import configLib from 'config';
import { initialAttemptsCount } from '../contracts';

const config: any = configLib;

export default async ({ clock, secretGenerator, sms }, deviceId: string, phone: string) => {
  if (!phone) return { wrongPhoneNumber: 'Phone number required' };

  if (!/^\+\d{8,15}$/.test(phone)) {
    return { wrongPhoneNumber: 'Phone number is not E.164 format (+79100000000 like)' };
  }

  const bannedDevice = await Devices.findOne({
    where: {
      phone_number: phone,
      count_attempts: 0,
    },
  });

  if (bannedDevice) return { phoneBanned: {} };

  const otherDevice = await Devices.findOne({
    where: {
      phone_number: phone,
      device_id: { [Op.not]: deviceId },
      secret_code: { [Op.ne]: null },
      secret_created: { [Op.gt]: clock.utcNow().subtract('5', 'm') },
    },
  });

  if (otherDevice) return { authenticationInProgress: {} };

  const byDeviceId = { where: { device_id: deviceId } };

  const device = await Devices.findOne(byDeviceId);

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
    phone_number: phone,
    secret_code: code,
    secret_created: secretCreated,
    count_attempts: initialAttemptsCount,
    member_id: null,
  };

  if (device) {
    await Devices.update(values, byDeviceId);
  } else {
    await Devices.create(values);
  }

  const result = await sms.sendMessage({ body: `${config.twilio.body} ${code}`, from: config.twilio.from, to: phone });

  if ('ok' in result) {
    return { attemptsLeft: initialAttemptsCount, smsSent: {} };
  }
  if ('code' in result) {
    await Devices.update(
      {
        phone_number: null,
        secret_code: null,
        secret_created: null,
        count_attempts: initialAttemptsCount,
        member_id: null,
      },
      byDeviceId
    );
    return { twilioError: { code: result.code, message: result.errorMessage } };
  }
  return result;
};
