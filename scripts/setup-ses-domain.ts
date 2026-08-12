// scripts/setup-ses-domain.ts
//
// Sets up AWS SES for professional email sending from noditto.app.
//
// Prerequisites:
//   1. AWS CLI configured with credentials that have SES permissions
//   2. Access to noditto.app DNS (Route 53 or external registrar)
//
// What this script does:
//   1. Creates a domain identity for noditto.app in SES
//   2. Prints the DKIM CNAME records you need to add to DNS
//   3. Creates a MAIL FROM domain (mail.noditto.app) for SPF alignment
//   4. Prints the MX and TXT records for the MAIL FROM subdomain
//
// Run:
//   npx tsx --env-file=.env.local scripts/setup-ses-domain.ts
//
// After adding DNS records, verification takes 1-72 hours (usually minutes).
// Check status with:
//   aws sesv2 get-email-identity --email-identity noditto.app --region ap-southeast-2

import {
  SESv2Client,
  CreateEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
  GetEmailIdentityCommand,
} from '@aws-sdk/client-sesv2';

const DOMAIN = 'noditto.app';
const MAIL_FROM_SUBDOMAIN = `mail.${DOMAIN}`;
const REGION = process.env.AWS_SES_REGION ?? 'ap-southeast-2';

async function main() {
  const client = new SESv2Client({ region: REGION });

  console.log(`\n📧 Setting up SES for ${DOMAIN} in ${REGION}\n`);
  console.log('─'.repeat(60));

  // Step 1: Create domain identity
  try {
    const createResult = await client.send(
      new CreateEmailIdentityCommand({ EmailIdentity: DOMAIN }),
    );
    console.log('\n✅ Domain identity created');
    console.log(`   Type: ${createResult.IdentityType}`);
    console.log(`   Verified: ${createResult.VerifiedForSendingStatus}`);

    // DKIM tokens
    if (createResult.DkimAttributes?.Tokens) {
      console.log('\n📋 Add these CNAME records to your DNS:\n');
      for (const token of createResult.DkimAttributes.Tokens) {
        console.log(`   ${token}._domainkey.${DOMAIN}`);
        console.log(`   → ${token}.dkim.amazonses.com`);
        console.log('');
      }
    }
  } catch (e: unknown) {
    const error = e as { name?: string };
    if (error.name === 'AlreadyExistsException') {
      console.log('\n⚡ Domain identity already exists, fetching current state...');
      const existing = await client.send(
        new GetEmailIdentityCommand({ EmailIdentity: DOMAIN }),
      );
      console.log(`   Verified: ${existing.VerifiedForSendingStatus}`);
      if (existing.DkimAttributes?.Tokens) {
        console.log('\n📋 DKIM CNAME records (if not already added):\n');
        for (const token of existing.DkimAttributes.Tokens) {
          console.log(`   ${token}._domainkey.${DOMAIN}`);
          console.log(`   → ${token}.dkim.amazonses.com`);
          console.log('');
        }
      }
    } else {
      throw e;
    }
  }

  // Step 2: Set MAIL FROM domain
  try {
    await client.send(
      new PutEmailIdentityMailFromAttributesCommand({
        EmailIdentity: DOMAIN,
        MailFromDomain: MAIL_FROM_SUBDOMAIN,
        BehaviorOnMxFailure: 'USE_DEFAULT_VALUE',
      }),
    );
    console.log(`✅ MAIL FROM domain set to ${MAIL_FROM_SUBDOMAIN}`);
  } catch (e) {
    console.error('⚠️  Could not set MAIL FROM domain:', e);
  }

  // Step 3: Print required DNS records
  console.log('\n─'.repeat(60));
  console.log('\n📋 DNS records needed for MAIL FROM (SPF alignment):\n');
  console.log(`   MX record for ${MAIL_FROM_SUBDOMAIN}:`);
  console.log(`     10 feedback-smtp.${REGION}.amazonses.com\n`);
  console.log(`   TXT record for ${MAIL_FROM_SUBDOMAIN}:`);
  console.log(`     "v=spf1 include:amazonses.com ~all"\n`);

  console.log('─'.repeat(60));
  console.log('\n📋 Summary of ALL DNS records needed:\n');
  console.log('   1. Three DKIM CNAME records (printed above)');
  console.log(`   2. MX record on ${MAIL_FROM_SUBDOMAIN}`);
  console.log(`   3. TXT (SPF) record on ${MAIL_FROM_SUBDOMAIN}`);
  console.log(`   4. Optional DMARC TXT on _dmarc.${DOMAIN}:`);
  console.log(`      "v=DMARC1; p=quarantine; rua=mailto:dmarc@${DOMAIN}"\n`);

  console.log('─'.repeat(60));
  console.log('\n🔧 Environment variables for Vercel / .env.local:\n');
  console.log('   AWS_ACCESS_KEY_ID=<your-iam-user-access-key>');
  console.log('   AWS_SECRET_ACCESS_KEY=<your-iam-user-secret-key>');
  console.log(`   AWS_SES_REGION=${REGION}`);
  console.log(`   EMAIL_FROM=NoDitto <notifications@${DOMAIN}>`);
  console.log('');

  console.log('─'.repeat(60));
  console.log('\n📝 IAM policy needed (least-privilege):\n');
  console.log(JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Action: ['ses:SendEmail', 'ses:SendRawEmail'],
      Resource: `arn:aws:ses:${REGION}:*:identity/${DOMAIN}`,
    }],
  }, null, 2));

  console.log('\n\n🚨 IMPORTANT: New SES accounts start in SANDBOX mode.');
  console.log('   In sandbox, you can only send to verified email addresses.');
  console.log('   Request production access via the AWS console:');
  console.log('   https://console.aws.amazon.com/ses/home#/account');
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ Setup failed:', err);
  process.exit(1);
});
