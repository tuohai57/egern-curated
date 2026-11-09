# Native module restoration

Restores all 96 module entries from the user-supplied v12.5 configuration. Original 90 enabled / 6 disabled flags are retained; one ordered protection module and one reviewed advertising delta module are added. Personal configuration, subscriptions, proxy credentials and CA are excluded from this repository.

Original module and JavaScript bytes, authors and provenance are retained in `originals/`, `scripts/` and `manifest.json`. Original script URLs remain in the modules. Required Egern compatibility corrections include body and binary flags, broken jq quoting, missing defaults, invalid rejection placeholders and original BiliBili gRPC response bytes and FMZ Meituan tiny-gif local responses. `url-path-ownership.json` documents limited, evidenced path exceptions that prevent known handlers from being preempted.

Run `python curated/tools/check_native_full.py` and `node curated/tools/test_native_full.cjs` from the repository root. Checks verify hashes, structure, jq compilation and synthetic behavior. They do not certify Egern 2.22.0 import, legacy script execution, CA trust, current App API contracts, privacy of system DNS fallback, or absence of every advertisement/countdown. Two scripts require function-scope runtime verification; one unavailable remote jq and one condition-lost logical rule are omitted. Full arbitrary-regex shadow proof is not claimed. See the manifest for all compatibility changes.

Reviewed: 2026-11-10. Upstream last-change timestamps have not been independently established for every asset; the review date is not an upstream update date.

The additional `adblock-rules.md` source inventory yielded 52 literal advertising domains after subtracting known rule/MITM intersections and ambiguous business names. The 210,661-domain suffix list is not mounted wholesale; shared IPs and keyword rules are not imported. Source and exclusion counts are in `repository-supplement-audit.json`.
