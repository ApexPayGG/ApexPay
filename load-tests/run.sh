#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
mkdir -p results

echo "=== ApexPay load tests (k6) — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

k6 run --out json=results/payment-flow.json scenarios/payment-flow.ts
k6 run --out json=results/concurrent-charges.json scenarios/concurrent-charges.ts
k6 run --out json=results/webhook-storm.json scenarios/webhook-storm.ts
k6 run --out json=results/fraud-detection.json scenarios/fraud-detection.ts

echo "=== Zakończono. JSON: results/*.json ==="
