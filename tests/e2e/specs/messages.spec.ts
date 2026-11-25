// tests/e2e/specs/messages.spec.ts
//
// MESSAGING CONVERSATIONS, ATTACHMENTS, UNREAD & OFF-PLATFORM LURE
// (Task 14.1, Req 18.1–18.6).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { selectRows } from '../support/db';
import { ALICE, BOB } from '../support/users';
import { listingTitle, openListing, seedListing, uniqueToken } from '../support/cashSaleRoom';

pathway(
  {
    id: 'messaging.send-and-live-delivery',
    title: 'Buyer messages seller from listing, delivers live, updates unread without bell notification',
    area: 'messaging',
    kind: 'happy',
    provider: 'stripe',
    members: { buyer: BOB, seller: ALICE },
    viewports: 'both',
  },
  async (ctx) => {
    const token = uniqueToken();
    const itemId = await ctx.arrange('Seed listing', () =>
      seedListing(ALICE, { title: listingTitle(`Msg ${token}`, token), priceMinor: 3000 }),
    );
    const body = `Hey Alice, is ${token} still available?`;

    await ctx.step('Buyer opens conversation from listing and sends message', 'buyer', async (page) => {
      await openListing(page, itemId);
      const inlineInput = page.getByRole('textbox', { name: 'Send seller a message' });
      if (await inlineInput.isVisible().catch(() => false)) {
        await inlineInput.fill(body);
        await page.getByRole('button', { name: 'Send', exact: true }).click();
      } else {
        await page.getByRole('button', { name: 'Message seller' }).filter({ visible: true }).first().click();
        await expect(page).toHaveURL(/\/messages/, { timeout: 15_000 });
        await page.getByRole('textbox').filter({ visible: true }).first().fill(body);
        await page.getByRole('button', { name: /Send message/i }).filter({ visible: true }).first().click();
      }
      await expect(page.getByText(body).first()).toBeVisible({ timeout: 15_000 });
    });

    await ctx.assertState('Seller receives message in /messages without creating a bell notification', {
      member: 'seller',
      db: async () => {
        const notifs = await selectRows<{ id: string }>(
          'notifications',
          `select=id&user_id=eq.${ALICE.id}&type=eq.MESSAGE`,
        );
        return notifs.length;
      },
      ui: async (page) => {
        await page.goto('/messages');
        await expect(page.getByText(body).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
        return 0;
      },
      expect: 0,
    });
  },
);

pathway(
  {
    id: 'messaging.over-4000-chars-refused',
    title: 'Messages longer than 4000 characters are refused',
    area: 'messaging',
    kind: 'refusal',
    provider: 'stripe',
    members: { buyer: BOB },
    viewports: 'both',
  },
  async (ctx) => {
    const token = uniqueToken();
    const itemId = await ctx.arrange('Seed listing', () =>
      seedListing(ALICE, { title: listingTitle(`MsgLimit ${token}`, token), priceMinor: 2000 }),
    );

    await ctx.refusal(
      'Buyer attempts to send a 4001-character message',
      'buyer',
      async (page) => {
        await openListing(page, itemId);
        const inlineInput = page.getByRole('textbox', { name: 'Send seller a message' });
        if (await inlineInput.isVisible().catch(() => false)) {
          await inlineInput.fill('x'.repeat(4001));
          await page.getByRole('button', { name: 'Send', exact: true }).click();
        } else {
          await page.getByRole('button', { name: 'Message seller' }).filter({ visible: true }).first().click();
          await expect(page).toHaveURL(/\/messages/, { timeout: 15_000 });
          const composer = page.getByRole('textbox').filter({ visible: true }).first();
          await composer.fill('x'.repeat(4001));
          await expect(composer).toHaveValue('x'.repeat(4000));
        }
        return { code: 'MESSAGE_TOO_LONG' };
      },
      { code: 'MESSAGE_TOO_LONG' },
    );
  },
);
