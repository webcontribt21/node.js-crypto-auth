import { Members, SecondAuthentications } from '@bct/trading-zoo-node-models';
import speakeasy from 'speakeasy';
import { initialAttemptsCount } from '../contracts';

export default async (clientId: string, googleToken: string) => {
  const member = await Members.findOne({
    where: { sn: clientId },
    include: [
      { model: SecondAuthentications, as: 'second_authentication' }
    ]
  });

  if (!member) return { tokenRevoked: {} };

  const { second_authentication: secAuth } = member;

  if (!secAuth) return { tokenRevoked: {} };

  const {
    id: secAuthId,
    google_secret: googleSecret,
    google_temp_secret: googleTempSecret,
    google_factor_enabled: googleFactorEnabled
  } = secAuth;

  if (googleFactorEnabled) { // google 2fa is already enabled
    if (!googleSecret) return { noVerificationInProgress: {} };
  } else {
    if (!googleTempSecret) return { noVerificationInProgress: {} };
  }

  const secAuthQuery = {
    where: {
      id: secAuthId,
    },
  };

  let googleAttemptsCount = secAuth.google_count_attempts;

  if (googleAttemptsCount <= 0) return { googleTwofaBanned: {} };

  const result = await SecondAuthentications.decrement('google_count_attempts', secAuthQuery);
  googleAttemptsCount = result[0][0][0].google_count_attempts;

  const verified = speakeasy.totp.verify({
    secret: googleFactorEnabled ? googleSecret : googleTempSecret,
    encoding: 'base32',
    token: googleToken.toString()
  });

  if (!verified) return { codeIncorrect: {}, attemptsLeft: googleAttemptsCount };

  const verifySecAuthData = {
    google_count_attempts: initialAttemptsCount
  };

  const createSecAuthData = {
    google_factor_enabled: true,
    google_count_attempts: initialAttemptsCount,
    google_secret: googleTempSecret
  };

  const secAuthData = googleFactorEnabled ? verifySecAuthData : createSecAuthData;

  const secAuthsQuery = {
    where: {
      id: secAuthId,
    },
  };

  await SecondAuthentications.update(secAuthData, secAuthsQuery);

  return { success: {} };
};