#!/usr/bin/env bash
set -euxo pipefail

git config user.name "FastLED Candidate Builder"
git config user.email "fastled-candidate@users.noreply.github.com"

git fetch origin main agent/fastled-integration-candidate agent/fastled-main-sync-builder

# Every parallel acceptance lane must build the identical merge commit.
export GIT_AUTHOR_DATE="2026-10-02T09:45:00Z"
export GIT_COMMITTER_DATE="2026-10-02T09:45:00Z"

if GIT_AUTHOR_DATE="$GIT_AUTHOR_DATE" GIT_COMMITTER_DATE="$GIT_COMMITTER_DATE"     git merge --no-edit --no-ff origin/main; then
  :
else
  conflicts="$(git diff --name-only --diff-filter=U)"
  printf 'Conflicts:\n%s\n' "$conflicts"
  test "$conflicts" = "vite.config.ts"
  git checkout --theirs vite.config.ts
  git show origin/agent/fastled-main-sync-builder:scripts/fastled/resolve-current-main-vite.mjs > /tmp/resolve-current-main-vite.mjs
  node /tmp/resolve-current-main-vite.mjs
  git add vite.config.ts
  GIT_AUTHOR_DATE="$GIT_AUTHOR_DATE" GIT_COMMITTER_DATE="$GIT_COMMITTER_DATE"     git commit --no-edit
fi

GIT_AUTHOR_DATE="$GIT_AUTHOR_DATE" GIT_COMMITTER_DATE="$GIT_COMMITTER_DATE"   git commit --amend -m "merge(fastled): synchronize candidate with current main

X-Authored-Model: gpt-5-6-sol"

git merge-base --is-ancestor origin/main HEAD
git merge-base --is-ancestor origin/agent/fastled-integration-candidate HEAD

{
  echo "candidate=$(git rev-parse HEAD)"
  echo "tree=$(git rev-parse HEAD^{tree})"
  echo "main=$(git rev-parse origin/main)"
  echo "integration=$(git rev-parse origin/agent/fastled-integration-candidate)"
} | tee fastled-candidate-identity.txt
