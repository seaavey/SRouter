import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Hono } from "hono";
import { AdminAuthStore } from "../../../packages/db/src/adminAuth.js";
import { createAdminRoute } from "../src/routes/v1/admin.js";
import { hashAdminPassword } from "../src/services/adminAuth.js";

function createTestApp(options: { address?: string } = {}) {
    const store = new AdminAuthStore(new DatabaseSync(":memory:"));
    const app = new Hono();
    app.route(
        "/v1",
        createAdminRoute({
            store,
            getClientAddress: () => options.address,
            secureCookies: false
        })
    );
    return { app, store };
}

function getSessionCookie(response: Response): string {
    const cookie = response.headers.get("set-cookie")?.match(/srouter_admin_session=([^;]+)/)?.[1];
    assert.ok(cookie);
    return `srouter_admin_session=${cookie}`;
}

test("admin status reports setup and authentication state", async () => {
    const { app } = createTestApp();

    const initial = await app.request("/v1/admin/status");
    assert.equal(initial.status, 200);
    assert.deepEqual(await initial.json(), {
        setupRequired: true,
        authenticated: false
    });
});

test("local setup creates an account and establishes a session", async () => {
    const { app, store } = createTestApp({ address: "127.0.0.1" });

    const setup = await app.request("/v1/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            password: "correct horse battery staple",
            confirmation: "correct horse battery staple"
        })
    });

    assert.equal(setup.status, 201);
    assert.deepEqual(await setup.json(), { authenticated: true });
    assert.equal(store.hasAdminAccount(), true);

    const status = await app.request("/v1/admin/status", {
        headers: { Cookie: getSessionCookie(setup) }
    });
    assert.deepEqual(await status.json(), {
        setupRequired: false,
        authenticated: true
    });
});

test("remote setup is first-come-wins and closes after the first account", async () => {
    const { app } = createTestApp({ address: "192.168.1.10" });

    const first = await app.request("/v1/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            password: "correct horse battery staple",
            confirmation: "correct horse battery staple"
        })
    });
    assert.equal(first.status, 201);

    const second = await app.request("/v1/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            password: "another correct password",
            confirmation: "another correct password"
        })
    });
    assert.equal(second.status, 409);
});

test("login and logout manage the admin session", async () => {
    const { app, store } = createTestApp({ address: "127.0.0.1" });
    store.createAdminAccount(hashAdminPassword("correct horse battery staple"));

    const invalid = await app.request("/v1/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong password" })
    });
    assert.equal(invalid.status, 401);

    const login = await app.request("/v1/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "correct horse battery staple" })
    });
    assert.equal(login.status, 200);
    const cookie = getSessionCookie(login);

    const logout = await app.request("/v1/admin/logout", {
        method: "POST",
        headers: { Cookie: cookie }
    });
    assert.equal(logout.status, 204);

    const status = await app.request("/v1/admin/status", { headers: { Cookie: cookie } });
    assert.deepEqual(await status.json(), {
        setupRequired: false,
        authenticated: false
    });
});

test("repeated failed logins are throttled", async () => {
    const { app, store } = createTestApp({ address: "192.168.1.10" });
    store.createAdminAccount("invalid-password-hash");

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await app.request("/v1/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: "wrong password" })
        });
        assert.equal(response.status, 401);
    }

    const throttled = await app.request("/v1/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong password" })
    });
    assert.equal(throttled.status, 429);
});

test("change-password validates current password and updates admin account", async () => {
    const { app, store } = createTestApp({ address: "127.0.0.1" });
    store.createAdminAccount(hashAdminPassword("correct horse battery staple"));

    // Unauthorized request without session cookie
    const unauthenticated = await app.request("/v1/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            current_password: "correct horse battery staple",
            new_password: "new correct horse battery staple",
            confirmation: "new correct horse battery staple"
        })
    });
    assert.equal(unauthenticated.status, 401);

    // Login to get valid session
    const login = await app.request("/v1/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "correct horse battery staple" })
    });
    assert.equal(login.status, 200);
    const cookie = getSessionCookie(login);

    // Wrong current password
    const wrongCurrent = await app.request("/v1/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            current_password: "wrong password here",
            new_password: "new correct horse battery staple",
            confirmation: "new correct horse battery staple"
        })
    });
    assert.equal(wrongCurrent.status, 401);

    // Over-length password (> 128)
    const tooLong = await app.request("/v1/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            current_password: "correct horse battery staple",
            new_password: "a".repeat(129),
            confirmation: "a".repeat(129)
        })
    });
    assert.equal(tooLong.status, 400);

    // Mismatched confirmation
    const mismatch = await app.request("/v1/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            current_password: "correct horse battery staple",
            new_password: "new correct horse battery staple",
            confirmation: "different confirmation here"
        })
    });
    assert.equal(mismatch.status, 400);

    // Successful password change
    const successful = await app.request("/v1/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
            current_password: "correct horse battery staple",
            new_password: "new correct horse battery staple",
            confirmation: "new correct horse battery staple"
        })
    });
    assert.equal(successful.status, 200);

    // Old password should now fail login
    const oldLogin = await app.request("/v1/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "correct horse battery staple" })
    });
    assert.equal(oldLogin.status, 401);

    // New password should succeed
    const newLogin = await app.request("/v1/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "new correct horse battery staple" })
    });
    assert.equal(newLogin.status, 200);
});
