/**
 * Outbound email seam (§3.4). Better Auth's email-verification and
 * password-reset callbacks send through this port, so tests inject a capturing
 * fake and production ships a clearly-labeled non-delivering default until a
 * real provider is integrated (messaging is an excluded milestone).
 */
export type OutboundEmail = {
  to: string;
  subject: string;
  /** Plain-text body. Links/tokens travel here, never through logs. */
  text: string;
  url?: string;
};

export interface EmailSender {
  send(email: OutboundEmail): Promise<void>;
}

/**
 * Non-delivering default sender. It intentionally does nothing and — critically
 * — does not log the message, so verification tokens and reset links never
 * reach the logs (§3.4 AC3).
 */
export const noopEmailSender: EmailSender = {
  async send() {
    // Intentionally silent: production must not log message contents.
  },
};
