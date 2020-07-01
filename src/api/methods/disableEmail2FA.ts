import { Members, SecondAuthentications } from '@bct/trading-zoo-node-models';
import { initialAttemptsCount } from '../contracts';

export default async clientId => {
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
    email_factor_enabled: false,
    email_count_attempts: initialAttemptsCount,
  };

  await SecondAuthentications.upsert(secAuthData);

  return { success: {} };
};
