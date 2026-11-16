#!/usr/bin/env bash
# Work around an unrelated, intermittently unreachable Microsoft APT feed on
# GitHub-hosted Ubuntu runners. Preserve Playwright's --with-deps installation
# from the official Ubuntu repositories. Only runs inside ephemeral CI jobs.
set -euo pipefail
for repo_file in /etc/apt/sources.list.d/microsoft-prod.list /etc/apt/sources.list.d/microsoft-prod.sources; do
  if [[ -f "$repo_file" ]]; then
    sudo mv "$repo_file" "$repo_file.disabled"
    echo "Disabled unrelated unavailable APT feed: $repo_file"
  fi
done
