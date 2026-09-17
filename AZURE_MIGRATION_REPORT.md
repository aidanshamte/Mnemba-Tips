# Azure migration — deployment in progress

The local and production D1 databases have been backed up outside the repository and to private Azure Blob Storage. Cloudflare remains unchanged and healthy. DNS is unchanged.

The reconciled snapshot contains 212,135 records across 68 tables, including 3,646 archived conflict versions. Its PostgreSQL import passed twice locally with full counts and content hashes. Existing regression tests, TypeScript, container build and desktop/mobile football/basketball browser journeys pass.

The Azure for Students subscription has $100 confirmed remaining credit, expiring 2027-09-15, with spending limit On. West US is allowed by policy. The private PostgreSQL B1ms server, Container Apps environment, private registry, protected backup storage, capped logs and $10 monthly budget alerts have been provisioned. The production import is running; no Azure data/site success is claimed until it finishes and is checked.

GitHub OIDC authentication is configured for aidanshamte/Mnemba-Tips main. The deployment workflow uses immutable action SHAs and requires no stored Azure client secret. Deployment role assignments will be limited to the individual web app and update jobs. GitHub API access is limited for Actions administration; publishing/execution will be checked separately.

Basketball model scenarios are restored at `/basketball`, explicitly labelled demo data. No live basketball feed is claimed.

The final verification report will replace this progress record after Azure checks. Full private evidence remains in `.sites-runtime/azure-migration/`; database exports and credentials are ignored by Git.
