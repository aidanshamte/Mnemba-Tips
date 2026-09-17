param location string = resourceGroup().location
param environmentId string
param identityId string
param registryHost string
param imageTag string
@secure()
param databaseUrl string
@secure()
param snapshotUrl string
@secure()
param runtimePassword string
param snapshotSha256 string
param databaseSchema string = 'production_snapshot'
resource job 'Microsoft.App/jobs@2025-01-01' = {
  name: 'mnemba-import'
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identityId}': {} } }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 3600
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: [{ server: registryHost, identity: identityId }]
      secrets: [
        { name: 'database-url', value: databaseUrl }
        { name: 'snapshot-url', value: snapshotUrl }
        { name: 'runtime-password', value: runtimePassword }
      ]
    }
    template: {
      containers: [{
        name: 'import'
        image: '${registryHost}/mnemba:${imageTag}'
        command: ['node', 'scripts/azure/import-job.mjs']
        env: [
          { name: 'DATABASE_URL', secretRef: 'database-url' }
          { name: 'MNEMBA_SNAPSHOT_URL', secretRef: 'snapshot-url' }
          { name: 'MNEMBA_RUNTIME_PASSWORD', secretRef: 'runtime-password' }
          { name: 'MNEMBA_SNAPSHOT_SHA256', value: snapshotSha256 }
          { name: 'MNEMBA_DATABASE_SCHEMA', value: databaseSchema }
        ]
        resources: { cpu: 1, memory: '2Gi' }
      }]
    }
  }
}
