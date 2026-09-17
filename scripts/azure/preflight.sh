#!/usr/bin/env bash
set -euo pipefail
: "${AZURE_SUBSCRIPTION_ID:?Set the selected subscription ID}"
: "${AZURE_LOCATION:?Set an eligible region}"
az account show --subscription "$AZURE_SUBSCRIPTION_ID" --query '{name:name,id:id,state:state}' -o json
az rest --url "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID?api-version=2022-12-01" --query '{displayName:displayName,state:state,policies:subscriptionPolicies}'
az policy assignment list --scope "/subscriptions/$AZURE_SUBSCRIPTION_ID" --query '[].{name:displayName,parameters:parameters}'
for provider in Microsoft.App Microsoft.DBforPostgreSQL Microsoft.Network Microsoft.ContainerRegistry Microsoft.ManagedIdentity; do
  az provider show --subscription "$AZURE_SUBSCRIPTION_ID" --namespace "$provider" --query '{namespace:namespace,state:registrationState}'
done
az postgres flexible-server list-skus --subscription "$AZURE_SUBSCRIPTION_ID" --location "$AZURE_LOCATION" -o json
az rest --url "https://management.azure.com/subscriptions/$AZURE_SUBSCRIPTION_ID/providers/Microsoft.App/locations/$AZURE_LOCATION/usages?api-version=2025-01-01" -o json
printf '%s\n' 'Also verify remaining student credit, expiration, and PostgreSQL free-service entitlement in Azure Portal. No resources were changed.'
