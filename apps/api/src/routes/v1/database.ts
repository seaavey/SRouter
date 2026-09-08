import { Hono } from "hono";
import type { DatabaseTransferExportResult, DatabaseTransferImportResult, DatabaseTransferValidation } from "@srouter/db";
import { DatabaseController, MAX_DATABASE_UPLOAD_BYTES } from "@/controllers/database.controller.js";
import { RequireAdmin } from "@/middleware/AdminAuth.js";
import { Err } from "@/utils/response.js";

export interface DatabaseRouteOptions {
    exportDatabase?: (outputPath: string) => DatabaseTransferExportResult;
    validateDatabase?: (candidatePath: string) => DatabaseTransferValidation;
    replaceDatabase?: (candidatePath: string) => DatabaseTransferImportResult;
}

export function CreateDatabaseRouter(options: DatabaseRouteOptions = {}): Hono {
    const router = new Hono();
    const controllerOptions = {
        exportDatabase: options.exportDatabase,
        validateDatabase: options.validateDatabase,
        replaceDatabase: options.replaceDatabase
    };

    router.use("/admin/database/*", RequireAdmin);
    router.use("/admin/database/*", async (c, next) => {
        const contentLength = c.req.header("content-length");
        const length = Number(contentLength);
        if (contentLength && Number.isFinite(length) && length > MAX_DATABASE_UPLOAD_BYTES) {
            return Err(c, "The database upload is too large.", 400, { code: "upload_too_large" });
        }
        return next();
    });
    router.get("/admin/database/export", (c) => DatabaseController.Export(c, controllerOptions));
    router.post("/admin/database/import", (c) => DatabaseController.Import(c, controllerOptions));
    return router;
}

export const DatabaseRouter = CreateDatabaseRouter();
