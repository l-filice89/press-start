#!/usr/bin/env bash
# Drive one epic through bmad-loop, then open a PR from the current feature
# branch into main for human review. Matches the intended workflow:
#   loop runs the epic's stories -> each squash-merges into the feature branch
#   -> push the branch -> open PR -> stop. You review, merge, start the next epic.
#
# Usage (from WSL, at the repo root, on THIS epic's feature branch):
#   scripts/loop-epic.sh 1
#
# Prerequisites:
#   - Run inside WSL2 (tmux available); bun + claude CLI reachable on PATH.
#   - A GitHub remote named `origin` exists and `gh auth status` is logged in.
set -euo pipefail

epic="${1:?usage: loop-epic.sh <epic-number>}"
branch="$(git rev-parse --abbrev-ref HEAD)"

if [[ "$branch" == "main" ]]; then
  echo "Refusing to run on main — check out this epic's feature branch first." >&2
  exit 1
fi

# 1. Drive the epic's stories. With scm.isolation=worktree each story runs in
#    its own worktree and squash-merges into "$branch" on success. Stops after
#    the epic.
bmad-loop run --project . --epic "$epic"

# 2. Publish the feature branch and open the PR into main for your review.
git push -u origin "$branch"
gh pr create --base main --head "$branch" --fill

echo "Epic $epic complete — PR opened from '$branch' → main. Review, merge, then start the next epic."
