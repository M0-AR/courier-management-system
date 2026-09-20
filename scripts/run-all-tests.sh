#!/usr/bin/env bash
# One-command full-stack quality gate — mirrors CI locally.
# Usage: ./scripts/run-all-tests.sh [--smoke]
#   --smoke  PR-style fast run (backend gate + unit + @smoke E2E only)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SMOKE="${1:-}"

echo "=== 1/4 backend contract suite (pytest, 85% coverage gate) ==="
(cd "$ROOT/backend" && python3 -m pytest)

echo "=== 2/4 frontend unit suite (vitest) ==="
(cd "$ROOT/frontend" && npm run test:unit)

echo "=== 3/4 stack up + seeded demo data ==="
(cd "$ROOT" && docker compose up -d --build)
(cd "$ROOT" && docker compose exec backend python -m app.seed_demo --yes)
(cd "$ROOT" && docker compose exec cache redis-cli flushall)

echo "=== 4/4 Playwright E2E ${SMOKE:+(@smoke)} ==="
if [ "$SMOKE" = "--smoke" ]; then
  (cd "$ROOT/frontend" && BASE_URL="http://localhost:${APP_PORT:-8081}" npx playwright test --grep @smoke)
else
  (cd "$ROOT/frontend" && BASE_URL="http://localhost:${APP_PORT:-8081}" npx playwright test)
fi

echo "ALL GATES GREEN ✔ backend + unit + e2e"
