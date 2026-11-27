// scripts/e2e/guided/journeys.ts
//
// The narration for the guided demo videos (`scripts/e2e/guided-videos.ts`): for each
// journey, who is in it, the chapters, and a two-line caption per step written for
// someone who has never seen NoDitto. Steps are matched by their index in the run
// manifest (the e2e Pathway's own step numbers), so a Pathway that gains or loses a step
// needs its entry here updated; the script warns about any step with no caption.

export interface CastMember {
  /** The Pathway's member label (`seller`, `buyer`, `proposer` ...). */
  label: string;
  name: string;
  role: string;
  /** Frame and name-tag colour, as ffmpeg reads it (0xRRGGBB). */
  colour: string;
}

export interface Caption {
  /** What happens, in plain words. */
  what: string;
  /** Why it matters, or what to notice. */
  why: string;
}

export interface Journey {
  id: string;
  title: string;
  /** Two or three short lines for the opening card. */
  intro: string[];
  cast: CastMember[];
  /** Chapter titles keyed by the step index each chapter starts at. */
  chapters: Record<number, string>;
  captions: Record<number, Caption>;
}

const ALICE: CastMember = { label: 'seller', name: 'Alice', role: 'seller', colour: '0xf59e0b' };
const BOB: CastMember = { label: 'buyer', name: 'Bob', role: 'buyer', colour: '0x38bdf8' };

