#!/usr/bin/env bash
# Purge Cloudflare's cache for endless.scooom.com only.
#
#   tools/purge-cache.sh            purge
#   tools/purge-cache.sh --dry-run  show the zone and request, send nothing
#
# Token: first line of /opt/endless/.cloudflare (override with CF_TOKEN_FILE); a KEY= prefix is ignored.
# Zone: CF_ZONE_ID if set, otherwise looked up by name (the token then needs Zone:Read).
# The host is fixed on purpose; this never sends purge_everything.
set -euo pipefail

HOST="endless.scooom.com"
ZONE_NAME="scooom.com"
TOKEN_FILE="${CF_TOKEN_FILE:-/opt/endless/.cloudflare}"
API="https://api.cloudflare.com/client/v4"
DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1
[[ $# -gt 0 && $DRY -eq 0 ]] && { echo "usage: $0 [--dry-run]" >&2; exit 2; }

[[ -r "$TOKEN_FILE" ]] || { echo "cannot read token file $TOKEN_FILE" >&2; exit 1; }
TOKEN="$(head -n1 "$TOKEN_FILE")"
TOKEN="${TOKEN#*=}"
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]"'"'")"
[[ -n "$TOKEN" ]] || { echo "token file is empty" >&2; exit 1; }

# the token goes to curl on stdin as a header, so it never shows up in ps or the terminal
cf() { printf 'Authorization: Bearer %s\n' "$TOKEN" | curl -sS -H @- -H "Content-Type: application/json" "$@"; }

errors() { python3 -c 'import json,sys
d=json.load(sys.stdin)
print("; ".join(e.get("message","?")+" ("+str(e.get("code"))+")" for e in d.get("errors",[])) or "unknown error")'; }

ZONE="${CF_ZONE_ID:-}"
if [[ -z "$ZONE" ]]; then
  RESP="$(cf "$API/zones?name=$ZONE_NAME")"
  ZONE="$(printf '%s' "$RESP" | python3 -c 'import json,sys
d=json.load(sys.stdin); r=d.get("result") or []
print(r[0]["id"] if d.get("success") and r else "")')"
  if [[ -z "$ZONE" ]]; then
    echo "could not look up zone $ZONE_NAME: $(printf '%s' "$RESP" | errors)" >&2
    echo "give the token Zone:Read, or set CF_ZONE_ID" >&2
    exit 1
  fi
fi

BODY="{\"hosts\":[\"$HOST\"]}"
if [[ $DRY -eq 1 ]]; then
  echo "zone $ZONE_NAME ($ZONE)"
  echo "would POST $API/zones/$ZONE/purge_cache $BODY"
  exit 0
fi

RESP="$(cf -X POST "$API/zones/$ZONE/purge_cache" --data "$BODY")"
if printf '%s' "$RESP" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("success") else 1)'; then
  echo "purged cache for $HOST"
else
  echo "purge failed: $(printf '%s' "$RESP" | errors)" >&2
  exit 1
fi
