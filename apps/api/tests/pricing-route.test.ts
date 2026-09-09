import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { PricingRouter } from "../src/routes/v1/pricing.js";
import { PricingLogic } from "../src/logic/pricing.logic.js";
import type { PricingListResponse } from "@srouter/types";

test("GET /v1/pricing/models returns pricing catalog with caching header", async () => {
    const app = new Hono();
    app.route("/v1", PricingRouter);

    const res = await app.request("/v1/pricing/models");
    assert.equal(res.status, 200);

    const cacheHeader = res.headers.get("Cache-Control");
    assert.ok(cacheHeader?.includes("max-age=3600"));
    assert.ok(cacheHeader?.includes("stale-while-revalidate=86400"));

    const body = (await res.json()) as PricingListResponse;
    assert.equal(body.object, "list");
    assert.ok(body.total > 0);
    assert.equal(body.data.length, body.total);

    const pricedModel = body.data.find(
        (model) => typeof model.cost.input === "number" && typeof model.cost.output === "number"
    );
    assert.ok(pricedModel?.id);
    assert.ok(typeof pricedModel?.cost.input === "number");
    assert.ok(typeof pricedModel?.cost.output === "number");

    const unknownPriceModel = body.data.find(
        (model) => model.cost.input === undefined || model.cost.output === undefined
    );
    assert.ok(unknownPriceModel, "catalog should preserve unknown prices");
});

test("PricingLogic returns cached response on subsequent calls unless forceRefresh is true", () => {
    const res1 = PricingLogic.getPricingList(false);
    const res2 = PricingLogic.getPricingList(false);
    assert.equal(res1, res2);

    const res3 = PricingLogic.getPricingList(true);
    assert.equal(res3.object, "list");
    assert.ok(res3.total > 0);
});

test("PricingLogic preserves explicit free prices as zero", () => {
    const response = PricingLogic.getPricingList(false);
    const freeModel = response.data.find(
        (model) => model.cost.input === 0 && model.cost.output === 0
    );

    assert.ok(freeModel, "catalog should preserve explicit free prices");
});
