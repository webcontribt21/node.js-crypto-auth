import { SecondAuthentications } from '@bct/trading-zoo-node-models';

export default async ({ clock }, secret: string) => {
  const secondAuthentication = await SecondAuthentications.findOne({
    where: { email_secret: secret }
  });

  if (!secondAuthentication) return { wrongEmailSecret: {} };

  let {
    email_secret: emailSecret,
    email_secret_created: emailSecretCreated
  } = secondAuthentication;

  if (emailSecret && emailSecretCreated <= clock.utcNow().subtract(10, 'm')) return { emailSecretExpired: {} };

  await secondAuthentication.update({
    email_secret: null,
    email_factor_enabled: true
  });

  return { success: {} };
};
