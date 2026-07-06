"""Append newly acquired PlayStation games to an existing catalog CSV.

Usage:
    python update_ps_catalog.py [catalog.csv]

Fetches the full library (same as export_ps_catalog.py), compares it by
game name against the existing CSV, and appends only the games that are
not in it yet. Existing rows are never modified. If the CSV does not
exist, run export_ps_catalog.py first.

Auth: uses the SESSION_COOKIE defined in export_ps_catalog.py.
"""

import csv
import os
import sys

from export_ps_catalog import (
    CSV_COLUMNS,
    MISSING_COOKIE_HELP,
    SESSION_COOKIE,
    dedupe_games,
    fetch_all_games,
    to_csv_row,
)


def main() -> None:
    if not SESSION_COOKIE:
        raise SystemExit(MISSING_COOKIE_HELP)

    csv_path = sys.argv[1] if len(sys.argv) > 1 else "ps_catalog.csv"

    if not os.path.exists(csv_path):
        raise SystemExit(
            f"{csv_path} not found. Run `python export_ps_catalog.py {csv_path}` "
            f"first to create the initial catalog."
        )

    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        known_names = {row["name"] for row in csv.DictReader(f)}

    games = dedupe_games(fetch_all_games())
    new_games = [g for g in games if g["name"] not in known_names]

    if not new_games:
        print(f"No new games - {csv_path} is already up to date.")
        return

    with open(csv_path, "a", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        for game in new_games:
            writer.writerow(to_csv_row(game))

    print(f"Added {len(new_games)} new game(s) to {csv_path}:")
    for game in new_games:
        print(f"  - {game['name']} ({game['platform']})")


if __name__ == "__main__":
    main()
