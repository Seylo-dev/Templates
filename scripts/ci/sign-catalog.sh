#!/usr/bin/env bash
# Checks, signs and publishes the template catalog. In
# .github/workflows/publish.yml this runs in the Sign job, the only job that
# sees the catalog key. It gets catalog.json from the Build job (which ran
# bun and the App's check code) and runs none of that code: only git, jq,
# sha256sum, base64, cmp, minisign and gh.
#
#   scripts/ci/sign-catalog.sh sign <dir>
#     Signs <dir>/catalog.json into <dir>/catalog.json.minisig, only when:
#       - it is format 1 from Seylo-dev/Templates, built from this checkout's
#         HEAD, and its sequence is HEAD's commit count;
#       - its templates are exactly HEAD's folders under templates/, each
#         with exactly their files, byte for byte, and every sha256 is right;
#       - its notice is NOTICE and its licenses are the LICENSE.* files.
#     So whatever ran in the Build job, the signed catalog holds this
#     commit's templates and nothing else. The trusted comment is
#     "seylo templates catalog seq=<sequence> commit=<commit>". The signature
#     must verify with catalog.pub.
#     Needs MINISIGN_SECRET_KEY (the key file) and MINISIGN_PASSWORD (may be
#     empty). CATALOG_PUBLIC_KEY (the "RW..." key) stands in for catalog.pub,
#     for the dry run's throwaway key.
#
#   scripts/ci/sign-catalog.sh upload <dir>
#     Checks <dir> again, then uploads catalog.json and catalog.json.minisig
#     to the "catalog" release (created on first use), unless the published
#     catalog has a higher sequence, or the same one from another commit:
#     panels refuse a lower sequence, so either means main's history was
#     rewritten. Downloads both files again and verifies them. Needs gh
#     (GH_TOKEN) and GITHUB_REPOSITORY.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
source_name=Seylo-dev/Templates
release=catalog

usage() {
  echo "usage: scripts/ci/sign-catalog.sh sign <dir> | upload <dir>" >&2
  exit 2
}
die() {
  echo "sign-catalog: $*" >&2
  [ "${GITHUB_ACTIONS:-}" != true ] || echo "::error title=Catalog not published::$*"
  exit 1
}
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1; else shasum -a 256 | cut -d' ' -f1; fi
}
repo_git() { git -C "$root" "$@"; }

[ $# -eq 2 ] || usage
cmd=$1 dir=$2
case $cmd in sign | upload) ;; *) usage ;; esac
[ -d "$dir" ] || die "$dir is not a folder"
cat=$dir/catalog.json
[ -f "$cat" ] || die "$cat is missing"
jq -e 'type == "object"' "$cat" >/dev/null 2>&1 || die "catalog.json is not a JSON object"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

[ "$(repo_git rev-parse --is-shallow-repository)" = false ] ||
  die "the checkout is shallow, so HEAD's commit count is unknown (fetch-depth: 0)"
commit=$(repo_git rev-parse HEAD)
sequence=$(repo_git rev-list --count HEAD)
comment="seylo templates catalog seq=$sequence commit=$commit"

key=${CATALOG_PUBLIC_KEY:-}
[ -n "$key" ] || key=$(sed -n 2p "$root/catalog.pub" 2>/dev/null || true)
case $key in
"" | PLACEHOLDER_*) die "catalog.pub holds no key yet (CONTRIBUTING.md, \"Signing key\")" ;;
esac

# One field of the catalog as raw text.
field() { jq -r "$1" "$cat"; }

# The file a catalog entry holds, decoded, into $tmp/entry.
entry_file() {
  local slug=$1 file=$2 kind
  kind=$(jq -r --arg s "$slug" --arg f "$file" '.templates[] | select(.slug == $s) | .files[$f]
    | if (.text | type) == "string" then "text" elif (.base64 | type) == "string" then "base64" else "none" end' "$cat")
  case $kind in
  text) jq -j --arg s "$slug" --arg f "$file" '.templates[] | select(.slug == $s) | .files[$f].text' "$cat" >"$tmp/entry" ;;
  base64)
    jq -j --arg s "$slug" --arg f "$file" '.templates[] | select(.slug == $s) | .files[$f].base64' "$cat" |
      base64 -d >"$tmp/entry" 2>/dev/null || die "templates/$slug/$file: its base64 in the catalog does not decode"
    ;;
  *) die "templates/$slug/$file has no content in the catalog" ;;
  esac
}

