#!/usr/bin/env python3
# scripts/ig_fetch.py
#
# Downloads what the reference crawler needs from Instagram with Instaloader, using a
# personal account's browser session, into .ig-cache/<handle>.json. The crawler then
# judges those files with no SocialCrawl credits:
#
#   py -3 scripts/ig_fetch.py --queue 200          (or --recheck 200, or handles)
#   npx tsx --env-file=.env.local scripts/import-instagram-references.ts --local .ig-cache
#
# Or both, forever, with scripts/ig_loop.ps1.
#
# Per account: its 12 newest posts (12 more when none is a feedback post), and the
# top-level comments on the posts worth reading: a feedback or warning caption, or, on a
# trading-card account with no feedback caption, its two busiest non-giveaway posts, which
# the crawler's AI check may recognise as a feedback thread. On a trading-card account,
# also the newest posts OTHER people tagged it in (its Tagged tab: "happy mail from @x").
#
# PACE. --workers threads share ONE session and one clock: requests start at least --gap
# seconds apart (jittered), and the gap shrinks on its own toward --min-gap while
# Instagram answers normally, so the run finds the session's limit. Instagram's answer
# decides the rest:
#   * "wait a few minutes" / 429: everyone pauses 10, 20, 40 ... minutes and carries on,
#     with the gap half again longer; after --max-backoffs in a row, stop.
#   * checkpoint, challenge, login wall or a logged-out session: stop at once. Those are
#     about the ACCOUNT, and pushing on is how an account gets disabled.
# One session, no proxies, no extra accounts, no disguise. Refuses to run as no.ditto.
#
# Session: IG_SESSIONID, IG_CSRFTOKEN, IG_DS_USER_ID in .env.local.

import argparse
import json
import random
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import instaloader
from instaloader.exceptions import (
    ConnectionException,
    LoginRequiredException,
    ProfileNotExistsException,
    QueryReturnedBadRequestException,
    QueryReturnedForbiddenException,
    TooManyRequestsException,
)

ROOT = Path(__file__).resolve().parent.parent
REFUSED_ACCOUNTS = {'no.ditto'}

# Kept in step with the crawler (import-instagram-references.ts).
REFERENCE_CAPTION = re.compile(
    r"\b(refs?|references?|feedback|vouch(es|ing)?|legit ?check|worked with|dealt with|traded with|"
    r"bought from|leave a comment|drop a comment|comment below)\b",
    re.I,
)
WARNING_CAPTION = re.compile(
    r"\b(scam(med|mer|ming)?|beware|avoid|do ?n[o']t (deal|buy|trade)|warning|psa:|ripped (me )?off|"
    r"never (received|arrived|sent|shipped)|chargeback|stole|fake slab|refund)\b",
    re.I,
)
TCG_TEXT = re.compile(
    r"pok[e\u00e9]mon|\btcg\b|\bpsa ?(10|9)|\bcgc\b|\bbgs\b|beckett|\bslabs?\b|graded|charizard|pikachu|one piece|"
    r"yu-?gi-?oh|\bmtg\b|magic the gathering|lorcana|booster|\betb\b|sealed|binder|\bpulls?\b|sports ?cards?|"
    r"topps|panini|prizm|trading cards?",
    re.I,
)
TCG_HANDLE = re.compile(r'tcg|card|slab|poke|graded|psa|collect|binder|vault|grail', re.I)
GIVEAWAY = re.compile(r'giveaway|give away|tag \d|tag (a|two|three) friends?|to (enter|win)|winner|follow .{0,20}like|\bwin\b', re.I)
CANDIDATE_COMMENTS = 15  # REFERENCE_CANDIDATE_COMMENTS in the crawler

ACCOUNT_TROUBLE = re.compile(r'checkpoint|challenge|login_required|/accounts/login|suspended|disabled', re.I)
SLOW_DOWN = re.compile(r'429|wait a few minutes|too many|rate.?limit|feedback_required', re.I)


class SlowDown(Exception):
    pass


class AccountTrouble(Exception):
    pass


def log(message: str) -> None:
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}", flush=True)


def read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in (ROOT / '.env.local').read_text(encoding='utf-8').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip()
    return values


