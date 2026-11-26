import { randomUUID } from 'node:crypto';
import type { SignatureProvider } from './types.js';

/**
 * Stand-in provider: records envelopes and lets ProtestOS's /sign page do the signing. Signed
 * copies are produced by the app (stampSignature), so getSignedDocuments is never needed.
 */
export class MockSignatureProvider implements SignatureProvider {
  readonly name = 'mock';
  readonly sendsOwnEmail = false;
  readonly envelopes = new Map<string, { reference: string; documents: number; voided?: string }>();

  async createEnvelope(input: Parameters<SignatureProvider['createEnvelope']>[0]) {
    const providerRef = `mock-${randomUUID()}`;
    this.envelopes.set(providerRef, {
      reference: input.reference,
      documents: input.documents.length,
    });
    return { providerRef };
  }

  async voidEnvelope(providerRef: string, reason: string) {
    const e = this.envelopes.get(providerRef);
    if (e) e.voided = reason;
  }

  async getSignedDocuments(): Promise<Uint8Array[]> {
    throw new Error(
      'The mock provider signs on the ProtestOS /sign page; there is nothing to download.',
    );
  }
}
