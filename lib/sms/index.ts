import { OvhProvider } from "./ovh-provider";

export const smsProvider = new OvhProvider();
export const sendSMS = (to: string, msg: string, sender?: string) =>
  smsProvider.sendSMS(to, msg, sender);
