module.exports = {
    apps: [
        {
            name: "srouter",
            script: "apps/api/dist/index.js",
            cwd: "/root/workspace/SRouter",
            node_args: "--enable-source-maps",
            env: {
                NODE_ENV: "production",
                PORT: "3005",
                SROUTER_PUBLIC_URL: "https://srouter.rkhyg.xyz",
                SROUTER_CORS_ORIGINS: "https://srouter.rkhyg.xyz",
                DATABASE_PATH: "/root/.srouter/srouter.db",
                WEB_DIST_PATH: "/root/workspace/SRouter/apps/web/dist"
            },
            max_memory_restart: "1G",
            restart_delay: 2000,
            exp_backoff_restart_delay: 100
        }
    ]
};
