# Guided demo videos

These are short narrated walkthroughs for someone who has never seen NoDitto. They're
cut from the real e2e test recordings (run `2026-11-26T15-24-17Z-4wguabr`, desktop),
not staged.

| Video | What it shows | Length |
|---|---|---|
| [noditto-guided-demo.mp4](noditto-guided-demo.mp4) | All five below, back to back | 6:19 |
| [journeys.cash-sale-lifecycle.mp4](journeys.cash-sale-lifecycle.mp4) | Selling a card, start to finish: list, buy, pay, post, check, payout | 1:27 |
| [journeys.trade-lifecycle.mp4](journeys.trade-lifecycle.mp4) | Swapping cards with a stranger, with temporary card holds | 1:29 |
| [cash-sale.payments.bank-transfer.mp4](cash-sale.payments.bank-transfer.mp4) | A US buyer paying by bank transfer | 0:52 |
| [cash-sale-disputes.return-and-refund.mp4](cash-sale-disputes.return-and-refund.mp4) | The card arrives wrong: dispute, return, refund | 1:30 |
| [trade-disputes.staff-unfounded.mp4](trade-disputes.staff-unfounded.mp4) | A swap dispute that support finds unfounded | 1:01 |

Each video has chapter markers, which most players show on the progress bar. They're
also listed in its `.chapters.txt`, in YouTube format.

## What's on screen

- **An opening card:** what NoDitto is, what this video shows, who's in it, and the
  chapters with start times.
- **A chapter card** at each stage ("2 · Bob buys it").
- **The acting person's screen,** in a frame of their colour, with a matching name tag.
- **Two lines under every step:** what happens, and why it matters.
- **An amber ring** where the screen first changed after a click. The recordings have no
  cursor, so this is worked out from the picture. It's skipped when the whole page
  changed at once.
- **Real-speed playback.** A short step is held long enough to read. A long one shows its
  start and end, with "⏩ N seconds later" between, and is never sped up.
- **Steps with no screen** (a scheduled job, a carrier update, the test skipping ahead in
  time) appear as a "Behind the scenes" card.

## Making them again

You don't need to re-run the tests. To rebuild from the latest run, run:

    npx tsx scripts/e2e/guided-videos.ts [--run <run-id>] [--only <journey-id-part>]

It takes a few minutes. The captions and chapters are in
`scripts/e2e/guided/journeys.ts`. To add a journey, add an entry there whose `id` is a
Pathway id that passed with video (`E2E_VIDEO=1`) in that run. Captions are matched by
step number, and the script prints any step that has no caption.