check_catalog() {
  local got slug file name count=0
  got=$(field .format)
  [ "$got" = 1 ] || die "the catalog has format $got, not 1"
  got=$(field .source)
  [ "$got" = "$source_name" ] || die "the catalog's source is $got, not $source_name"
  got=$(field .commit)
  [ "$got" = "$commit" ] || die "the catalog was built from $got, not from HEAD ($commit)"
  got=$(field .sequence)
  [ "$got" = "$sequence" ] || die "the catalog's sequence is $got, not HEAD's commit count ($sequence)"
  jq -e '(.generatedAt | type) == "string" and (.notice | type) == "string" and (.licenses | type) == "object" and (.templates | type) == "array"' \
    "$cat" >/dev/null || die "the catalog lacks generatedAt, notice, licenses or templates"

  # The same templates as HEAD's folders under templates/.
  repo_git ls-tree -d --name-only HEAD templates/ | sed 's#^templates/##' | LC_ALL=C sort >"$tmp/repo-slugs"
  jq -r '.templates[].slug' "$cat" | LC_ALL=C sort >"$tmp/catalog-slugs"
  [ -s "$tmp/repo-slugs" ] || die "HEAD has no templates"
  cmp -s "$tmp/repo-slugs" "$tmp/catalog-slugs" ||
    die "the catalog's templates are not HEAD's folders: $(diff "$tmp/repo-slugs" "$tmp/catalog-slugs" | sed -n 's/^</only in HEAD:/p; s/^>/only in the catalog:/p' | tr '\n' ' ')"

  # Each with exactly HEAD's files, byte for byte.
  while IFS= read -r slug; do
    repo_git ls-tree --name-only HEAD "templates/$slug/" | sed "s#^templates/$slug/##" | LC_ALL=C sort >"$tmp/repo-files"
    jq -r --arg s "$slug" '.templates[] | select(.slug == $s) | .files | keys[]' "$cat" | LC_ALL=C sort >"$tmp/catalog-files"
    cmp -s "$tmp/repo-files" "$tmp/catalog-files" ||
      die "templates/$slug: the catalog has $(tr '\n' ' ' <"$tmp/catalog-files")and HEAD has $(tr '\n' ' ' <"$tmp/repo-files")"
    while IFS= read -r file; do
      entry_file "$slug" "$file"
      repo_git cat-file blob "HEAD:templates/$slug/$file" >"$tmp/head"
      cmp -s "$tmp/entry" "$tmp/head" || die "templates/$slug/$file in the catalog is not the file in HEAD"
      got=$(jq -r --arg s "$slug" --arg f "$file" '.templates[] | select(.slug == $s) | .files[$f].sha256' "$cat")
      [ "$got" = "$(sha256 <"$tmp/head")" ] || die "templates/$slug/$file: the catalog's sha256 for it is wrong"
    done <"$tmp/repo-files"
    count=$((count + 1))
  done <"$tmp/repo-slugs"

  # The logos' credits.
  jq -j .notice "$cat" >"$tmp/entry"
  repo_git cat-file blob HEAD:NOTICE >"$tmp/head" 2>/dev/null || die "HEAD has no NOTICE"
  cmp -s "$tmp/entry" "$tmp/head" || die "the catalog's notice is not HEAD's NOTICE"
  repo_git ls-tree --name-only HEAD | { grep '^LICENSE\.' || true; } | LC_ALL=C sort >"$tmp/repo-licenses"
  jq -r '.licenses | keys[]' "$cat" | LC_ALL=C sort >"$tmp/catalog-licenses"
  cmp -s "$tmp/repo-licenses" "$tmp/catalog-licenses" ||
    die "the catalog's licenses ($(tr '\n' ' ' <"$tmp/catalog-licenses")) are not HEAD's LICENSE.* files ($(tr '\n' ' ' <"$tmp/repo-licenses"))"
  while IFS= read -r name; do
    jq -j --arg n "$name" '.licenses[$n]' "$cat" >"$tmp/entry"
    repo_git cat-file blob "HEAD:$name" >"$tmp/head"
    cmp -s "$tmp/entry" "$tmp/head" || die "the catalog's $name is not HEAD's"
  done <"$tmp/repo-licenses"
  echo "sign-catalog: catalog.json holds HEAD's $count templates byte for byte (sequence $sequence, commit $commit)"
}

