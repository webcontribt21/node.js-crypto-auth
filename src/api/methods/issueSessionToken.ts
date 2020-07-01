import { Members, Devices } from '@bct/trading-zoo-node-models';

import { initialAttemptsCount, Scope } from '../contracts';
import { createSessionToken } from '../jwt';
import PublishChannel from "../../publish";

const finishAuthentication = async (deviceId: string, phoneNumber: string) => {
  const email = `phones${phoneNumber}@phones-email`;
  const created = await Members.upsert({ email });
  const member = await Members.findOne({ where: { email } });
  const { sn: ClientId } = member;

  const publish = PublishChannel.getPublishChannel('UpdateUserBalancesRequest');
  await publish('', { ClientId, IsCreated: created, IsReset: false }, {});

  await Devices.update(
    {
      member_id: member.id,
      count_attempts: initialAttemptsCount,
      secret_code: null,
      secret_created: null,
    },
    { where: { device_id: deviceId } }
  );

  return member;
};

export default async (deviceId: string, secretCode: string, scope: Scope) => {
  const byDeviceId = { where: { device_id: deviceId } };
  const device = await Devices.findOne(byDeviceId);

  if (!device || !device.secret_code) return { noVerificationInProgress: {} };

  if (device.attemptsCount <= 0) {
    return { phoneBanned: {} };
  }

  const result = await Devices.decrement('count_attempts', byDeviceId);
  const attemptsCount = result[0][0][0].count_attempts;

  if (device.secret_code === `${secretCode}`) {
    const { sn } = await finishAuthentication(deviceId, device.phone_number);
    return { sessionToken: createSessionToken(sn, scope || Scope.Trading) };
  }
  return attemptsCount > 0 ? { codeIncorrect: {}, attemptsLeft: attemptsCount } : { phoneBanned: {} };
};
