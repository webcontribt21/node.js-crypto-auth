import { Members, SecondAuthentications } from '@bct/trading-zoo-node-models';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { initialAttemptsCount } from '../contracts';

export default async clientId => {
  const secret = speakeasy.generateSecret({
    length: 20,
    name: 'BCT'
  });

  const member = await Members.findOne({
    where: { sn: clientId },
    include: [
      { model: SecondAuthentications, as: 'second_authentication' }
    ]
  });

  if (!member) return { tokenRevoked: {} };

  const { id: memberId, second_authentication: secAuth } = member;

  const secAuthId = secAuth ? secAuth.id : null;

  const secAuthData = {
    id: secAuthId,
    member_id: memberId,
    google_secret: '',
    google_temp_secret: secret.base32,
    google_count_attempts: initialAttemptsCount,
  };

  await SecondAuthentications.upsert(secAuthData);
  const dataURL = await QRCode.toDataURL(secret.otpauth_url);

  return { secret: { base: secret.base32, dataURL } };
};
