"""Export all games in your PlayStation library to a CSV file.

Usage:
    python export_ps_catalog.py [output.csv]

Auth: the script needs your PlayStation session cookie. See COOKIE_HELP
below for how to obtain/refresh it.
"""

import csv
import json
import os
import sys
import urllib.parse
import urllib.request

# Read from the environment — never hardcode a session cookie in source.
# (The value is a short-lived, self-expiring PS session cookie that PS
# rotates regularly, not a durable secret — but it still shouldn't be a
# literal in version control going forward.)
SESSION_COOKIE = os.environ.get("PSN_SESSION_COOKIE", "")

COOKIE_HELP = """\
WARNING: PlayStation rejected the request (HTTP {code}) — your session cookie
has most likely expired. To refresh it:
  1. Log in at https://library.playstation.com
  2. Open DevTools (F12) > Application > Cookies > https://library.playstation.com
  3. Copy the value of the `pdccws_p` cookie
  4. Set it as the PSN_SESSION_COOKIE environment variable, e.g.:
       export PSN_SESSION_COOKIE="<value>"   # macOS/Linux
       $env:PSN_SESSION_COOKIE = "<value>"   # PowerShell\
"""

MISSING_COOKIE_HELP = """\
ERROR: PSN_SESSION_COOKIE is not set. To obtain it:
  1. Log in at https://library.playstation.com
  2. Open DevTools (F12) > Application > Cookies > https://library.playstation.com
  3. Copy the value of the `pdccws_p` cookie
  4. Set it as the PSN_SESSION_COOKIE environment variable, e.g.:
       export PSN_SESSION_COOKIE="<value>"   # macOS/Linux
       $env:PSN_SESSION_COOKIE = "<value>"   # PowerShell\
"""

API_URL = "https://web.np.playstation.com/api/graphql/v1/op"
OPERATION = "getPurchasedGameList"
PERSISTED_QUERY_HASH = "827a423f6a8ddca4107ac01395af2ec0eafd8396fc7fa204aaf9b7ed2eefa168"
PAGE_SIZE = 100

CSV_COLUMNS = [
    "name",
    "platform",
    "membership",
    "title_id",
    "product_id",
    "concept_id",
    "entitlement_id",
    "is_preorder",
    "is_downloadable",
    "image_url",
    "store_url",
]

HEADERS = {
    "accept": "application/json",
    "content-type": "application/json",
    "apollographql-client-name": "my-playstation",
    "origin": "https://library.playstation.com",
    "referer": "https://library.playstation.com/",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
    ),
    "cookie": f"pdccws_p={SESSION_COOKIE}; isSignedIn=true",
}


def fetch_page(start: int, size: int) -> dict:
    variables = {
        "isActive": True,
        "platform": ["ps4", "ps5"],
        "size": size,
        "start": start,
        "sortBy": "ACTIVE_DATE",
        "sortDirection": "desc",
    }
    extensions = {
        "persistedQuery": {"version": 1, "sha256Hash": PERSISTED_QUERY_HASH}
    }
    query = urllib.parse.urlencode({
        "operationName": OPERATION,
        "variables": json.dumps(variables, separators=(",", ":")),
        "extensions": json.dumps(extensions, separators=(",", ":")),
    })
    req = urllib.request.Request(f"{API_URL}?{query}", headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise SystemExit(COOKIE_HELP.format(code=e.code))
        body = e.read().decode("utf-8", errors="replace")[:500]
        raise SystemExit(f"Request failed with HTTP {e.code}:\n{body}")

    if "errors" in payload:
        raise SystemExit(f"GraphQL error: {payload['errors']}")
    return payload["data"]["purchasedTitlesRetrieve"]


def fetch_all_games() -> list[dict]:
    games = []
    start = 0
    while True:
        page = fetch_page(start, PAGE_SIZE)
        games.extend(page["games"])
        info = page["pageInfo"]
        print(f"Fetched {len(games)}/{info['totalCount']} games...")
        if info["isLast"] or not page["games"]:
            break
        start += len(page["games"])
    return games


def store_url(game: dict) -> str | None:
    """Store page for the title; the locale-less URL redirects to the
    account's region."""
    if game.get("conceptId"):
        return f"https://store.playstation.com/concept/{game['conceptId']}"
    if game.get("productId"):
        return f"https://store.playstation.com/product/{game['productId']}"
    return None


def to_csv_row(game: dict) -> dict:
    image = game.get("image") or {}
    return {
        "name": game.get("name"),
        "platform": game.get("platform"),
        "membership": game.get("membership"),
        "title_id": game.get("titleId"),
        "product_id": game.get("productId"),
        "concept_id": game.get("conceptId"),
        "entitlement_id": game.get("entitlementId"),
        "is_preorder": game.get("isPreOrder"),
        "is_downloadable": game.get("isDownloadable"),
        "image_url": image.get("url"),
        "store_url": store_url(game),
    }


def main() -> None:
    if not SESSION_COOKIE:
        raise SystemExit(MISSING_COOKIE_HELP)

    output_path = sys.argv[1] if len(sys.argv) > 1 else "ps_catalog.csv"

    # No dedupe here: PS4/PS5 collapsing belongs to the importer (PRD FR-27),
    # which needs both rows' IDs as aliases for future sync matching.
    games = fetch_all_games()

    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for game in games:
            writer.writerow(to_csv_row(game))

    print(f"Saved {len(games)} games to {output_path}")


if __name__ == "__main__":
    main()
