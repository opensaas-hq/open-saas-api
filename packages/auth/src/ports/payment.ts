/**
 * Payment verification seam for the `paid_required` registration mode (§3.2).
 *
 * Provider integration is deliberately out of scope, so production ships with
 * the deny-by-default implementation below. A future Stripe/checkout adapter
 * implements this same interface and is injected where it is needed.
 */
export type PaymentVerificationContext = {
  email: string;
  /** Any provider reference the client passed; never trusted on its own. */
  reference?: string;
};

export type PaymentVerificationResult = {
  verified: boolean;
  reference?: string;
};

export interface PaymentVerificationPort {
  verify(
    context: PaymentVerificationContext,
  ): Promise<PaymentVerificationResult>;
}

/**
 * Deny-by-default payment port: it never verifies. `paid_required`
 * registration therefore always refuses until a real provider is wired in,
 * which is strictly safer than trusting a client-sent `hasPaid` flag (§3.2).
 */
export const denyAllPayments: PaymentVerificationPort = {
  async verify() {
    return { verified: false };
  },
};
