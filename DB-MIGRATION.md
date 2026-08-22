# Database Migration Guide

## Overview

Starting from this version, SRouter now stores the SQLite database in your home directory by default (`~/.srouter/srouter.db`) instead of in the project root. This change provides:

- **Cleaner project structure** - no database files cluttering your codebase
- **Easier backups** - all SRouter data in one location
- **Docker-friendly** - cleaner separation between code and data
- **Multi-project support** - multiple SRouter instances without conflicts

## Default Locations

### New Default (Current Version)

```
~/srouter/srouter.db
```

### Legacy Locations (Still Supported)

```
apps/api/srouter.db  # Within project root
srouter.db           # Project root
```

## Automatic Migration Behavior

✅ **No manual migration needed!** SRouter automatically detects existing databases and continues using them.

- If you have an existing database at `apps/api/srouter.db` or `srouter.db`, SRouter will keep using it
- Fresh installations will use the new `~/.srouter/srouter.db` location
- You can manually override with `DATABASE_PATH` environment variable anytime

## Manual Migration (Optional)

If you want to move your existing database to the new location, use the built-in CLI command:

```bash
srouter migrate db
```

This detects databases at legacy locations (`apps/api/srouter.db` or `srouter.db`), backs them up to `~/.srouter/backups/`, and copies them to `~/.srouter/srouter.db`.

### Migrating from 9Router

To import providers and settings from an existing 9Router database:

```bash
# Auto-detect common 9Router locations
srouter migrate 9router

# Or specify the database path explicitly
srouter migrate 9router --source /path/to/9router.db
```

The importer backs up both databases before making changes and lets you choose between replacing or merging with existing SRouter data.

<details>
<summary>Manual steps (alternative to the CLI)</summary>

### Step 1: Stop SRouter

```bash
# Kill running SRouter processes
pkill -f "node.*srouter"
```

### Step 2: Copy Database File

```bash
# From legacy location
cp apps/api/srouter.db ~/.srouter/

# Or if in project root
cp srouter.db ~/.srouter/
```

### Step 3: Create Directory & Set Permissions

```bash
mkdir -p ~/.srouter
chmod 700 ~/.srouter
chmod 600 ~/.srouter/srouter.db
```

### Step 4: Update Environment

Create `.env` file in project root:

```bash
echo 'DATABASE_PATH=~/.srouter/srouter.db' >> .env
```

</details>

### Restart SRouter

```bash
pnpm dev
```

## Docker Deployment

For Docker deployments, explicitly set the DATABASE_PATH:

```yaml
# docker-compose.yml
services:
    srouter:
        image: ghcr.io/seaavey/srouter:latest
        environment:
            - DATABASE_PATH=/app/data/srouter.db
        volumes:
            - srouter_data:/app/data

volumes:
    srouter_data:
```

## Backup Recommendations

Since the database is now in a predictable location, you can easily back it up:

```bash
# Daily backup script
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=~/.srouter/backups
mkdir -p $BACKUP_DIR
cp ~/.srouter/srouter.db $BACKUP_DIR/srouter_$TIMESTAMP.db
# Optional: compress old backups
find $BACKUP_DIR -name "*.db" -mtime +7 -exec gzip {} \;
```

## Troubleshooting

### "Database not found" Error

If you get errors about missing database:

1. Check if directory exists:

    ```bash
    ls -la ~/.srouter/
    ```

2. Create directory if needed:

    ```bash
    mkdir -p ~/.srouter
    chmod 700 ~/.srouter
    ```

3. Verify environment variable:
    ```bash
    echo $DATABASE_PATH
    ```

### Permission Issues

If you see permission denied errors:

```bash
# Fix permissions
chmod 700 ~/.srouter
chmod 600 ~/.srouter/srouter.db
chown $USER:$USER ~/.srouter/srouter.db
```

### Want to Use Different Location?

Just set `DATABASE_PATH` in your `.env`:

```bash
DATABASE_PATH=/custom/path/to/srouter.db
```

Or for Docker:

```bash
docker run -e DATABASE_PATH=/mnt/data/srouter.db ...
```

---

**Note:** The automatic legacy detection ensures smooth transition. Existing installations won't be affected unless you explicitly choose to migrate.
