// SCRATCH: delete before finishing.
import { lookupEbaySeller } from '../lib/enrichment/ebay';

async function main() {
  for (const user of process.argv.slice(2)) {
    const t = Date.now();
    const s = await lookupEbaySeller(user);
    console.log(
      user,
      Date.now() - t,
      'ms',
      JSON.stringify({
        found: s.found,
        score: s.feedbackScore,
        pct: s.feedbackPercentage,
        pos: s.positive12m,
        neu: s.neutral12m,
        neg: s.negative12m,
        total: s.totalFeedback,
        since: s.memberSince,
        avatar: Boolean(s.avatarUrl),
        sales: s.recentSales?.length,
        entries: s.feedbackEntries?.length,
        ratings: s.feedbackEntries?.reduce<Record<string, number>>((acc, e) => {
          acc[e.rating] = (acc[e.rating] ?? 0) + 1;
          return acc;
        }, {}),
        note: s.note,
      }),
    );
  }
}

void main();
