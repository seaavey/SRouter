import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isKnownProvider, providerById, BAI_PROVIDER } from "@srouter/constants";

describe("BAI Provider Constants", () => {
    it("is registered as a known provider", () => {
        assert.equal(isKnownProvider("bai"), true);
        assert.equal(providerById("bai")?.name, "B.AI");
        assert.equal(BAI_PROVIDER.base_url, "https://api.b.ai/v1");
        assert.equal(BAI_PROVIDER.category, "free_tier");
        assert.equal(BAI_PROVIDER.protocol, "openai");
    });
});
