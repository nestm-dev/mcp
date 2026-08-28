---
"@nestm/mcp-auth": minor
---

Expose the synchronous guarded host policy from `@nestm/mcp-auth/cimd` so hosts can apply the SDK's
canonical scheme, host-allowlist, and address rules before performing durable work. Guarded fetch
leases now preserve the admission-time `allowQuery` policy instead of permitting query strings for
every admitted endpoint.