# minisign -V with the catalog key, and the trusted comment for this commit.
verify() {
  local out
  out=$(minisign -V -P "$key" -m "$1" -x "$2" 2>&1) || return 1
  grep -qxF "Trusted comment: $comment" <<<"$out"
}

sign() {
  if [ -z "${MINISIGN_SECRET_KEY:-}" ] || [ ! -f "$MINISIGN_SECRET_KEY" ]; then die "MINISIGN_SECRET_KEY must name the key file"; fi
  check_catalog
  rm -f "$cat.minisig"
  printf '%s\n' "${MINISIGN_PASSWORD:-}" |
    minisign -S -s "$MINISIGN_SECRET_KEY" -m "$cat" -x "$cat.minisig" -t "$comment" >/dev/null 2>&1 ||
    die "could not sign with MINISIGN_SECRET_KEY (wrong MINISIGN_PASSWORD?)"
  verify "$cat" "$cat.minisig" || {
    rm -f "$cat.minisig"
    die "the signature does not verify with catalog.pub: MINISIGN_SECRET_KEY is another key"
  }
  echo "sign-catalog: signed catalog.json ($comment)"
}

upload() {
  local repo=${GITHUB_REPOSITORY:-} published_sequence published_commit left=""
  [ -n "$repo" ] || die "GITHUB_REPOSITORY is not set"
  [ -f "$cat.minisig" ] || die "catalog.json.minisig is missing: run sign first"
  check_catalog
  verify "$cat" "$cat.minisig" || die "catalog.json.minisig does not verify with catalog.pub"

  if gh release view "$release" --repo "$repo" --json tagName >/dev/null 2>&1; then
    mkdir "$tmp/published"
    if gh release download "$release" --repo "$repo" --pattern catalog.json --dir "$tmp/published" >/dev/null 2>&1; then
      published_sequence=$(jq -r '.sequence' "$tmp/published/catalog.json" 2>/dev/null || true)
      published_commit=$(jq -r '.commit' "$tmp/published/catalog.json" 2>/dev/null || true)
      case $published_sequence in
      "" | *[!0-9]*) echo "sign-catalog: warning: the published catalog.json has no sequence; replacing it" >&2 ;;
      *)
        if [ "$published_sequence" -gt "$sequence" ] ||
          { [ "$published_sequence" -eq "$sequence" ] && [ "$published_commit" != "$commit" ]; }; then
          die "the published catalog has sequence $published_sequence (commit $published_commit) and this one $sequence (commit $commit). Panels refuse a lower sequence, so main's history must never be rewritten (CONTRIBUTING.md, \"Publishing\")."
        fi
        left=$(jq -r --slurpfile new "$cat" '[.templates[].slug] - [$new[0].templates[].slug] | join(", ")' "$tmp/published/catalog.json" 2>/dev/null || true)
        ;;
      esac
    fi
  else
    gh release create "$release" --repo "$repo" --title "Template catalog" --latest=false \
      --notes "The template catalog Seylo panels download." >/dev/null || die "could not create the $release release"
  fi

  gh release upload "$release" --repo "$repo" --clobber "$cat" "$cat.minisig" >/dev/null || die "uploading to the $release release failed"
  gh release edit "$release" --repo "$repo" --notes "The template catalog Seylo panels download: catalog.json and its minisign signature, replaced by the Publish workflow on every push to main. Do not edit or delete this release.

Sequence $sequence, built from $commit ($(jq '.templates | length' "$cat") templates)." >/dev/null ||
    echo "sign-catalog: warning: could not update the release notes" >&2

  mkdir "$tmp/after"
  gh release download "$release" --repo "$repo" --pattern 'catalog.json*' --dir "$tmp/after" >/dev/null ||
    die "could not download the files just uploaded"
  if ! cmp -s "$tmp/after/catalog.json" "$cat" || ! cmp -s "$tmp/after/catalog.json.minisig" "$cat.minisig"; then
    die "the $release release does not serve the files just uploaded"
  fi
  verify "$tmp/after/catalog.json" "$tmp/after/catalog.json.minisig" || die "the published signature does not verify"
  echo "sign-catalog: published sequence $sequence (commit $commit)"
  [ -z "$left" ] || echo "sign-catalog: no longer in the catalog: $left"
}

"$cmd"
