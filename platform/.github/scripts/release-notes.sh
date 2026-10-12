#!/usr/bin/env bash
# Renders the "What's Changed" section for a release tag as Markdown on stdout.
# Usage: release-notes.sh <tag> [previous-tag]
set -euo pipefail

TAG="${1:?usage: release-notes.sh <tag> [previous-tag]}"
PREV="${2-}"

MAX_ENTRIES="${MAX_ENTRIES:-80}"
MAX_LEN="${MAX_LEN:-140}"

REPO_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}"
if [[ -z "${GITHUB_REPOSITORY:-}" ]]; then
  origin=$(git config --get remote.origin.url || echo "")
  origin="${origin%.git}"
  REPO_URL="${origin:-https://github.com}"
fi

# Previous tag: newest release tag that is an ancestor of this one. A stable tag
# compares against the last stable tag, so a v1.2.0 release still lists
# everything its rc tags already covered.
if [[ -z "$PREV" ]]; then
  tag_sha=$(git rev-parse "${TAG}^{commit}")
  while read -r candidate; do
    [[ -n "$candidate" ]] || continue
    [[ "$TAG" == *-* ]] || [[ "$candidate" != *-* ]] || continue
    [[ "$(git rev-parse "${candidate}^{commit}")" != "$tag_sha" ]] || continue
    PREV="$candidate"
    break
  done < <(git tag -l 'v*' --sort=-v:refname --merged "$TAG")
fi

if [[ -n "$PREV" ]]; then
  RANGE="${PREV}..${TAG}"
else
  RANGE="$TAG"
fi

# Trim a subject to something readable, preferring a clause boundary over a
# hard cut. Commit subjects in this repo are deliberately long and specific;
# the full text is one click away behind the PR link.
shorten() {
  local s="$1" cut best candidate sep
  s="${s//$'\n'/ }"
  s="$(printf '%s' "$s" | tr -s '[:space:]' ' ')"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  if (( ${#s} <= MAX_LEN )); then
    printf '%s' "$s"
    return
  fi
  cut="${s:0:MAX_LEN}"
  best=""
  for sep in ', ' '; ' ': ' ' ('; do
    candidate="${cut%"$sep"*}"
    [[ "$candidate" != "$cut" ]] || continue
    (( ${#candidate} >= 60 )) || continue
    (( ${#candidate} > ${#best} )) && best="$candidate"
  done
  if [[ -z "$best" ]]; then
    best="${cut% *}"
    [[ "$best" != "$cut" ]] || best="$cut"
  fi
  best="${best%[,;:.\ ]}"
  printf '%s…' "$best"
}

declare -A SECTION_LINES=()
SECTION_ORDER=(Features Fixes Performance Security Documentation Maintenance Other)
total=0
shown=0

while IFS=$'\t' read -r hash subject; do
  [[ -n "$hash" ]] || continue
  # Branch-sync merges carry no release-visible change of their own.
  [[ "$subject" != Merge\ branch\ * ]] || continue
  [[ "$subject" != Merge\ remote-tracking\ * ]] || continue

  pr=""
  title="$subject"
  if [[ "$subject" =~ ^Merge\ pull\ request\ \#([0-9]+) ]]; then
    pr="${BASH_REMATCH[1]}"
    body_first=$(git log -1 --format=%b "$hash" | grep -m1 -v '^[[:space:]]*$' || true)
    if [[ -n "$body_first" ]]; then
      title="$body_first"
    else
      # No PR title in the merge body: fall back to the branch name.
      title="${subject#*from }"
      title="${title#*/}"
      title="${title//-/ }"
    fi
  elif [[ "$subject" =~ \(#([0-9]+)\)$ ]]; then
    pr="${BASH_REMATCH[1]}"
    title="${subject% (#"${pr}")}"
  fi

  type="other"
  if [[ "$title" =~ ^([a-zA-Z]+)(\([^\)]*\))?(!)?:[[:space:]]*(.*)$ ]]; then
    type="${BASH_REMATCH[1],,}"
    title="${BASH_REMATCH[4]}"
  fi

  case "$type" in
    feat|feature) section="Features" ;;
    fix|bugfix|hotfix) section="Fixes" ;;
    perf) section="Performance" ;;
    sec|security) section="Security" ;;
    docs|doc) section="Documentation" ;;
    refactor|chore|build|ci|test|tests|style|deps) section="Maintenance" ;;
    *) section="Other" ;;
  esac

  total=$((total + 1))
  (( shown < MAX_ENTRIES )) || continue
  shown=$((shown + 1))

  title="$(shorten "$title")"
  [[ -z "$title" ]] && title="$subject"
  title="${title^}"

  if [[ -n "$pr" ]]; then
    ref="([#${pr}](${REPO_URL}/pull/${pr}))"
  else
    ref="([\`$(git rev-parse --short "$hash")\`](${REPO_URL}/commit/${hash}))"
  fi

  SECTION_LINES[$section]+="- ${title} ${ref}"$'\n'
done < <(git log --first-parent --format='%H%x09%s' "$RANGE")

printf '## What'\''s Changed\n\n'

if (( total == 0 )); then
  printf 'No changes recorded for this release.\n'
else
  for section in "${SECTION_ORDER[@]}"; do
    [[ -n "${SECTION_LINES[$section]:-}" ]] || continue
    printf '### %s\n\n%s\n' "$section" "${SECTION_LINES[$section]}"
  done
  if (( total > shown )); then
    printf '_...and %d more changes. See the full changelog below._\n\n' "$((total - shown))"
  fi
fi

if [[ -n "$PREV" ]]; then
  printf '**Full Changelog**: %s/compare/%s...%s\n' "$REPO_URL" "$PREV" "$TAG"
else
  printf '**Full Changelog**: %s/commits/%s\n' "$REPO_URL" "$TAG"
fi
