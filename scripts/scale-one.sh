#!/bin/bash
# scale-one.sh <owner__repo>: prepare, run the fix stage with the default architecture plus the judge, keep only results.
S=${SHIM_WORK:-$HOME/shim-work}
r=$1; d=$S/scale/$r
[ -f $d/result.json ] && { echo "$r already done"; exit 0; }
"$(dirname "$0")"/prep-one.sh $r $S/scale > /dev/null
if grep -q '"prepared"' $d/prepared.json 2>/dev/null; then
  cd "$(dirname "$0")/.."
  timeout 21600 npx tsx src/cli.ts finish $d/repo --prep $d/prepared.json --out $d --judge > $d/finish.log 2>&1
fi
rm -rf $d/repo $d/repo.cand* $S/work/$r
v=$(python3 -c "import json;r=json.load(open('$d/result.json'));print(r['verdict'],'judge=',(r.get('judge') or {}).get('approve'),r['reason'][:120])" 2>/dev/null || python3 -c "import json;print('skip',json.load(open('$d/prepared.json')).get('skip'))" 2>/dev/null)
echo "$(date +%T) $r $v"
