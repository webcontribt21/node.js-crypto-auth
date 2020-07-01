import { Moment } from 'moment';

export enum Scope {
  Trading = 'Trading',
  Sensitive = 'Sensitive',
  UpdateSecondFactor = 'UpdateSecondFactor',
}

export enum TokenType {
  Device = 'device',
  Session = 'session',
}

export class DeviceTokenRequiredError extends Error {}
export class DeviceTokenInvalidError extends Error {}
export class DeviceTokenExpiredError extends Error {}
export class SessionTokenRequiredError extends Error {}
export class SessionTokenInvalidError extends Error {}
export class SessionTokenExpiredError extends Error {}
export class InvalidScopeError extends Error {}

export type SecretNumberGenerator = () => string;
export type EmailSecretGenerator = () => string;

export type SessionToken = { sessionToken: string };
export type SmsVerificationIncomplete = { smsVerificationIncomplete: {} };
export type WrongPhoneNumber = { wrongPhoneNumber: string };
export type WrongEmail = { wrongEmail: string };
export type PhoneBanned = { phoneBanned: {} };
export type AttemptsLeft = { attemptsLeft: number };
export type SmsSent = AttemptsLeft & { smsSent: {} };
export type AuthenticationInProgress = { authenticationInProgress: {} };
export type WrongCode = AttemptsLeft & { codeIncorrect: {} };
export type NoVerificationInProgress = { noVerificationInProgress: {} };
export type TwilioError = { twilioError: { code: string; message: string } };
export type TwofaStatus = { status: { googleFactorEnabled: boolean, emailFactorEnabled: boolean } };
export type TwofaFactorEnabled = { twoFactorEnabled: {} };
export type GoogleSecret = { secret: { base: string, dataURL: any } };
export type GoogleTokenIncorrect = AttemptsLeft & { googleTokenIncorrect: {} };
export type GoogleTwofaBanned = { googleTwofaBanned: {} };
export type EmailTwofaBanned = { emailTwofaBanned: {} };
export type WrongEmailSecret = { wrongEmailSecret: {} };
export type SecretGenerationLimit = { secretGenerationLimit: {} };
export type EmailSecretExpired = { emailSecretExpired: {} };
export type EmailCodeIncorrect = AttemptsLeft & { emailCodeIncorrect: {} };
export type TokenRevoked = { tokenRevoked: {} };
export type SuccessResponse = { success: {} };
type SmsNotSent = { errorMessage: string; code: string };
type Ok = { ok: {} };

export interface Api {
  createDeviceToken: () => string;
  reissueSessionToken: (deviceToken: string) => Promise<SessionToken | SmsVerificationIncomplete>;

  requestSmsCode: (
    deviceToken: string,
    phone: string
  ) => Promise<SmsSent | PhoneBanned | WrongPhoneNumber | AuthenticationInProgress | TwilioError>;

  requestTwofaSmsCode: (
    deviceToken: string
  ) => Promise<SmsSent | PhoneBanned | TokenRevoked | TwilioError>;

  issueSessionToken: (
    deviceToken: string,
    secretCode: string,
    scope: Scope
  ) => Promise<SessionToken | WrongCode | NoVerificationInProgress | PhoneBanned>;

  getTwofaStatus: (sessionToken: string) => Promise<TwofaStatus | TokenRevoked>;

  issueGoogleSecret: (sessionToken: string) => Promise<GoogleSecret | TokenRevoked>;

  verifyGoogleToken: (
    sessionToken: string,
    googleToken: string
  ) => Promise<SuccessResponse | TokenRevoked | NoVerificationInProgress | WrongCode | GoogleTwofaBanned>;

  disableGoogle2FA: (
    sessionToken: string
  ) => Promise<SuccessResponse | TokenRevoked>;

  issueEmailVerificationSecret: (
    deviceToken: string,
    host: string,
    email: string
  ) => Promise<SuccessResponse | WrongEmail | TokenRevoked | SecretGenerationLimit | TwofaFactorEnabled>;

  verifyEmailSecret: (
    secret: string
  ) => Promise<SuccessResponse | WrongEmailSecret | EmailSecretExpired>;

  disableEmail2FA: (
    sessionToken: string
  ) => Promise<SuccessResponse | TokenRevoked>;

  sendEmailConfirmationCode: (
    sessionToken: string
  ) => Promise<SuccessResponse | TokenRevoked | NoVerificationInProgress>;

  issueSensitiveSessionToken: (
    sessionToken: string,
    googleToken: string,
    secretCode: string
  ) => Promise<SessionToken | TokenRevoked | GoogleTwofaBanned | GoogleTokenIncorrect | EmailTwofaBanned | EmailCodeIncorrect>;
}

export interface Clock {
  utcNow(): Moment;
}

export interface Message {
  body: string;
  from: string;
  to: string;
}

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendSms {
  sendMessage(message: Message): Promise<Ok | WrongPhoneNumber | SmsNotSent>;
}

export interface SendMail {
  sendMessage(message: EmailMessage): Promise<void>;
}

export interface MailTemplate {
  generateVerificationHtml(email: string, verificationLink: string): string;
  generateVerificationText(email: string, verificationLink: string): string;
  generateCodeHtml(email: string, code: string): string;
  generateCodeText(email: string, code: string): string;
}

export interface ApiCreateOptions {
  secretGenerator: SecretNumberGenerator;
  emailConfirmationCodeGenerator: SecretNumberGenerator;
  emailSecretGenerator: EmailSecretGenerator;
  clock: Clock;
  sms: SendSms;
  sendMail: SendMail;
  emailTemplate: MailTemplate;
}

export const initialAttemptsCount = 100;
