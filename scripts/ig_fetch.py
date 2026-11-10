#!/usr/bin/env python3
# scripts/ig_fetch.py
#
# Downloads what the reference crawler needs from Instagram with Instaloader, using a
# personal account's browser session, into .ig-cache/<handle>.json. The crawler then
# judges those files with no SocialCrawl credits:
#
#   py -3 scripts/ig_fetch.py --recheck 20
#   npx tsx --env-file=.env.local scripts/import-instagram-references.ts --local .ig-cache
#
# Per account: its newest posts (pinned ones come first) and the top-level comments on
# the posts worth reading (a feedback or warning caption, or one of its busiest posts,
# which the crawler's AI check may recognise as a feedback thread).
#
# DELIBERATELY SLOW AND HONEST. One session, one account at a time, Instaloader's own
# rate control plus a pause between accounts, and no proxies, no extra accounts and no
# disguise. It stops at the first sign Instagram objects (login wall, 401/429, checkpoint)
# rather than pushing through, and refuses to run as no.ditto, whose restriction would
# take the DM claim bot with it.
#
# Session: IG_SESSIONID, IG_CSRFTOKEN, IG_DS_USER_ID in .env.local. Logging out of
# Instagram in the browser ends it; paste fresh values then.

import argparse
import json
import random
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import timezone
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

# Kept in step with REFERENCE_CAPTION / WARNING_CAPTION in import-instagram-references.ts.
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
CANDIDATE_COMMENTS = 15  # REFERENCE_CANDIDATE_COMMENTS in the crawler


class Blocked(Exception):
    """Instagram objected. Stop the run; do not retry around it."""


def read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in (ROOT / '.env.local').read_text(encoding='utf-8').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip()
    return values


def queued_rechecks(env: dict[str, str], limit: int) -> list[str]:
    """Accounts marked for a second look, oldest first."""
    query = urllib.parse.urlencode(
        {
            'select': 'handle_norm',
            'status': 'eq.QUEUED',
            'skip_reason': 'like.Recheck:*',
            'order': 'created_at.asc',
            'limit': str(limit),
        }
    )
    request = urllib.request.Request(
        f"{env['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/')}/rest/v1/ig_crawl_accounts?{query}",
        headers={
            'apikey': env['SUPABASE_SERVICE_ROLE_KEY'],
            'Authorization': f"Bearer {env['SUPABASE_SERVICE_ROLE_KEY']}",
            'Accept-Profile': 'cardtrade',
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return [row['handle_norm'] for row in json.load(response)]


def iso(dt) -> str | None:
    return dt.replace(tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z') if dt else None


def log(message: str) -> None:
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}", flush=True)


def fetch_account(loader: instaloader.Instaloader, handle: str, max_posts: int, max_comments: int) -> dict:
    out: dict = {'handle': handle, 'fetchedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'posts': [], 'comments': {}}
    try:
        profile = instaloader.Profile.from_username(loader.context, handle)
    except ProfileNotExistsException:
        out['missing'] = True
        return out
    out['avatar'] = profile.profile_pic_url
    if profile.is_private and not profile.followed_by_viewer:
        out['private'] = True
        return out

    posts = []
    for post in profile.get_posts():
        posts.append(post)
        if len(posts) >= max_posts:
            break
    for post in posts:
        out['posts'].append(
            {
                'shortcode': post.shortcode,
                'url': f'https://www.instagram.com/p/{post.shortcode}/',
                'owner': handle,
                'caption': post.caption or '',
                'comments': post.comments,
                'publishedAt': iso(post.date_utc),
                'pinned': bool(getattr(post, 'is_pinned', False)),
            }
        )

    # Which posts get their comments read: the same tests the crawler applies, plus the
    # three busiest for its AI feedback-thread check.
    worth = [p for p in posts if p.comments > 0 and (REFERENCE_CAPTION.search(p.caption or '') or WARNING_CAPTION.search(p.caption or ''))]
    if not any(REFERENCE_CAPTION.search(p.caption or '') for p in worth):
        busiest = sorted((p for p in posts if p.comments >= CANDIDATE_COMMENTS and p not in worth), key=lambda p: -p.comments)
        worth += busiest[:3]
    for post in worth[:5]:
        rows = []
        for comment in post.get_comments():
            text = (comment.text or '').strip()
            if text:
                rows.append(
                    {
                        'id': str(comment.id),
                        'text': text,
                        'author': comment.owner.username.lower(),
                        'avatar': comment.owner.profile_pic_url_no_iphone if hasattr(comment.owner, 'profile_pic_url_no_iphone') else None,
                        'publishedAt': iso(comment.created_at_utc),
                        'url': f'https://www.instagram.com/p/{post.shortcode}/c/{comment.id}/',
                    }
                )
            if len(rows) >= max_comments:
                break
        out['comments'][post.shortcode] = rows
        time.sleep(random.uniform(2, 5))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('handles', nargs='*', help='Instagram usernames to fetch')
    parser.add_argument('--recheck', type=int, default=0, help='also fetch this many accounts queued for recheck')
    parser.add_argument('--out', default=str(ROOT / '.ig-cache'))
    parser.add_argument('--max-posts', type=int, default=24)
    parser.add_argument('--max-comments', type=int, default=150)
    parser.add_argument('--pause', type=float, default=8.0, help='average seconds between accounts')
    args = parser.parse_args()

    env = read_env()
    for key in ('IG_SESSIONID', 'IG_CSRFTOKEN', 'IG_DS_USER_ID'):
        if not env.get(key):
            print(f'{key} is missing from .env.local', file=sys.stderr)
            return 1

    loader = instaloader.Instaloader(quiet=True, download_pictures=False, download_videos=False, save_metadata=False, max_connection_attempts=1)
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
        log(f'Refusing to read as @{username}: use a personal account, not NoDitto\'s.')
        return 2
    loader.context.username = username
    log(f'Logged in as @{username}.')

    handles = [h.lower().lstrip('@') for h in args.handles]
    if args.recheck:
        handles += queued_rechecks(env, args.recheck)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    fetched = 0
    for handle in dict.fromkeys(handles):
        target = out_dir / f'{handle}.json'
        if target.exists() or (out_dir / 'done' / f'{handle}.json').exists():
            continue
        try:
            data = fetch_account(loader, handle, args.max_posts, args.max_comments)
        except (LoginRequiredException, TooManyRequestsException, QueryReturnedForbiddenException) as error:
            log(f'Instagram objected at @{handle} ({type(error).__name__}). Stopping; try again in a few hours.')
            return 3
        except (ConnectionException, QueryReturnedBadRequestException) as error:
            message = str(error)
            if re.search(r'401|429|checkpoint|challenge|login|wait a few minutes', message, re.I):
                log(f'Instagram objected at @{handle}: {message[:160]}. Stopping; try again in a few hours.')
                return 3
            log(f'  @{handle} unreadable: {message[:160]}')
            continue
        target.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        fetched += 1
        threads = sum(1 for rows in data['comments'].values() if rows)
        log(f"  @{handle}: {len(data['posts'])} posts, {threads} threads, {sum(len(r) for r in data['comments'].values())} comments")
        time.sleep(random.uniform(args.pause * 0.6, args.pause * 1.4))
    log(f'Done: {fetched} accounts written to {out_dir}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
