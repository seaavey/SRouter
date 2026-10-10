-- SRouter schema v4: remove the Cloudflare Tunnel settings keys.
--
-- Owner ruling 2026-10-08: the tunnel feature is removed from the product.
-- The Node service that read and wrote these keys is being deleted, so the
-- rows are inert state with no reader. Applied by
-- src/infrastructure/database/migrations.rs inside the same transaction as
-- the rest of the schema run, which then records PRAGMA user_version = 4.
--
-- This is the only data statement in the migration set: it deletes exactly
-- these four keys and touches no other settings row.

DELETE FROM settings
WHERE key IN (
    'cloudflare_tunnel_token',
    'cloudflare_tunnel_domain',
    'cloudflare_tunnel_autostart',
    'cloudflared_path'
);
