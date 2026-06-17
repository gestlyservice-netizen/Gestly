import { OvhProvider } from "./ovh-provider";

export const smsProvider = new OvhProvider();
export const sendSMS = (to: string, msg: string) =>
  smsProvider.sendSMS(to, msg);
