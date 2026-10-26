import type { EmailSender, OutboundEmail } from "../../ports/email";

/**
 * Test-only capturing email sender (§3.4). Records every message in memory so
 * integration tests can assert on subject/recipient and extract verification or
 * reset links — without any message content ever reaching the logs.
 */
export class CapturingEmailSender implements EmailSender {
  public readonly sent: OutboundEmail[] = [];

  async send(email: OutboundEmail): Promise<void> {
    this.sent.push(email);
  }

  /** The most recent message whose subject contains `fragment`. */
  lastWithSubject(fragment: string): OutboundEmail | undefined {
    return [...this.sent]
      .reverse()
      .find((email) => email.subject.includes(fragment));
  }

  clear(): void {
    this.sent.length = 0;
  }
}
