import { Members, SecondAuthentications } from '@bct/trading-zoo-node-models';

export default async clientId => {
  const member = await Members.findOne({
    where: { sn: clientId },
    include: [
      { model: SecondAuthentications, as: 'second_authentication' }
    ]
  });

  if (!member) return { tokenRevoked: {} };

  const { second_authentication: secAuth } = member;
  const googleFactorEnabled = secAuth ? secAuth.google_factor_enabled : false;
  const emailFactorEnabled = secAuth ? secAuth.email_factor_enabled : false;

  return { status: { googleFactorEnabled, emailFactorEnabled } };
};
