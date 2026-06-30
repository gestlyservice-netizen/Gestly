export interface SmsProvider {
  sendSMS(to: string, message: string, sender?: string): Promise<boolean>;
}
