#!/bin/sh
# minisign for the Check and Publish workflows, from its own GitHub release
# instead of apt (a copy of Seylo-dev/App scripts/ci/install-minisign.sh:
# on 2026-11-11 Ubuntu's mirror stopped resolving on GitHub's runners and
# apt installs failed). jq and yq, which scripts/ci/sign-catalog.sh also
# needs, come with the runner image (ubuntu-24.04).
#
# The tarball is pinned by its sha256. When the pin was taken its .minisig
# verified against the minisign author's key
# (RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3).
set -eu

VERSION=0.11
SHA256=f0a0954413df8531befed169e447a66da6868d79052ed7e892e50a4291af7ae0
URL="https://github.com/jedisct1/minisign/releases/download/$VERSION/minisign-$VERSION-linux.tar.gz"

command -v jq >/dev/null 2>&1 || { echo "install-minisign: jq is missing from the runner image" >&2; exit 1; }

case $(uname -m) in
  x86_64 | amd64) arch=x86_64 ;;
  aarch64 | arm64) arch=aarch64 ;;
  *) echo "install-minisign: no minisign build for $(uname -m)" >&2; exit 1 ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 -o "$tmp/minisign.tar.gz" "$URL"
echo "$SHA256  $tmp/minisign.tar.gz" | sha256sum -c - >/dev/null
tar -xzf "$tmp/minisign.tar.gz" -C "$tmp"
sudo install -m 0755 "$tmp/minisign-linux/$arch/minisign" /usr/local/bin/minisign
minisign -v
