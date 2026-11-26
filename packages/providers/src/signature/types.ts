/**
 * E-signature (BUILD_PLAN 8.8). DocuSign, Dropbox Sign or similar will implement this; until one
 * is chosen (Mukul: "build with mock, decide later") MockSignatureProvider is used and signing
 * happens on ProtestOS's own /sign page.
 */
export interface SignatureProvider {
  readonly name: string;
  /**
   * True when the provider emails the signer itself (DocuSign does). When false, ProtestOS
   * sends the signing link with its own "Documents to sign" email.
   */
  readonly sendsOwnEmail: boolean;
  createEnvelope(input: {
    /** Our reference, shown in the provider's console. */
    reference: string;
    signer: { name: string; email: string };
    documents: { title: string; pdf: Uint8Array }[];
  }): Promise<{ providerRef: string }>;
  voidEnvelope(providerRef: string, reason: string): Promise<void>;
  /** Signed copies, in the order the documents were sent (after a "completed" webhook). */
  getSignedDocuments(providerRef: string): Promise<Uint8Array[]>;
}
