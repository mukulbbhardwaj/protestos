#!/bin/sh
# Pre-commit secret scan. Uses a local gitleaks if installed, otherwise the Docker image.
set -e
GITLEAKS_VERSION=v8.30.1
if command -v gitleaks >/dev/null 2>&1; then
  exec gitleaks git --staged --redact --config .gitleaks.toml
fi
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  exec docker run --rm -v "$(pwd):/repo" -w /repo "ghcr.io/gitleaks/gitleaks:${GITLEAKS_VERSION}" \
    git --staged --redact --config .gitleaks.toml
fi
echo "gitleaks is required for commits. Install it (brew install gitleaks) or start Docker." >&2
exit 1
