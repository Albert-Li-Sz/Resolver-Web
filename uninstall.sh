#!/usr/bin/env bash
set -euo pipefail
directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
manager="$directory/manage.sh"
if [ ! -f "$manager" ]; then manager="$directory/install.sh"; fi
exec bash "$manager" uninstall "$@"
