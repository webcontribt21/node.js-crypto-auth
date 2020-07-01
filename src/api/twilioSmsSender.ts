import configLib from 'config';
import twilio from 'twilio';
import { SendSms, Message } from './contracts';

const config: any = configLib;

let instance: twilio.Twilio = null;

const twilioClient = () => {
  if (!instance) instance = twilio(config.twilio.accountSid, config.twilio.authToken);
  return instance;
};

const twilioSender: SendSms = {
  sendMessage: async (message: Message) => {
    try {
      await twilioClient().messages.create(message);
      return { ok: {} };
    } catch (err) {
      if (err.code == 21211) {
        return { wrongPhoneNumber: err.message, code: err.code };
      }

      return { errorMessage: err.message, code: err.code };
    }
  },
};

export default twilioSender;
