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
# the crawler's AI check may recognise as a feedback thread.
#
# PACE. Every request is counted and spaced by --gap seconds (jittered). Instagram's
# answer decides the rest:
#   * "wait a few minutes" / 429: back off 10, 20, 40 ... minutes and carry on, slowing
#     the gap by half each time; after --max-backoffs in a row, stop.
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
    r"pok[eÃ©]mon|\btcg\b|\bpsa ?(10|9)|\bcgc\b|\bbgs\b|beckett|\bslabs?\b|graded|charizard|pikachu|one piece|"
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
    """Spaces and counts every request Instaloader makes."""

    def __init__(self, gap: float):
        self.gap = gap
        self.requests = 0
        self.last = 0.0

    def wait(self) -> None:
        delay = self.last + random.uniform(self.gap * 0.6, self.gap * 1.4) - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        self.last = time.monotonic()
        self.requests += 1


def install_pacer(loader: instaloader.Instaloader, pacer: Pacer) -> None:
    # Every query (graphql, doc_id, iphone) goes through get_json, so this sees each one once.
    context = loader.context
    original = context.get_json

    def paced(*args, **kwargs):
        pacer.wait()
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('handles', nargs='*', help='Instagram usernames to fetch')
    parser.add_argument('--queue', type=int, default=0, help='fetch this many queued accounts')
    parser.add_argument('--recheck', type=int, default=0, help='fetch this many accounts queued for recheck')
    parser.add_argument('--out', default=str(ROOT / '.ig-cache'))
    parser.add_argument('--max-comments', type=int, default=150)
    parser.add_argument('--gap', type=float, default=2.5, help='average seconds between requests')
    parser.add_argument('--max-backoffs', type=int, default=4, help='slow-downs in a row before stopping')
    args = parser.parse_args()

    env = read_env()
    for key in ('IG_SESSIONID', 'IG_CSRFTOKEN', 'IG_DS_USER_ID'):
        if not env.get(key):
            print(f'{key} is missing from .env.local', file=sys.stderr)
            return 1

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
    username = loader.test_login()
    if not username:
        log('The session is not logged in (expired or logged out). Paste fresh cookies into .env.local.')
        return 2
    if username.lower() in REFUSED_ACCOUNTS:
        log(f"Refusing to read as @{username}: use a personal account, not NoDitto's.")
        return 2
    loader.context.username = username
    pacer = Pacer(args.gap)
    install_pacer(loader, pacer)

    out_dir = Path(args.out)
    (out_dir / 'done').mkdir(parents=True, exist_ok=True)
    have = {p.stem for p in out_dir.glob('*.json')} | {p.stem for p in (out_dir / 'done').glob('*.json')}
    handles = [h.lower().lstrip('@') for h in args.handles]
    if args.recheck:
        handles += queued(env, args.recheck, True, have)
    if args.queue:
        handles += queued(env, args.queue, False, have)
    handles = [h for h in dict.fromkeys(handles) if h not in have]
    log(f'Logged in as @{username}. {len(handles)} accounts to fetch, ~{args.gap}s between requests.')

    started = time.monotonic()
    fetched = 0
    backoffs = 0
    queue = list(handles)
    while queue:
        handle = queue[0]
        before = pacer.requests
        try:
            data = fetch_account(loader, handle, args.max_comments)
        except Exception as raw:  # noqa: BLE001 - every Instagram answer is classified below
            error = classify(raw)
            if isinstance(error, AccountTrouble):
                log(f'Instagram flagged the session at @{handle}: {error}. Stopping. Open Instagram in the browser and clear any prompt first.')
                return 3
            if isinstance(error, SlowDown):
                backoffs += 1
                if backoffs > args.max_backoffs:
                    log(f'Still told to slow down after {args.max_backoffs} back-offs. Stopping; try again tomorrow.')
                    return 3
                minutes = 10 * 2 ** (backoffs - 1)
                pacer.gap *= 1.5
                log(f'Told to slow down at @{handle} after {pacer.requests} requests ({error}). Waiting {minutes} min; gap now {pacer.gap:.1f}s.')
                time.sleep(minutes * 60)
                continue
            if isinstance(error, (ConnectionException, QueryReturnedBadRequestException, QueryReturnedForbiddenException, KeyError)):
                log(f'  @{handle} unreadable: {str(error)[:160]}')
                queue.pop(0)
                continue
            raise
        backoffs = 0
        queue.pop(0)
        (out_dir / f'{handle}.json').write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        fetched += 1
        threads = sum(1 for rows in data['comments'].values() if rows)
        note = ' (private)' if data.get('private') else ' (missing)' if data.get('missing') else ' (not TCG)' if data.get('notTcg') else ''
        rate = pacer.requests / max(1 / 60, (time.monotonic() - started) / 3600)
        log(
            f"  @{handle}: {len(data['posts'])} posts, {threads} threads, {sum(len(r) for r in data['comments'].values())} comments"
            f"{note}; {pacer.requests - before} requests ({rate:.0f}/h)"
        )
    log(f'Done: {fetched} accounts, {pacer.requests} requests in {(time.monotonic() - started) / 60:.0f} min.')
    return 0 if handles else 4  # 4: nothing was queued


if __name__ == '__main__':
    sys.exit(main())
