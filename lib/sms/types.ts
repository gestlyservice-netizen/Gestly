export interface SmsProvider {
  sendSMS(to: string, message: string): Promise<boolean>;
}
