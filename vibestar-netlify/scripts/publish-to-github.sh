#!/usr/bin/env bash
#
# Publishes this folder to a GitHub repository.
#
#   bash scripts/publish-to-github.sh https://github.com/YOU/vibestar.git
#
# Create the empty repository on github.com first (New repository → name it →
# do NOT tick "Add a README" → Create). Then run this with its URL.
#
# Safe to re-run: after the first push it just pushes again.

set -euo pipefail

REMOTE="${1:-}"
BRANCH="${2:-main}"

if [ -z "$REMOTE" ]; then
  cat <<'USAGE'
Usage: bash scripts/publish-to-github.sh <repo-url> [branch]

  1. Go to https://github.com/new
  2. Name it (e.g. vibestar), choose Private, and leave every
     "Initialize this repository with" box UNTICKED.
  3. Click Create repository, copy the URL it shows you, then:

     bash scripts/publish-to-github.sh https://github.com/YOU/vibestar.git

USAGE
  exit 1
fi

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------- guards
if [ ! -f package.json ] || [ ! -d netlify/functions ]; then
  echo "This does not look like the vibestar-netlify folder. Run it from there." >&2
  exit 1
fi

# ------------------------------------------------------------------ init
if [ ! -d .git ]; then
  echo "==> Creating a git repository here"
  git init -q
  git symbolic-ref HEAD "refs/heads/$BRANCH"
fi

if ! git config user.email >/dev/null 2>&1; then
  echo "==> Set your git identity first:"
  echo "    git config --global user.name  'Your Name'"
  echo "    git config --global user.email 'you@example.com'"
  exit 1
fi

echo "==> Staging"
git add -A

# A service-account key in a repository is a database password in a repository,
# and a pushed secret has to be treated as burnt even if you delete it after.
# .gitignore already covers these; this checks what is actually about to be
# committed, which is the only thing that matters.
LEAKED="$(git diff --cached --name-only | grep -Ei \
  '(^|/)(key|credentials|service-account)[^/]*\.json$|(^|/)\.env$|service-account' || true)"

if [ -n "$LEAKED" ]; then
  echo >&2
  echo "REFUSING TO PUSH — these staged files look like credentials:" >&2
  echo "$LEAKED" | sed 's/^/    /' >&2
  echo >&2
  echo "Add them to .gitignore, then run:  git rm --cached <file>" >&2
  exit 1
fi
echo "    no credentials staged"

if git diff --cached --quiet 2>/dev/null && git rev-parse HEAD >/dev/null 2>&1; then
  echo "    nothing new to commit"
else
  git commit -q -m "VibeStar — Netlify frontend, Google Sheets database"
  echo "    committed"
fi

# ---------------------------------------------------------------- remote
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE"
else
  git remote add origin "$REMOTE"
fi

CURRENT="$(git rev-parse --abbrev-ref HEAD)"

echo "==> Pushing $CURRENT to $REMOTE"
if ! git push -u origin "$CURRENT"; then
  cat <<'FAILED'

Push failed. The usual causes:

  * The repository does not exist yet. Create it at https://github.com/new
    with every "initialize with" box unticked.
  * Authentication. GitHub no longer accepts passwords over HTTPS — use a
    personal access token as the password (github.com → Settings → Developer
    settings → Personal access tokens → Fine-grained → repo access), or
    install the GitHub CLI and run `gh auth login`.
  * The repository already has commits, so the histories differ. If it is
    empty apart from an auto-created README, delete it and make a new one
    without the README.

FAILED
  exit 1
fi

echo
echo "Done. Now connect it to Netlify:"
echo "  Netlify → Add new site → Import an existing project → GitHub → pick this repo"
echo
echo "Then set the environment variables (see DEPLOY.md step 4) — the site will"
echo "deploy but cannot reach the spreadsheet until those are in place."
