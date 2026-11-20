import asyncio
import csv
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Literal, Optional

import httpx

HANDLE_RE = re.compile(r"^[A-Za-z0-9._-]{2,64}$")

MARKETPLACE_SITES = {
    "ebay",
    "etsy",
    "poshmark",
    "depop",
    "mercari",
    "grailed",
    "stockx",
    "gumtree",
    "carousell",
    "discogs",
    "patreon",
    "ko-fi",
    "buymeacoffee",
}

SOCIAL_SITES = {
    "instagram",
    "tiktok",
    "twitter",
    "x",
    "youtube",
    "twitch",
    "facebook",
    "threads",
    "snapchat",
    "pinterest",
    "linktree",
    "carrd",
}

FORUM_SITES = {
    "reddit",
    "github",
    "steam",
    "telegram",
    "discord",
    "medium",
    "substack",
    "bitbucket",
}

# Sites that return HTTP 200 login/bot walls for nonexistent handles in Sherlock,
# causing false positives. Checked through real APIs (eBay/SocialCrawl) instead.
FALSE_POSITIVE_WALL_SITES = {
    "instagram",
    "tiktok",
    "reddit",
    "facebook",
    "twitter",
    "x",
}

# Used for fast, high-signal cross-platform probing (reliable non-login-wall sites).
CURATED_CANDIDATE_SITES = [
    "YouTube",
    "Twitch",
    "Linktree",
    "GitHub",
    "Steam",
    "Patreon",
    "Telegram",
    "Etsy",
    "Pinterest",
    "SoundCloud",
    "Medium",
    "Discogs",
    "BuyMeACoffee",
    "Ko-fi",
    "DeviantArt",
    "Imgur",
]

# SITES SHERLOCK CANNOT TELL APART, CHECKED AGAIN HERE.
#
# Some sites answer HTTP 200 with the same app shell for a handle that exists and one
# that does not, and Sherlock reports every handle as found (Twitch did, for a random
# string). A hit from a site listed here is kept only if the page carries the marker a
# real profile has. Anything else, including a failed or blocked read, drops the hit:
# a match we could not confirm is not shown as one.
#
# Twitch: a real channel's page has an `og:title` of "<name> - Twitch"; a missing one
# has the site's own, plain "Twitch".
PROFILE_MARKERS: Dict[str, re.Pattern] = {
    "twitch": re.compile(r'property="og:title"\s+content="[^"]+ - Twitch"', re.IGNORECASE),
}

VERIFY_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


async def _confirmed(client: httpx.AsyncClient, match: Dict) -> bool:
    marker = PROFILE_MARKERS.get(match["site"].strip().lower())
    if marker is None:
        return True
    try:
        response = await client.get(match["url"])
    except httpx.HTTPError:
        return False
    return response.status_code == 200 and marker.search(response.text) is not None


async def _drop_unconfirmed(matches: List[Dict]) -> List[Dict]:
    if not any(m["site"].strip().lower() in PROFILE_MARKERS for m in matches):
        return matches
    async with httpx.AsyncClient(timeout=6.0, follow_redirects=True, headers=VERIFY_HEADERS) as client:
        kept = await asyncio.gather(*(_confirmed(client, m) for m in matches))
    return [m for m, ok in zip(matches, kept) if ok]


STDOUT_HIT_RE = re.compile(r"^\[\+\]\s+([^:]+):\s+(https?://\S+)\s*$")


def categorize_site(site_name: str) -> Literal["social", "marketplace", "forum", "other"]:
    lower = site_name.strip().lower()
    if lower in MARKETPLACE_SITES:
        return "marketplace"
    if lower in SOCIAL_SITES:
        return "social"
    if lower in FORUM_SITES:
        return "forum"
    return "other"


async def run_sherlock(
    handle: str,
    *,
    curated_only: bool = True,
    confidence: Literal["HIGH", "MEDIUM", "LOW"] = "MEDIUM",
    timeout_sec: int = 22,
) -> List[Dict]:
    """
    Runs `sherlock_project` in a bounded subprocess and parses BOTH incremental stdout
    (`[+] Site: URL`) and CSV output, so partial results survive timeouts and known
    HTTP-200 login-wall false positives are filtered out.
    """
    clean = handle.strip().lstrip("@")
    if not HANDLE_RE.match(clean):
        return []

    with tempfile.TemporaryDirectory(prefix="sherlock_") as tmpdir:
        cmd = [
            sys.executable,
            "-m",
            "sherlock_project",
            clean,
            "--local",
            "--print-found",
            "--csv",
            "--folderoutput",
            tmpdir,
            "--timeout",
            "5",
            "--no-color",
        ]
        if curated_only:
            for site in CURATED_CANDIDATE_SITES:
                cmd.extend(["--site", site])

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        stdout_lines: List[str] = []

        async def _read_stdout() -> None:
            assert proc.stdout is not None
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                stdout_lines.append(line.decode("utf-8", errors="replace").strip())

        try:
            await asyncio.wait_for(asyncio.gather(_read_stdout(), proc.wait()), timeout=timeout_sec)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()

        matches: List[Dict] = []
        seen_urls = set()

        def _add_match(site_name: str, url_user: str, http_status: str = "", response_time_s: str = "") -> None:
            if not site_name or not url_user or url_user in seen_urls:
                return
            if site_name.strip().lower() in FALSE_POSITIVE_WALL_SITES:
                return
            seen_urls.add(url_user)
            category = categorize_site(site_name)
            matches.append(
                {
                    "site": site_name.strip(),
                    "category": category,
                    "url": url_user.strip(),
                    "handle": clean,
                    "confidence": confidence,
                    "http_status": http_status,
                    "response_time_s": response_time_s,
                }
            )

        csv_path = Path(tmpdir) / f"{clean}.csv"
        if csv_path.exists():
            with csv_path.open("r", encoding="utf-8", errors="replace", newline="") as fh:
                reader = csv.DictReader(fh)
                for row in reader:
                    exists = (row.get("exists") or "").strip().lower()
                    if exists not in ("claimed", "true", "yes", "1"):
                        continue
                    _add_match(
                        row.get("name") or "",
                        row.get("url_user") or "",
                        row.get("http_status") or "",
                        row.get("response_time_s") or "",
                    )

        for line in stdout_lines:
            m = STDOUT_HIT_RE.match(line)
            if m:
                _add_match(m.group(1), m.group(2))

        priority = {"marketplace": 0, "social": 1, "forum": 2, "other": 3}
        matches = await _drop_unconfirmed(matches)
        matches.sort(key=lambda item: (priority[item["category"]], item["site"].lower()))
        return matches[:40]
