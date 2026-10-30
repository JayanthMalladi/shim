# Shim architecture evolution log

Updated 2026-10-27T23:21:46.992Z. Score = PRs the fixed judge approves. Gate-pass = PRs by checks alone. False-pass = gate-pass the judge rejected.

## dev set (5 repos)

| Rank | Architecture | Parent | Shipped | Gate-pass | False-pass | Cost | Minutes |
|---|---|---|---|---|---|---|---|
| 1 | v1-single-retry | seed | 3/5 | 4 | 1 | $6.87 | 35 |

Per repo (P = shipped, p = gate-pass but judge rejected, i = issue, e = error):

| Architecture | cloudflare/ai | lumea-labs/polpo | frayme-ai/frayme-sdk | KrzysztofMarmol/mjml-agent-editor | upstash/context7 |
|---|---|---|---|---|---|
| v1-single-retry | i | p | P | P | P |

## Every architecture tried

### v1-single-retry (invalid run)

Baseline: the first pipeline. One fixer, up to 3 attempts on failing checks, no reviewer.

Set dev; shipped 0/5; $3.10; 42 min; 2026-10-27T21:47:46.652Z; fixer runs hit the plan session limit (mjml, context7) and the judge gave no verdict (frayme); rerun

```json
{"candidates":1,"attempts":3,"fixerModel":"claude-opus-5-5","fixerMaxTurns":40,"audit":false,"review":false,"reviewerModel":"claude-opus-5-5","reviewRounds":0,"selection":"first"}
```

### v1-single-retry

Baseline: the first pipeline. One fixer, up to 3 attempts on failing checks, no reviewer.

Set dev; shipped 3/5; $6.87; 35 min; 2026-10-27T23:21:46.991Z

```json
{"candidates":1,"attempts":3,"fixerModel":"claude-opus-5-5","fixerMaxTurns":40,"audit":false,"review":false,"reviewerModel":"claude-opus-5-5","reviewRounds":0,"selection":"first"}
```
