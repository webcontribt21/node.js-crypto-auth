import { Members, SecondAuthentications } from '@bct/trading-zoo-node-models';
import configLib from 'config';
import { initialAttemptsCount, ApiCreateOptions } from '../contracts';

const config: any = configLib;

export default async (
  { clock, emailSecretGenerator, sendMail, emailTemplate }: ApiCreateOptions,
  clientId: string,
  host: string,
  email: string
) => {
  if (
    !/^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/.test(
      email
    )
  ) {
    return { wrongEmail: 'Email format is incorrect' };
  }

  const member = await Members.findOne({
    where: { sn: clientId },
    include: [{ model: SecondAuthentications, as: 'second_authentication' }],
  });

  if (!member) return { tokenRevoked: {} };

  const { id: memberId, second_authentication: secAuth } = member;
  let secret: string;
  let isExitSecret = true;

  for (let index = 0; index < config.emailSecret.generationNumber; index++) {
    secret = emailSecretGenerator();

    const foundSecAuth = await SecondAuthentications.findOne({
      where: { email_secret: secret },
    });

    if (!foundSecAuth) {
      isExitSecret = false;
      break;
    }
  }

  if (secAuth && secAuth.email_factor_enabled) return { twoFactorEnabled: {} };

  if (isExitSecret) return { secretGenerationLimit: {} };

  const secretCreated = clock.utcNow();
  const verificationLink = `${config.emailSecret.authHost}/api/twofa/verify-email/${secret}?redirectHost=${host}`;
  const html = emailTemplate.generateVerificationHtml(email, verificationLink);
  const text = emailTemplate.generateVerificationText(email, verificationLink);

  await sendMail.sendMessage({
    from: config.mailgun.from,
    to: email,
    subject: 'Please confirm your email address',
    text,
    html,
  });

  const secAuthId = secAuth ? secAuth.id : null;
  const secAuthData = {
    id: secAuthId,
    member_id: memberId,
    email_address: email,
    email_secret: secret,
    email_secret_created: secretCreated,
    email_count_attempts: initialAttemptsCount,
  };

  await SecondAuthentications.upsert(secAuthData);

  return { success: {} };
};
