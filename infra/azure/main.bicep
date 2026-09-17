targetScope = 'resourceGroup'
param location string = resourceGroup().location
param prefix string = 'mnemba'
param postgresName string
param registryName string
@secure()
param postgresPassword string
param postgresUser string = 'mnembaadmin'
@secure()
param runtimeDatabaseUrl string = ''
param imageTag string = 'migration'
param databaseSchema string = 'production_snapshot'
// First deploy foundation, push the verified image, then enable runtime.
param deployRuntime bool = false
param enableUpdates bool = false
param alertEmail string = 'aidan.shamte@student.fairfield.edu'
param budgetStart string = '2026-09-01T00:00:00Z'
@secure()
param appSecrets object = {}
param appSecretEnv array = []
param storageName string


resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${prefix}-vnet'
  location: location
  properties: {
    addressSpace: { addressPrefixes: ['10.42.0.0/16'] }
    subnets: [
      { name: 'apps', properties: { addressPrefix: '10.42.0.0/23', delegations: [{ name: 'apps', properties: { serviceName: 'Microsoft.App/environments' } }] } }
      { name: 'postgres', properties: { addressPrefix: '10.42.2.0/28', delegations: [{ name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }] } }
    ]
  }
}
resource dns 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: '${prefix}.postgres.database.azure.com'
  location: 'global'
}
resource link 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: dns
  name: '${prefix}-link'
  location: 'global'
  properties: { registrationEnabled: false, virtualNetwork: { id: vnet.id } }
}
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresName
  location: location
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '17'
    administratorLogin: postgresUser
    administratorLoginPassword: postgresPassword
    storage: { storageSizeGB: 32, autoGrow: 'Disabled' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: {
      delegatedSubnetResourceId: '${vnet.id}/subnets/postgres'
      privateDnsZoneArmResourceId: dns.id
      publicNetworkAccess: 'Disabled'
    }
  }
  dependsOn: [link]
}
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'mnemba'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-runtime'
  location: location
}
resource pullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, 'AcrPull')
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30, workspaceCapping: { dailyQuotaGb: json('0.1') } }
}
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: { minimumTlsVersion: 'TLS1_2', allowBlobPublicAccess: false, supportsHttpsTrafficOnly: true, allowSharedKeyAccess: false }
}
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: { deleteRetentionPolicy: { enabled: true, days: 7 } }
}
resource backupContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'migration-backups'
  properties: { publicAccess: 'None' }
}
resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: '${prefix}-monthly'
  properties: {
    category: 'Cost'
    amount: 10
    timeGrain: 'Monthly'
    timePeriod: { startDate: budgetStart, endDate: '2027-09-15T00:00:00Z' }
    notifications: {
      actual50: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 50, thresholdType: 'Actual', contactEmails: [alertEmail] }
      actual100: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 100, thresholdType: 'Actual', contactEmails: [alertEmail] }
      forecast100: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 100, thresholdType: 'Forecasted', contactEmails: [alertEmail] }
    }
  }
}
resource environment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: '${prefix}-env'
  location: location
  properties: {
    appLogsConfiguration: { destination: 'log-analytics', logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey } }
    vnetConfiguration: { infrastructureSubnetId: '${vnet.id}/subnets/apps', internal: false }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    zoneRedundant: false
  }
}
var additionalSecrets = [for entry in items(appSecrets): { name: entry.key, value: entry.value }]
var connection = runtimeDatabaseUrl
var image = '${registry.properties.loginServer}/mnemba:${imageTag}'
var registryConfig = [{ server: registry.properties.loginServer, identity: identity.id }]
var variables = [
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'MNEMBA_DATABASE_SCHEMA', value: databaseSchema }
  { name: 'MNEMBA_SCHEMA_MANAGED', value: '1' }
  { name: 'MNEMBA_RUNTIME_MODE', value: 'azure' }
  { name: 'MNEMBA_ENABLE_UPDATES', value: enableUpdates ? '1' : '0' }
]
resource app 'Microsoft.App/containerApps@2025-01-01' = if (deployRuntime) {
  name: '${prefix}-web'
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: concat([{ name: 'database-url', value: connection }], additionalSecrets)
      registries: registryConfig
      ingress: { external: true, targetPort: 3000, transport: 'auto', allowInsecure: false }
    }
    template: {
      containers: [{
        name: 'web'
        image: image
        env: concat(variables, appSecretEnv)
        resources: { cpu: json('0.5'), memory: '1Gi' }
        probes: [
          { type: 'Startup', tcpSocket: { port: 3000 }, periodSeconds: 5, failureThreshold: 30 }
          { type: 'Liveness', tcpSocket: { port: 3000 }, periodSeconds: 30 }
          { type: 'Readiness', httpGet: { path: '/api/health', port: 3000 }, periodSeconds: 15, timeoutSeconds: 5 }
        ]
      }]
      scale: { minReplicas: 0, maxReplicas: 1, rules: [{ name: 'http', http: { metadata: { concurrentRequests: '20' } } }] }
    }
  }
  dependsOn: [pullRole, database]
}
var schedules = ['0 * * * *', '20 */3 * * *', '40 3 * * *']
resource jobs 'Microsoft.App/jobs@2025-01-01' = [for (cron, i) in schedules: if (deployRuntime) {
  name: '${prefix}-update-${i}'
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      // No schedules run during staging. Promote explicitly after quota handover.
      triggerType: enableUpdates ? 'Schedule' : 'Manual'
      scheduleTriggerConfig: enableUpdates ? { cronExpression: cron, parallelism: 1, replicaCompletionCount: 1 } : null
      manualTriggerConfig: enableUpdates ? null : { parallelism: 1, replicaCompletionCount: 1 }
      replicaTimeout: 300
      replicaRetryLimit: 0
      secrets: concat([{ name: 'database-url', value: connection }], additionalSecrets)
      registries: registryConfig
    }
    template: {
      containers: [{
        name: 'update'
        image: image
        command: ['node', 'scripts/azure/job.mjs']
        env: concat(variables, appSecretEnv, [{ name: 'MNEMBA_JOB_CRON', value: cron }])
        resources: { cpu: json('0.5'), memory: '1Gi' }
      }]
    }
  }
  dependsOn: [pullRole, database]
}]
output registryHost string = registry.properties.loginServer
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output environmentId string = environment.id
output runtimeIdentityId string = identity.id
output azureUrl string = deployRuntime ? 'https://${app!.properties.configuration.ingress.fqdn}' : ''
output apexIp string = environment.properties.staticIp
output domainVerificationId string = deployRuntime ? app!.properties.customDomainVerificationId : ''

output backupStorage string = storage.name
