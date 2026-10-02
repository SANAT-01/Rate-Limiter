#!/bin/sh
# hammer.sh [N] [CLIENT] — fire N requests through the load balancer as one client
# and count how many got through vs got rate-limited.
# Default: 30 requests as a fresh client id (so every run starts a clean window).
N="${1:-30}"
CLIENT="${2:-client-$(date +%s)-$$}"

allowed=0
denied=0
i=0
while [ "$i" -lt "$N" ]; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Client: $CLIENT" http://localhost:8090/)
  if [ "$code" = "200" ]; then
    allowed=$((allowed + 1))
  elif [ "$code" = "429" ]; then
    denied=$((denied + 1))
  fi
  i=$((i + 1))
done
echo "client=$CLIENT  sent=$N  allowed=$allowed  denied(429)=$denied"