def queued(env: dict[str, str], limit: int, recheck_only: bool, skip: set[str]) -> list[str]:
    """Queued accounts, nearest ring first, the same order the crawler uses."""
    params = {'select': 'handle_norm', 'status': 'eq.QUEUED', 'order': 'depth.asc,created_at.asc', 'limit': str(limit + len(skip))}
    if recheck_only:
        params['skip_reason'] = 'like.Recheck:*'
    request = urllib.request.Request(
        f"{env['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/')}/rest/v1/ig_crawl_accounts?{urllib.parse.urlencode(params)}",
        headers={
            'apikey': env['SUPABASE_SERVICE_ROLE_KEY'],
            'Authorization': f"Bearer {env['SUPABASE_SERVICE_ROLE_KEY']}",
            'Accept-Profile': 'cardtrade',
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return [row['handle_norm'] for row in json.load(response) if row['handle_norm'] not in skip][:limit]


def iso(dt) -> str | None:
    return dt.replace(tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z') if dt else None


class Pacer:
    """One clock for every request every worker makes, so --workers overlaps waiting on
    Instagram without exceeding the pace. The gap ADAPTS to find the limit: 5% shorter
    after every 100 requests answered normally, down to --min-gap, and half again longer,
    plus a pause for everyone, each time Instagram says slow down."""

    def __init__(self, gap: float, min_gap: float):
        self.gap = gap
        self.min_gap = min_gap
        self.requests = 0
        self.clean = 0
        self.next_at = 0.0
        self.paused_until = 0.0
        self.lock = threading.Lock()

    def wait(self) -> None:
        with self.lock:
            start = max(time.monotonic(), self.next_at, self.paused_until)
            self.next_at = start + random.uniform(self.gap * 0.6, self.gap * 1.4)
            self.requests += 1
            self.clean += 1
            if self.clean >= 100:
                self.clean = 0
                self.gap = max(self.min_gap, self.gap * 0.95)
        delay = start - time.monotonic()
        if delay > 0:
            time.sleep(delay)

    # The app API (the Tagged tab) has its own, tighter limit: it answered 429 after a
    # few hundred calls in 40 minutes on 2026-11-10. Instaloader's own figure for it is
    # 200 per 30 minutes; stay just under.
    APP_WINDOW = 1800.0
    APP_MAX = 190

    def wait_app(self) -> None:
        while True:
            with self.lock:
                now = time.monotonic()
                self.app_calls = [t for t in getattr(self, 'app_calls', []) if t > now - self.APP_WINDOW]
                if len(self.app_calls) < self.APP_MAX:
                    self.app_calls.append(now)
                    return
                delay = self.app_calls[0] + self.APP_WINDOW - now + 1
            time.sleep(delay)

    def slow_down(self, minutes: float) -> None:
        with self.lock:
            self.gap *= 1.5
            self.clean = 0
            self.paused_until = max(self.paused_until, time.monotonic() + minutes * 60)


def install_pacer(loader: instaloader.Instaloader, pacer: Pacer) -> None:
    # Every query (graphql, doc_id, iphone) goes through get_json, so this sees each one once.
    context = loader.context
    original = context.get_json

    context.request_count = 0

    def paced(*args, **kwargs):
        host = args[2] if len(args) > 2 else kwargs.get('host', 'www.instagram.com')
        if host == 'i.instagram.com':
            pacer.wait_app()
        pacer.wait()
        context.request_count += 1  # this worker's own, for the per-account figure
        return original(*args, **kwargs)

    context.get_json = paced


def classify(error: Exception) -> Exception:
    message = str(error)
    if isinstance(error, (LoginRequiredException,)) or ACCOUNT_TROUBLE.search(message):
        return AccountTrouble(message[:200])
    if isinstance(error, (TooManyRequestsException,)) or SLOW_DOWN.search(message):
        return SlowDown(message[:200])
    return error


def comment_count(post) -> int:
    """From the post list itself. `Post.comments` looks under another name and, missing
    it, fetches the whole post: one wasted request per post."""
    node = post._node
    if isinstance(node.get('comments'), int):
        return node['comments']
    return int((node.get('iphone_struct') or {}).get('comment_count') or 0)


def caption_of(post) -> str:
    caption = post._node.get('caption')
    if isinstance(caption, str):
        return caption
    return post.caption or ''


def owner_avatar(comment) -> str | None:
    # The comment's own node, never `owner.profile_pic_url`: that property can fetch the
    # commenter's whole profile, one request per comment.
    node = getattr(comment.owner, '_node', None) or {}
    return node.get('profile_pic_url')


def tagged_posts(loader: instaloader.Instaloader, profile, handle: str) -> list[dict]:
    """Posts by OTHER people that tag `handle` (its Tagged tab): buyers' "happy mail from
    @seller" posts. One request for the newest page. Instaloader's own tagged query is
    refused for logged-in sessions; the app's usertags feed is what the Tagged tab uses."""
    response = loader.context.get_iphone_json(f'api/v1/usertags/{profile.userid}/feed/', {'count': '24'})
    rows = []
    for item in response.get('items') or []:
        user = item.get('user') or {}
        poster = (user.get('username') or '').lower()
        caption = ((item.get('caption') or {}).get('text') or '').strip()
        code = item.get('code')
        if not code or not poster or poster == handle or not caption:
            continue
        taken = item.get('taken_at')
        rows.append(
            {
                'shortcode': code,
                'url': f'https://www.instagram.com/p/{code}/',
                'owner': poster,
                'avatar': user.get('profile_pic_url'),
                'caption': caption,
                'comments': int(item.get('comment_count') or 0),
                'publishedAt': iso(datetime.fromtimestamp(taken, timezone.utc).replace(tzinfo=None)) if taken else None,
            }
        )
    return rows


def fetch_account(loader: instaloader.Instaloader, handle: str, max_comments: int) -> dict:
    out: dict = {'handle': handle, 'fetchedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'posts': [], 'comments': {}}
    try:
        profile = instaloader.Profile.from_username(loader.context, handle)
    except ProfileNotExistsException:
        out['missing'] = True
        return out
    out['avatar'] = profile._node.get('profile_pic_url_hd') or profile._node.get('profile_pic_url')
    if profile._node.get('is_private'):
        out['private'] = True
        return out

    posts = []
    iterator = profile.get_posts()
    for post in iterator:
        posts.append(post)
        if len(posts) >= 12:
            break
    if not any(REFERENCE_CAPTION.search(caption_of(p)) for p in posts) and len(posts) == 12:
        for post in iterator:
            posts.append(post)
            if len(posts) >= 24:
                break
    for post in posts:
        out['posts'].append(
            {
                'shortcode': post.shortcode,
                'url': f'https://www.instagram.com/p/{post.shortcode}/',
                'owner': handle,
                'caption': caption_of(post),
                'comments': comment_count(post),
                'publishedAt': iso(datetime.fromtimestamp(post._node['date'], timezone.utc).replace(tzinfo=None)) if post._node.get('date') else None,
                'pinned': bool((post._node.get('iphone_struct') or {}).get('timeline_pinned_user_ids')),
            }
        )

    tcg = bool(TCG_HANDLE.search(handle)) or sum(1 for p in posts if TCG_TEXT.search(caption_of(p))) >= 2
    if not tcg:
        out['notTcg'] = True
        return out  # the crawler will skip it; reading its comments would be wasted requests

    reference = [p for p in posts if comment_count(p) > 0 and REFERENCE_CAPTION.search(caption_of(p))]
    warning = [p for p in posts if comment_count(p) > 0 and WARNING_CAPTION.search(caption_of(p)) and '@' in caption_of(p)]
    worth = reference + [p for p in warning if p not in reference]
    if not reference:
        busiest = sorted(
            (p for p in posts if comment_count(p) >= CANDIDATE_COMMENTS and p not in worth and not GIVEAWAY.search(caption_of(p))),
            key=lambda p: -comment_count(p),
        )
        worth += busiest[:2]
    try:
        out['tagged'] = tagged_posts(loader, profile, handle)
    except Exception as raw:  # noqa: BLE001
        error = classify(raw)
        if isinstance(error, (SlowDown, AccountTrouble)):
            raise raw
        out['tagged'] = []  # an account whose Tagged tab is hidden still has its own posts

    for post in worth[:4]:
        rows = []
        for comment in post.get_comments():
            text = (comment.text or '').strip()
            if text:
                rows.append(
                    {
                        'id': str(comment.id),
                        'text': text,
                        'author': comment.owner.username.lower(),
                        'avatar': owner_avatar(comment),
                        'publishedAt': iso(comment.created_at_utc),
                        'url': f'https://www.instagram.com/p/{post.shortcode}/c/{comment.id}/',
                    }
                )
            if len(rows) >= max_comments:
                break
        out['comments'][post.shortcode] = rows
    return out


def open_session(env: dict[str, str]) -> instaloader.Instaloader:
    loader = instaloader.Instaloader(
        sleep=False, quiet=True, download_pictures=False, download_videos=False, save_metadata=False, max_connection_attempts=1
    )
    loader.load_session(
        '',
        {
            'sessionid': urllib.parse.unquote(env['IG_SESSIONID']),
            'csrftoken': env['IG_CSRFTOKEN'],
            'ds_user_id': env['IG_DS_USER_ID'],
        },
    )
    return loader


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('handles', nargs='*', help='Instagram usernames to fetch')
    parser.add_argument('--queue', type=int, default=0, help='fetch this many queued accounts')
    parser.add_argument('--recheck', type=int, default=0, help='fetch this many accounts queued for recheck')
    parser.add_argument('--out', default=str(ROOT / '.ig-cache'))
    parser.add_argument('--max-comments', type=int, default=150)
    parser.add_argument('--gap', type=float, default=0.8, help='starting seconds between requests')
    parser.add_argument('--min-gap', type=float, default=0.25, help='the gap never shrinks below this')
    parser.add_argument('--workers', type=int, default=3, help='threads sharing the one session')
    parser.add_argument('--max-backoffs', type=int, default=4, help='slow-downs in a row before stopping')
    args = parser.parse_args()

    env = read_env()
    for key in ('IG_SESSIONID', 'IG_CSRFTOKEN', 'IG_DS_USER_ID'):
        if not env.get(key):
            print(f'{key} is missing from .env.local', file=sys.stderr)
            return 1

    first = open_session(env)
    username = first.test_login()
    if not username:
        log('The session is not logged in (expired or logged out). Paste fresh cookies into .env.local.')
        return 2
    if username.lower() in REFUSED_ACCOUNTS:
        log(f"Refusing to read as @{username}: use a personal account, not NoDitto's.")
        return 2

    out_dir = Path(args.out)
    (out_dir / 'done').mkdir(parents=True, exist_ok=True)
    # Only downloads still waiting to be judged. One in done/ was judged already, so if the
    # queue offers it again it is a deliberate recheck and gets fetched fresh.
    have = {p.stem for p in out_dir.glob('*.json')}
    handles = [h.lower().lstrip('@') for h in args.handles]
    if args.recheck:
        handles += queued(env, args.recheck, True, have)
    if args.queue:
        handles += queued(env, args.queue, False, have)
    handles = [h for h in dict.fromkeys(handles) if h not in have]
    workers = max(1, min(args.workers, len(handles) or 1))
    log(f'Logged in as @{username}. {len(handles)} accounts, {workers} workers, gap {args.gap}s shrinking to {args.min_gap}s.')

    pacer = Pacer(args.gap, args.min_gap)
    pending = list(reversed(handles))
    state = {'fetched': 0, 'backoffs': 0, 'last_slowdown': 0.0, 'stop': 0}
    lock = threading.Lock()
    started = time.monotonic()

    def work(loader: instaloader.Instaloader) -> None:
        loader.context.username = username
        install_pacer(loader, pacer)
        while True:
            with lock:
                if state['stop'] or not pending:
                    return
                handle = pending.pop()
            before = loader.context.request_count
            try:
                data = fetch_account(loader, handle, args.max_comments)
            except Exception as raw:  # noqa: BLE001 - every Instagram answer is classified below
                error = classify(raw)
                if isinstance(error, AccountTrouble):
                    with lock:
                        state['stop'] = 3
                    log(f'Instagram flagged the session at @{handle}: {error}. Stopping. Open Instagram in the browser and clear any prompt first.')
                    return
                if isinstance(error, SlowDown):
                    with lock:
                        pending.append(handle)
                        # Several workers hear the same "slow down" at once: count it once.
                        if time.monotonic() - state['last_slowdown'] > 120:
                            state['last_slowdown'] = time.monotonic()
                            state['backoffs'] += 1
                            if state['backoffs'] > args.max_backoffs:
                                state['stop'] = 3
                                log(f'Still told to slow down after {args.max_backoffs} back-offs. Stopping; try again tomorrow.')
                                return
                            minutes = 10 * 2 ** (state['backoffs'] - 1)
                            pacer.slow_down(minutes)
                            log(f'Told to slow down after {pacer.requests} requests ({error}). Pausing {minutes} min; gap now {pacer.gap:.2f}s.')
                    continue
                if isinstance(error, (ConnectionException, QueryReturnedBadRequestException, QueryReturnedForbiddenException, KeyError)):
                    log(f'  @{handle} unreadable: {str(error)[:160]}')
                    continue
                with lock:
                    state['stop'] = 1
                log(f'  @{handle} crashed the worker: {raw!r}'[:300])
                return
            # Written whole, then renamed: the judge, running alongside, only ever sees complete files.
            partial = out_dir / f'{handle}.json.part'
            partial.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
            partial.replace(out_dir / f'{handle}.json')
            with lock:
                state['backoffs'] = 0
                state['fetched'] += 1
            threads = sum(1 for rows in data['comments'].values() if rows) + (1 if data.get('tagged') else 0)
            note = ' (private)' if data.get('private') else ' (missing)' if data.get('missing') else ' (not TCG)' if data.get('notTcg') else ''
            hours = max(1 / 60, (time.monotonic() - started) / 3600)
            log(
                f"  @{handle}: {len(data['posts'])} posts, {threads} threads, {sum(len(r) for r in data['comments'].values())} comments"
                f"{note}; {loader.context.request_count - before} req; {pacer.requests / hours:.0f} req/h, {state['fetched'] / hours:.0f} accounts/h, gap {pacer.gap:.2f}s"
            )

    loaders = [first] + [open_session(env) for _ in range(workers - 1)]
    threads = [threading.Thread(target=work, args=(loader,), daemon=True) for loader in loaders]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    log(f"Done: {state['fetched']} accounts, {pacer.requests} requests in {(time.monotonic() - started) / 60:.0f} min, final gap {pacer.gap:.2f}s.")
    if state['stop']:
        return state['stop']
    return 0 if handles else 4  # 4: nothing was queued


if __name__ == '__main__':
    sys.exit(main())
