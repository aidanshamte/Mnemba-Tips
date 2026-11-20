#!/usr/bin/env bash
# Canary release for the Mnemba Tips Azure Container App.
#
#   release.sh prepare                      Multiple-revision mode; pin 100% to the serving revision.
#   release.sh deploy <image> <suffix>      New revision at 0% traffic, labelled "candidate"; waits until healthy.
#   release.sh traffic <revision> <weight>  Candidate weight (e.g. 10, 50, 100); the rest stays on the stable revision.
#   release.sh jobs <image>                 Point the existing scheduled jobs at the verified image (no new jobs).
#   release.sh rollback <revision>          Return 100% of traffic to <revision>.
#   release.sh status                       Revisions, weights, health and labels.
#
# The candidate is reachable before any public traffic at https://<app>---candidate.<environment domain>.
# Revisions are never deleted; the previous serving revision keeps running at 0% for instant rollback.
set -euo pipefail
RG="${AZURE_RESOURCE_GROUP:-mnemba-azure}" APP="${AZURE_APP:-mnemba-web}"
JOBS="${AZURE_JOBS:-mnemba-update-0 mnemba-update-1 mnemba-update-2}"
az() { command az "$@" --only-show-errors; }
log() { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }

serving() { # revision currently receiving the most traffic (resolves "latestRevision")
  local named; named=$(az containerapp ingress traffic show -g "$RG" -n "$APP" --query "sort_by([?revisionName!=null && weight>\`0\`],&weight)[-1].revisionName" -o tsv)
  if [ -n "$named" ]; then echo "$named"; else az containerapp show -g "$RG" -n "$APP" --query properties.latestReadyRevisionName -o tsv; fi
}
domain() { az containerapp show -g "$RG" -n "$APP" --query properties.configuration.ingress.fqdn -o tsv | cut -d. -f2-; }

wait_healthy() { # <revision>
  for _ in $(seq 1 60); do
    read -r health running prov < <(az containerapp revision show -g "$RG" -n "$APP" --revision "$1" --query "[properties.healthState,properties.runningState,properties.provisioningState]" -o tsv | tr '\n\t' '  ')
    log "$1 health=$health running=$running provisioning=$prov"
    if [ "$health" = Healthy ] && [[ "$running" == Running* ]]; then return 0; fi
    if [ "$prov" = Failed ] || [ "$health" = Unhealthy ]; then return 1; fi
    sleep 15
  done; return 1
}

case "${1:-}" in
  prepare)
    stable=$(serving)
    mode=$(az containerapp show -g "$RG" -n "$APP" --query properties.configuration.activeRevisionsMode -o tsv)
    [ "$mode" = Multiple ] || { log "switching $APP to multiple-revision mode"; az containerapp revision set-mode -g "$RG" -n "$APP" --mode Multiple -o none; }
    # Pin traffic by name so a new revision starts at 0% instead of taking "latestRevision".
    az containerapp ingress traffic set -g "$RG" -n "$APP" --revision-weight "$stable=100" -o none
    log "traffic pinned: $stable=100"; echo "$stable" ;;
  deploy)
    image="$2" suffix="$3" revision="$APP--$3"
    [ "$(az containerapp show -g "$RG" -n "$APP" --query properties.configuration.activeRevisionsMode -o tsv)" = Multiple ] || { log 'run prepare first'; exit 1; }
    az containerapp update -g "$RG" -n "$APP" --image "$image" --revision-suffix "$suffix" -o none
    wait_healthy "$revision" || { log "candidate $revision is not healthy"; exit 1; }
    weight=$(az containerapp ingress traffic show -g "$RG" -n "$APP" --query "[?revisionName=='$revision'].weight|[0]" -o tsv)
    [ "${weight:-0}" = 0 ] || { log "candidate unexpectedly has ${weight}% traffic"; exit 1; }
    az containerapp revision label add -g "$RG" -n "$APP" --label candidate --revision "$revision" --yes -o none
    log "candidate $revision at 0% traffic: https://$APP---candidate.$(domain)"; echo "$revision" ;;
  traffic)
    revision="$2" weight="$3"; stable=$(az containerapp ingress traffic show -g "$RG" -n "$APP" --query "sort_by([?revisionName!=null && revisionName!='$revision' && weight>\`0\`],&weight)[-1].revisionName" -o tsv)
    wait_healthy "$revision" || { log "candidate not healthy; traffic unchanged"; exit 1; }
    if [ "$weight" -ge 100 ] || [ -z "$stable" ]; then
      az containerapp ingress traffic set -g "$RG" -n "$APP" --revision-weight "$revision=100" -o none
      [ -z "$stable" ] || az containerapp revision label add -g "$RG" -n "$APP" --label previous --revision "$stable" --yes -o none
    else
      az containerapp ingress traffic set -g "$RG" -n "$APP" --revision-weight "$stable=$((100 - weight))" "$revision=$weight" -o none
    fi
    az containerapp ingress traffic show -g "$RG" -n "$APP" -o table >&2 ;;
  jobs)
    for job in $JOBS; do az containerapp job update -g "$RG" -n "$job" --image "$2" -o none; log "$job -> $2"; done ;;
  rollback)
    az containerapp ingress traffic set -g "$RG" -n "$APP" --revision-weight "$2=100" -o none
    log "all traffic returned to $2"; az containerapp ingress traffic show -g "$RG" -n "$APP" -o table >&2 ;;
  status)
    az containerapp revision list -g "$RG" -n "$APP" --query "[?properties.active].{revision:name,traffic:properties.trafficWeight,health:properties.healthState,running:properties.runningState,image:properties.template.containers[0].image}" -o table
    az containerapp ingress traffic show -g "$RG" -n "$APP" -o table ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
