import configLib from 'config';
import mailgunJS from 'mailgun-js';
import { SendMail, EmailMessage } from './contracts';

const config: any = configLib;

let instance: mailgunJS.Mailgun = null;

const mailgun = () => {
  if (!instance) {
    instance = mailgunJS({
      apiKey: config.mailgun.apiKey,
      domain: config.mailgun.domain,
    });
  }
  return instance;
};

export const mailgunSender: SendMail = {
  sendMessage: async (message: EmailMessage) => {
    await mailgun()
      .messages()
      .send(message);
  },
};
