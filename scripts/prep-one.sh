#!/bin/bash
# prep-one.sh <owner__repo> <destRoot>: copy the pristine clone and run the prepare stage.
S=${SHIM_WORK:-$HOME/shim-work}
r=$1; root=$2; d=$root/$r
rm -rf $d; mkdir -p $d
[ -d $S/work/$r ] || git clone -q --depth 1 https://github.com/${r/__//}.git $S/work/$r
cp -a $S/work/$r $d/repo
cd "$(dirname "$0")/.."
timeout 2400 npx tsx src/cli.ts prepare $d/repo --repo "${r/__//}" --out $d > $d/prepare.log 2>&1
echo "$r $(date +%T) $(tail -c 300 $d/prepare.log | tr '\n' ' ')"
