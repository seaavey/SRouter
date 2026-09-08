import { Hono } from "hono";
import { AdminAuthStore } from "@srouter/db";
import { DatabaseController, MAX_DATABASE_UPLOAD_BYTES } from "@/controllers/database.controller.js";
import { CreateAdminAuthMiddleware, RequireAdmin } from "@/middleware/AdminAuth.js";
import { CreateBodyLimitMiddleware } from "@/middleware/BodyLimit.js";
import type { DatabaseTransferExportResult, DatabaseTransferImportResult, DatabaseTransferValidation } from "@srouter/db";

export interface DatabaseRouteOptions {
    store?: AdminAuthStore;
    exportDatabase?: (outputPath: string) => DatabaseTransferExportResult;
    validateDatabase?: (candidatePath: string) => DatabaseTransferValidation;
    replaceDatabase?: (candidatePath: string) => DatabaseTransferImportResult;
}

export function CreateDatabaseRouter(options: DatabaseRouteOptions = {}): Hono {
    const router = new Hono();
    const auth = options.store ? CreateAdminAuthMiddleware({ store: options.store }) : RequireAdmin;
    const controllerOptions = {
        exportDatabase: options.exportDatabase,
        validateDatabase: options.validateDatabase,
        replaceDatabase: options.replaceDatabase
    };

    router.use("/admin/database/*", auth);
    router.use("/admin/database/*", CreateBodyLimitMiddleware(MAX_DATABASE_UPLOAD_BYTES));
    router.get("/admin/database/export", (c) => DatabaseController.Export(c, controllerOptions));
    router.post("/admin/database/import", (c) => DatabaseController.Import(c, controllerOptions));
    return router;
}

export const DatabaseRouter = CreateDatabaseRouter();
