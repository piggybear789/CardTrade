import 'server-only';

// lib/email/ses.ts
//
// AWS SES v2 client factory. Best-effort like createNotification: a failed
// email must never break the caller's happy path. The client is lazily created
// on first use so the module can be imported without credentials being present
// (local dev without email).
//
// Requires the AWS SDK v3 SES client package (@aws-sdk/client-sesv2). IAM
// credentials are resolved through the standard SDK chain:
//   - Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
//   - Shared credentials file (~/.aws/credentials)
//   - ECS/EC2 instance role (when deployed to AWS)
//   - Vercel: set the three env vars in project settings
//
// The region defaults to AWS_SES_REGION → AWS_REGION → ap-southeast-2 (Sydney,
// closest to the AU user base).

import { SESv2Client } from '@aws-sdk/client-sesv2';

let _client: SESv2Client | null = null;

function getClient(): SESv2Client | null {
  if (_client) return _client;

  // The SDK resolves credentials from the environment chain. If nothing is
  // configured, let it fail at send time (best-effort) rather than throwing on
  // import.
  const region =
    process.env.AWS_SES_REGION ?? process.env.AWS_REGION ?? 'ap-southeast-2';

  _client = new SESv2Client({ region });
  return _client;
}

export { getClient as getSESClient };
