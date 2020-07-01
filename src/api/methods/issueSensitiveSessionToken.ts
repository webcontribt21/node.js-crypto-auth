import { Members, SecondAuthentications } from '@bct/trading-zoo-node-models';
import speakeasy from 'speakeasy';
import { initialAttemptsCount, Scope } from '../contracts';
import { createSessionToken } from '../jwt';

export default async (clientId: string, googleToken: string, code: string) => {
  const member = await Members.findOne({
    where: { sn: clientId },
    include: [
      { model: SecondAuthentications, as: 'second_authentication' }
    ]
  });

  if (!member) return { tokenRevoked: {} };

  const { id: memberId, second_authentication: secAuth } = member;

  if (!secAuth) return { tokenRevoked: {} };

  let {
    id: secAuthId,
    google_secret: googleSecret,
    google_count_attempts: googleCountAttempts,
    google_factor_enabled: googleFactorEnabled,
    email_code: emailCode,
    email_count_attempts: emailCountAttempts,
    email_factor_enabled: emailFactorEnabled,
  } = secAuth;

  const secAuthQuery = {
    where: {
      id: secAuthId,
    },
  };

  if (googleFactorEnabled) {
    if (!googleToken) throw 'Google token required.';
    if (googleCountAttempts <= 0) return { googleTwofaBanned: {} };

    const verified = speakeasy.totp.verify({
      secret: googleSecret,
      encoding: 'base32',
      token: googleToken.toString()
    });

    if (!verified) {
      const result = await SecondAuthentications.decrement('google_count_attempts', secAuthQuery);
      googleCountAttempts = result[0][0][0].google_count_attempts;

      return { googleTokenIncorrect: {}, attemptsLeft: googleCountAttempts };
    }
  }

  if (emailFactorEnabled) {
    if (!code) throw 'Email code required.';
    if (emailCountAttempts <= 0) return { emailTwofaBanned: {} };

    if (code !== emailCode) {
      const result = await SecondAuthentications.decrement('email_count_attempts', secAuthQuery);
      emailCountAttempts = result[0][0][0].email_count_attempts;

      return { emailCodeIncorrect: {}, attemptsLeft: emailCountAttempts };
    }
  }

  const secAuthData = {
    id: secAuthId,
    member_id: memberId,
    google_secret: null,
    google_count_attempts: googleFactorEnabled ? initialAttemptsCount : googleCountAttempts,
    email_code: null,
    email_count_attempts: emailFactorEnabled ? initialAttemptsCount : emailCountAttempts,
  };

  await SecondAuthentications.upsert(secAuthData);

  return { sessionToken: createSessionToken(clientId, Scope.Sensitive) };
};
