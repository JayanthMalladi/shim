#!/usr/bin/env python3
"""Collect scale results into a CSV and copy PR-ready drafts (gates + judge approved) to project files."""
import csv, json, os, shutil, glob
S = os.environ.get("SHIM_WORK", os.path.expanduser("~/shim-work"))
OUT = os.environ.get("SHIM_OUT", os.path.join(S, "out"))
DRAFTS = os.path.join(OUT, "drafts")
os.makedirs(OUT, exist_ok=True)
rows = []
for d in sorted(glob.glob(f"{S}/scale/*")):
    name = os.path.basename(d)
    repo = name.replace("__", "/", 1)
    prep = json.load(open(f"{d}/prepared.json")) if os.path.exists(f"{d}/prepared.json") else {}
    if "skip" in prep:
        rows.append(dict(repo=repo, outcome="skip", reason=prep["skip"])); continue
    if not os.path.exists(f"{d}/result.json"):
        rows.append(dict(repo=repo, outcome="pending")); continue
    r = json.load(open(f"{d}/result.json")); rep = json.load(open(f"{d}/report.json"))
    judge = (r.get("judge") or {}).get("approve")
    code_files = [f for f in rep.get("changedFiles", []) if not f.endswith(("package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock", "bun.lockb"))]
    outcome = "pr-ready" if r["verdict"] == "open-pr" and judge else ("judge-rejected" if r["verdict"] == "open-pr" else r["verdict"])
    rows.append(dict(repo=repo, outcome=outcome, kind="code" if code_files else "deps-only",
                     checks=sum(rep["baseline"].values()), cost=round(r.get("cost") or 0, 2),
                     reason="; ".join((r.get("judge") or {}).get("issues", []))[:300] if outcome == "judge-rejected" else r["reason"][:300]))
    if outcome == "pr-ready":
        dd = f"{DRAFTS}/{name}"; os.makedirs(dd, exist_ok=True)
        body = open(f"{d}/pr-body.md").read()
        open(f"{dd}/pr.md", "w").write(f"# Draft PR for {repo}\n\n**Title:** Upgrade to AI SDK 7\n\n---\n\n{body}")
        shutil.copy(f"{d}/changes.patch", f"{dd}/changes.patch")
keys = ["repo", "outcome", "kind", "checks", "cost", "reason"]
with open(f"{OUT}/scale-results.csv", "w", newline="") as f:
    w = csv.DictWriter(f, keys); w.writeheader(); [w.writerow({k: r.get(k, "") for k in keys}) for r in rows]
from collections import Counter
print(Counter(r["outcome"] for r in rows))
print([r["repo"] for r in rows if r["outcome"] == "pr-ready"])
