import { Members, SecondAuthentications } from '@bct/trading-zoo-node-models';
import configLib from 'config';
import { initialAttemptsCount, ApiCreateOptions } from '../contracts';

const config: any = configLib;

export default async ({ emailConfirmationCodeGenerator, sendMail, emailTemplate }: ApiCreateOptions, clientId: string) => {
  const member = await Members.findOne({
    where: { sn: clientId },
    include: [
      { model: SecondAuthentications, as: 'second_authentication' }
    ]
  });

  if (!member) return { tokenRevoked: {} };

  const { id: memberId, second_authentication: secAuth } = member;

  if (!secAuth) return { tokenRevoked: {} };

  const {
    id: secAuthId,
    email_factor_enabled: emailFactorEnabled,
    email_address: emailAddress,
  } = secAuth;

  if (!emailAddress) return  { noVerificationInProgress: {} };
  if (!emailFactorEnabled) return { noVerificationInProgress: {} };

  const emailCode = emailConfirmationCodeGenerator();

  const html = emailTemplate.generateCodeHtml(emailAddress, emailCode);
  const text = emailTemplate.generateCodeText(emailAddress, emailCode);

  await sendMail.sendMessage({
    from: config.mailgun.from,
    to: emailAddress,
    subject: 'Your secret code to perform sensitive operation',
    text,
    html
  });

  const secAuthData = {
    id: secAuthId,
    member_id: memberId,
    email_code: emailCode,
    email_count_attempts: initialAttemptsCount,
  };

  await SecondAuthentications.upsert(secAuthData);
  return { success: {} };
};
