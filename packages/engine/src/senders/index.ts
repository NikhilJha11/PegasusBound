import type { Sender } from "./types";
import { mockSender } from "./mock";
import { smtpSender } from "./smtp";

/**
 * Sender adapters. Attio has no outbound sending API, so delivery goes
 * through the user's own mailboxes (smtp) or the simulator (mock). Add
 * Smartlead / Instantly adapters here implementing the same interface.
 */
const platformSender: Sender = {
  name: "platform",
  usesMailboxes: false,
  async send() {
    throw new Error("The platform sender enrolls whole batches through the platform bridge, not one email at a time");
  },
};

const registry: Record<string, Sender> = {
  mock: mockSender,
  smtp: smtpSender,
  platform: platformSender,
};

export function getSender(name: string): Sender {
  const s = registry[name];
  if (!s) throw new Error(`Unknown sender provider "${name}". Available: ${Object.keys(registry).join(", ")}`);
  return s;
}

export const availableSenders = () => Object.keys(registry);
export const allSenders = () => Object.values(registry);

export type { Sender, OutboundEmail, ProviderEvent, SendResult, Mailbox } from "./types";
