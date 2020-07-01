import { Members, Devices } from '@bct/trading-zoo-node-models';
import { createSessionToken } from '../jwt';
import { Scope } from '../contracts';

export default async deviceId => {
  const device = await Devices.findOne({ where: { device_id: deviceId } });
  if (!device || !device.member_id) return { smsVerificationIncomplete: {} };
  const member = await Members.findOne({ where: { id: device.member_id } });
  if (!member) return { smsVerificationIncomplete: {} };
  return { sessionToken: createSessionToken(member.sn, Scope.Trading) };
};
