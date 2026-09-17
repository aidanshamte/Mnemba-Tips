# Namecheap DNS settings — verified Azure target

Azure HTTPS and desktop/mobile journeys passed before these records were proposed. No DNS changes have been made by this workspace. Current nameservers: `dns1.registrar-servers.com` and `dns2.registrar-servers.com`.

In Namecheap → Domain List → aidanshamte.me → Manage → Advanced DNS:

| Type | Host | Value | TTL |
|---|---|---|---|
| A | @ | 20.237.176.68 | Automatic |
| CNAME | www | mnemba-web.livelybush-738e4ce5.westus.azurecontainerapps.io | Automatic |
| TXT | asuid | 13B386CA0F885E9DEBCE66717EFEBBE06BDBF1082F56A16F3F3199CC223F19BA | Automatic |
| TXT | asuid.www | 13B386CA0F885E9DEBCE66717EFEBBE06BDBF1082F56A16F3F3199CC223F19BA | Automatic |

Replace the old GitHub Pages A records at @ and any conflicting www record. Preserve MX, SPF, DKIM and other unrelated records. If CAA records exist, verify they permit Azure's managed-certificate issuer before changing them.

After DNS resolves to Azure, bind both hostnames to `mnemba-web` and issue Azure-managed certificates for each. Do not upload the Namecheap certificate unless managed issuance proves unavailable. The Azure-generated certificate does not cover these custom hostnames. Until binding/issuance completes, custom-domain HTTPS is not verified.

The app redirects www to `https://aidanshamte.me` with a permanent redirect. Verify both hostnames, HTTP-to-HTTPS, football fixtures/search/matches/history/news/images, basketball scenarios and scheduler results after certificate issuance. Keep the Cloudflare Worker available until these checks pass.

Azure-generated URL: https://mnemba-web.livelybush-738e4ce5.westus.azurecontainerapps.io

Fallback: https://mnemba-tips.kaidan547.workers.dev

Rollback records observed before migration: apex GitHub Pages A values `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; inspect/export actual Namecheap records before editing, including the exact old www record. The previous apex HTTPS certificate failed hostname validation, so these records are historical evidence, not a verified healthy custom-domain fallback.

## Finding the Namecheap fields

Sign in at Namecheap, choose **Domain List** from the left sidebar, then **Manage** on the `aidanshamte.me` row. Select the **Advanced DNS** tab and find **Host Records**. Use **Add New Record**, choose the type from the dropdown, enter the Host and Value exactly as shown above, select Automatic TTL and click the save checkmark (or Save All Changes). Do not include `https://` in the CNAME value, and enter `asuid.www` rather than the full domain in the Host field. Keep the current Namecheap nameservers and mail-related records.

If Host Records is absent, inspect the **Domain** tab's Nameservers setting and the visible screen before changing anything. A cropped screenshot of just the domain tabs and DNS section is sufficient for further guidance; hide personal details. [Namecheap's illustrated instructions](https://www.namecheap.com/support/knowledgebase/article.aspx/9646/2237/how-to-create-a-cname-record-for-your-domain/) show these controls.

## Azure steps after DNS propagation

These commands are prepared, **not executed**. Both hostnames are currently unbound. After checking public A/CNAME/TXT answers, run:

```bash
az containerapp hostname add -g mnemba-azure -n mnemba-web --hostname aidanshamte.me
az containerapp hostname bind -g mnemba-azure -n mnemba-web --hostname aidanshamte.me --environment mnemba-env --validation-method HTTP
az containerapp hostname add -g mnemba-azure -n mnemba-web --hostname www.aidanshamte.me
az containerapp hostname bind -g mnemba-azure -n mnemba-web --hostname www.aidanshamte.me --environment mnemba-env --validation-method CNAME
```

Keep the app available during issuance and verify certificate state plus normal HTTPS requests to both hosts. No CAA records were returned by the September 17 DNS check. If CAA records are added later, Azure's managed certificate requires DigiCert authorization (`0 issue digicert.com`). See [Azure's managed-certificate requirements](https://learn.microsoft.com/en-us/azure/container-apps/custom-domains-managed-certificates).

Then run `node scripts/azure/verify-url.mjs https://aidanshamte.me`, repeat the browser journeys against the canonical domain, and verify `www` redirects to the apex with valid HTTPS on both hops. Preserve Cloudflare and its data pending final delta reconciliation and explicit retirement verification.
