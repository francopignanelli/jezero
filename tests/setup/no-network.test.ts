import https from 'node:https';
import { describe, expect, it } from 'vitest';

// Runs inside the domain project (see packages/domain/vitest.config.ts include list).
describe('test network guard', () => {
  it('blocks fetch to the Gemini API', async () => {
    await expect(
      fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent', {
        method: 'POST',
      }),
    ).rejects.toThrow(/Network access is blocked/);
  });

  it('blocks node https requests (used by the AWS SDK)', () => {
    expect(() => https.request({ hostname: 'dynamodb.us-east-1.amazonaws.com' })).toThrow(
      /Network access is blocked/,
    );
  });

  it('blocks URL-string https requests', () => {
    expect(() => https.get('https://example.com/')).toThrow(/Network access is blocked/);
  });
});
