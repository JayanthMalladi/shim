#!/bin/bash
S=${SHIM_WORK:-$HOME/shim-work}
mkdir -p $S/logs $S/scale
xargs -P 2 -I{} "$(dirname "$0")"/scale-one.sh {} < ${1:-"$(dirname "$0")"/../data/overnight-2026-10-28/scale-repos.txt} >> $S/logs/scale.log 2>&1
echo "DONE $(date +%T)" >> $S/logs/scale.log
