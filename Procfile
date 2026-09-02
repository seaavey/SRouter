# Heroku process — single web dyno runs the unified API + dashboard server.
# DATABASE_URL (Postgres) is injected by the Heroku Postgres add-on; when unset
# the server falls back to the local SQLite database at DATABASE_PATH.
# Set SROUTER_PUBLIC_URL=https://<app>.herokuapp.com to expose OAuth callback
# routes on the main $PORT listener (Heroku only routes $PORT).
web: node apps/api/dist/index.js
