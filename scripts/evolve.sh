#!/bin/bash
# evolve.sh <hours>: one resumable chunk of the evolution loop on the dev set.
S=${SHIM_WORK:-$HOME/shim-work}
# Prepare the bench first: for r in $(cat data/overnight-2026-10-28/bench-repos.txt); do scripts/prep-one.sh $r $S/bench; done
mkdir -p $S/evolve
cd "${SHIM_FROZEN:-$(dirname "$0")/..}"
npx tsx src/evolve.ts --bench $S/bench --repos cloudflare__ai,lumea-labs__polpo,frayme-ai__frayme-sdk,KrzysztofMarmol__mjml-agent-editor,upstash__context7 \
  --out $S/evolve --set dev --hours $1 --concurrency 2 ${SHIM_MIRROR:+--mirror $SHIM_MIRROR}