export const JOURNEYS: Journey[] = [
  {
    id: 'journeys.cash-sale-lifecycle',
    title: 'Selling a card, start to finish',
    intro: [
      'NoDitto is a marketplace for trading cards.',
      "When you buy, NoDitto holds your money until you've checked the card.",
      'Alice sells a card to Bob. Watch where the money goes.',
    ],
    cast: [ALICE, BOB],
    chapters: {
      1: 'Listing the card',
      2: 'Bob buys it',
      5: 'Paying safely',
      9: 'Posting the card',
      11: 'Checking the card',
      15: 'Alice gets paid',
    },
    captions: {
      1: { what: 'Alice lists her card for A$150.', why: 'She adds photos, a price and where she is.' },
      2: { what: 'Bob finds it and presses Buy now.', why: 'The card is reserved for him. Nobody else can buy it.' },
      3: { what: 'Alice opens the sale.', why: 'Each sale has its own room, with a chat for the two of them.' },
      4: { what: 'Check: the card shows as reserved.', why: 'No money has moved yet.' },
      5: { what: 'Bob chooses delivery and adds his address.', why: 'They could also meet in person.' },
      6: { what: 'Bob sees the total before he pays.', why: 'Price, postage and the buyer protection fee, all shown up front.' },
      7: { what: 'Bob pays by card.', why: 'His bank may ask him to confirm it (3-D Secure).' },
      8: { what: 'NoDitto now holds the money.', why: "Alice sees it straight away, but she can't touch it yet." },
      9: { what: 'Alice posts the card and adds the tracking number.', why: 'Now both of them can follow the parcel.' },
      10: { what: 'Bob sees the parcel on its way.', why: 'The sale moves on by itself as the parcel travels.' },
      11: { what: 'The carrier reports the parcel delivered.', why: 'In the test, the carrier update is sent for real; we skip the days of waiting.' },
      12: { what: 'Bob has 7 days to check the card.', why: 'If something is wrong he can raise a problem, and the money stays held.' },
      13: { what: 'Bob is happy and completes the purchase.', why: 'That tells NoDitto to release the money to Alice.' },
      14: { what: 'Alice sees the sale is complete.', why: 'She can leave Bob a review.' },
      15: { what: 'The safety hold for new sellers passes.', why: 'New sellers are paid 7 days after the sale. The test skips ahead.' },
      16: { what: 'The hourly payout job runs.', why: 'It sends money that is due to sellers. The test runs it on demand.' },
      17: { what: 'Alice is paid.', why: 'The money goes from NoDitto to her bank account.' },
      18: { what: 'Bob sees his finished purchase.', why: 'Done: Bob has the card, Alice has the money.' },
    },
  },
  {
    id: 'journeys.trade-lifecycle',
    title: 'Swapping cards with a stranger',
    intro: [
      'On NoDitto two people can swap cards instead of paying.',
      'Each of them puts a temporary hold on their card, like a hotel deposit.',
      'If either one cheats, that hold pays the other. Carol and Dave swap.',
    ],
    cast: [
      { label: 'proposer', name: 'Carol', role: 'offers the swap', colour: '0xa78bfa' },
      { label: 'counterpart', name: 'Dave', role: 'owns the listing', colour: '0x34d399' },
    ],
    chapters: {
      1: 'Two cards',
      3: 'Proposing the swap',
      5: 'Agreeing',
      10: 'The safety holds',
      13: 'Meeting up',
      15: 'Checking and finishing',
    },
    captions: {
      1: { what: 'Dave lists a card worth A$120.', why: 'Any listing can be traded for, as well as bought.' },
      2: { what: 'Carol lists a card of the same value.', why: "It's the card she'll offer in exchange." },
      3: { what: "Carol proposes a swap from Dave's listing.", why: 'Her card for his.' },
      4: { what: 'Carol picks where and when they meet.', why: 'Swaps happen face to face.' },
      5: { what: 'Dave opens the offer.', why: 'He can accept, change it, or say no.' },
      6: { what: 'Check: both see the same terms.', why: 'Any change to the terms means both must accept again.' },
      7: { what: 'Dave reads what accepting costs.', why: 'A small fee, and a temporary hold on his card for the value of what he gets.' },
      8: { what: 'Dave accepts.', why: 'Now the terms are agreed by both.' },
      9: { what: 'Check: the terms are agreed.', why: 'The holds go on a day before the meeting.' },
      10: { what: 'The holds are placed on both cards.', why: 'A scheduled job does this. The test runs it on demand.' },
      11: { what: 'Dave sees the swap is locked in.', why: 'Both holds are live. Neither card has been charged.' },
      12: { what: 'Check: each card has a hold in Stripe.', why: 'Stripe is the payment company NoDitto uses.' },
      13: { what: 'They meet, and Carol confirms the swap happened.', why: 'Confirming is not the same as being happy with the card.' },
      14: { what: 'Dave confirms too.', why: 'Now each of them has a few days to check what they got.' },
      15: { what: 'The 72-hour checking window opens.', why: 'If a card is fake or damaged, they can raise a problem.' },
      16: { what: 'Carol is happy with her card.', why: 'She accepts it.' },
      17: { what: 'Dave is happy with his.', why: 'He accepts it too.' },
      18: { what: 'The swap is complete.', why: 'Nothing more to do.' },
      19: { what: 'Both holds are released.', why: 'Neither card was ever charged.' },
    },
  },
  {
    id: 'cash-sale.payments.bank-transfer',
    title: 'Paying by bank transfer (US)',
    intro: [
      'Buyers in the US can pay by bank transfer instead of by card.',
      'It costs them less, and the money still waits with NoDitto until they accept the card.',
      'Sam buys a card from Uma and pays from his bank.',
    ],
    cast: [{ label: 'buyer', name: 'Sam', role: 'buyer, in the US', colour: '0x38bdf8' }],
    chapters: { 1: 'Reserving the card', 4: 'Choosing bank transfer', 7: 'The money arrives' },
    captions: {
      1: { what: "Uma's card is listed at US$150.", why: 'The test sets the listing up directly.' },
      2: { what: 'Sam reserves it with Buy now.', why: 'The card is held for him.' },
      3: { what: 'Sam adds his delivery address.', why: 'So Uma knows where to post it.' },
      4: { what: 'Sam sees card and bank transfer, each with its total.', why: 'Bank transfer has a lower fee.' },
      5: { what: 'NoDitto shows where to send the money.', why: 'An account number and a reference that matches this sale.' },
      6: { what: 'Check: the sale waits for the money.', why: 'The card stays reserved for up to 3 days.' },
      7: { what: "Sam's transfer arrives.", why: "In the test, Stripe's test tool sends it; a real one takes about a day." },
      8: { what: 'Sam opens the sale again.', why: 'It has updated by itself.' },
      9: { what: 'NoDitto now holds the money.', why: 'The sale carries on exactly like a card payment.' },
      10: { what: 'Check: the right amount was paid by bank transfer.', why: 'US$153, against US$156.75 by card.' },
    },
  },
  {
    id: 'cash-sale-disputes.return-and-refund',
    title: 'When the card arrives wrong',
    intro: [
      "If a card isn't what was promised, the buyer can raise a problem.",
      'NoDitto support decides. Here the buyer is refunded once the card is sent back.',
      "The refund only goes out after the seller has the card back, so nobody loses out.",
    ],
    cast: [
      { label: 'buyer', name: 'The buyer', role: '', colour: '0x38bdf8' },
      { label: 'seller', name: 'The seller', role: '', colour: '0xf59e0b' },
      { label: 'staff', name: 'NoDitto support', role: '', colour: '0xf472b6' },
    ],
    chapters: { 2: 'A normal sale', 7: 'Something is wrong', 9: 'Sending it back', 12: 'The refund' },
    captions: {
      1: { what: 'A card is listed.', why: 'The test sets it up directly.' },
      2: { what: 'The buyer reserves the card.', why: 'Just like a normal purchase.' },
      3: { what: 'The buyer chooses delivery.', why: '' },
      4: { what: 'The buyer pays by card.', why: 'NoDitto holds the money.' },
      5: { what: 'The seller posts the card with tracking.', why: '' },
      6: { what: 'The parcel is delivered.', why: 'The carrier update is sent for real; the days of waiting are skipped.' },
      7: { what: "The buyer says the card isn't as described.", why: 'The money stays held while support looks at it.' },
      8: { what: 'Support decides: refund, once the card comes back.', why: 'The buyer has 7 days to post it back.' },
      9: { what: 'Check: the sale now waits for the return.', why: 'The card stays reserved, not back on sale.' },
      10: { what: 'The seller gives an address for the return.', why: '' },
      11: { what: 'The buyer posts the card back with tracking.', why: '' },
      12: { what: 'The return is delivered to the seller.', why: 'The seller then has 3 days to check it.' },
      13: { what: "The seller's 3 days pass.", why: 'The test skips ahead.' },
      14: { what: 'The refund goes out.', why: 'A scheduled job does this. The test runs it on demand.' },
      15: { what: 'The buyer is refunded.', why: 'The seller has their card back. Nobody is out of pocket.' },
    },
  },
  {
    id: 'trade-disputes.staff-unfounded',
    title: 'A swap dispute that turns out fine',
    intro: [
      'After a swap, either trader can say the card they got is wrong.',
      "NoDitto support looks at it. Here, support finds there's no problem.",
      'Both holds are released and nobody is charged.',
    ],
    cast: [
      { label: 'initiator', name: 'Trader A', role: '', colour: '0xa78bfa' },
      { label: 'counterpart', name: 'Trader B', role: '', colour: '0x34d399' },
      { label: 'staff', name: 'NoDitto support', role: '', colour: '0xf472b6' },
    ],
    chapters: { 3: 'Setting up the swap', 6: 'The meeting', 7: 'The dispute', 8: 'The decision' },
    captions: {
      1: { what: "Trader B's card is listed.", why: 'The test sets it up directly.' },
      2: { what: "Trader A's card is listed.", why: '' },
      3: { what: 'Trader A proposes a swap.', why: '' },
      4: { what: 'They set the meeting and both accept.', why: 'Each card gets a temporary hold.' },
      5: { what: 'The holds go on before the meeting.', why: 'The test moves the clock forward and runs the scheduled job.' },
      6: { what: 'They meet and both confirm the swap.', why: 'Now each has a few days to check their card.' },
      7: { what: "Trader A says the card isn't in the condition promised.", why: 'Both holds stay in place while support decides.' },
      8: { what: 'Support decides the complaint is unfounded.', why: 'The card was as described.' },
      9: { what: 'The swap completes and both holds are released.', why: 'Nobody is charged.' },
    },
  },
  {
    id: 'private-deals.create-and-claim-cash-sale',
    title: 'A private deal over a link',
    intro: [
      'Already agreed a sale on Instagram or at a card show?',
      'A private deal turns it into a NoDitto sale, with the money held until the buyer accepts.',
      'Alice makes a link for her card and sends it to Bob.',
    ],
    cast: [
      { label: 'host', name: 'Alice', role: 'makes the deal', colour: '0xf59e0b' },
      { label: 'joiner', name: 'Bob', role: 'opens the link', colour: '0x38bdf8' },
    ],
    chapters: { 1: 'Making the link', 2: 'Opening it' },
    captions: {
      1: {
        what: 'Alice adds her card and a price, and gets a link.',
        why: "The card stays out of the catalog. Only people with the link can see it.",
      },
      2: {
        what: 'Bob opens the link and joins the deal.',
        why: 'It becomes a normal sale room, with payment held by NoDitto.',
      },
      3: { what: 'Check: the link is used up.', why: 'Only the first person to join gets the deal.' },
    },
  },
  {
    id: 'private-deals.self-join-and-expired-refused',
    title: 'Private deal links: the safety rules',
    intro: [
      "A deal link can't be used by the person who made it,",
      'and it stops working after 14 days.',
    ],
    cast: [
      { label: 'host', name: 'Alice', role: 'makes the deal', colour: '0xf59e0b' },
      { label: 'joiner', name: 'Bob', role: 'opens the link late', colour: '0x38bdf8' },
    ],
    chapters: { 1: 'Making the link', 2: 'Opening your own link', 3: '14 days later' },
    captions: {
      1: { what: 'Alice makes a deal link.', why: '' },
      2: { what: 'Alice opens her own link.', why: "She's taken back to her deal to edit it. She can't buy her own card." },
      3: { what: 'Two weeks pass.', why: 'The test moves the clock forward.' },
      4: { what: 'Bob opens the link too late.', why: 'It has expired, so nothing can be bought from it.' },
    },
  },
];
