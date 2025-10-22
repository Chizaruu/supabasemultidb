/**
 * Supabase Studio Bridge
 *
 * This service acts as a compatibility layer between Supabase Studio
 * and any database adapter. Studio thinks it's talking to PostgreSQL,
 * but we route requests through our adapter layer.
 */

import express, { Request, Response } from "express";
import { DatabaseAdapter } from "../database-adapters/core/adapter";
import { RestAPIGenerator } from "../rest-api/rest-generator";

export interface StudioBridgeConfig {
    /** Database adapter to use */
    adapter: DatabaseAdapter;

    /** Port for the bridge service */
    port: number;

    /** Port where Supabase Studio expects PostgREST */
    postgrestPort?: number;

    /** Port where Supabase Studio expects realtime */
    realtimePort?: number;

    /** Port where Supabase Studio expects auth (GoTrue) */
    authPort?: number;

    /** Port where Supabase Studio expects storage */
    storagePort?: number;

    /** CORS origins to allow */
    allowedOrigins?: string[];
}

/**
 * Studio Bridge Service
 *
 * Implements all the endpoints that Supabase Studio expects,
 * but routes them through database adapters instead of PostgreSQL.
 */
export class StudioBridge {
    private adapter: DatabaseAdapter;
    private config: StudioBridgeConfig;
    private app: express.Application;
    private restAPI: RestAPIGenerator;

    constructor(config: StudioBridgeConfig) {
        this.adapter = config.adapter;
        this.config = config;
        this.app = express();

        // Setup middleware
        this.app.use(express.json());
        this.setupCORS();

        // Create REST API generator for data endpoints
        this.restAPI = new RestAPIGenerator({
            adapter: this.adapter,
            basePath: "/rest/v1",
            enableCors: true,
        });

        this.setupRoutes();
    }

    private setupCORS() {
        const origins = this.config.allowedOrigins || [
            "http://localhost:3000",
            "http://localhost:8000",
        ];

        this.app.use((req, res, next) => {
            const origin = req.headers.origin;
            if (origin && origins.includes(origin)) {
                res.header("Access-Control-Allow-Origin", origin);
            }
            res.header(
                "Access-Control-Allow-Methods",
                "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            );
            res.header(
                "Access-Control-Allow-Headers",
                "Content-Type, Authorization, apikey, Prefer"
            );
            res.header("Access-Control-Expose-Headers", "Content-Range");

            if (req.method === "OPTIONS") {
                return res.sendStatus(200);
            }
            return next();
        });
    }

    private setupRoutes() {
        // 1. PostgREST endpoints (data access)
        this.app.use("/rest/v1", this.restAPI.getApp());

        // 2. Meta endpoints (Studio uses these for introspection)
        this.app.get("/rest/v1/", this.handleRootEndpoint.bind(this));

        // 3. Database metadata endpoints (Studio uses these)
        this.app.get("/pg/meta/schemas", this.handleGetSchemas.bind(this));
        this.app.get("/pg/meta/tables", this.handleGetTables.bind(this));
        this.app.get("/pg/meta/columns", this.handleGetColumns.bind(this));
        this.app.get("/pg/meta/functions", this.handleGetFunctions.bind(this));
        this.app.get("/pg/meta/policies", this.handleGetPolicies.bind(this));
        this.app.post("/pg/meta/policies", this.handleCreatePolicy.bind(this));
        this.app.delete(
            "/pg/meta/policies/:id",
            this.handleDeletePolicy.bind(this)
        );

        // 4. SQL query endpoint (Table Editor uses this)
        this.app.post("/pg/query", this.handleQuery.bind(this));

        // 5. Health check
        this.app.get("/health", this.handleHealthCheck.bind(this));

        // 6. Database info (for Studio header)
        this.app.get("/pg/config", this.handleGetConfig.bind(this));
    }

    /**
     * Root endpoint - OpenAPI spec
     */
    private async handleRootEndpoint(
        req: Request,
        res: Response
    ): Promise<void> {
        try {
            const schema = await this.adapter.getSchema();

            // Return OpenAPI-like spec that Studio can understand
            const openApiSchema = {
                swagger: "2.0",
                info: {
                    title: `${this.adapter.provider} API`,
                    description: `Auto-generated API via Supabase Multi-DB`,
                    version: "1.0.0",
                },
                host: req.get("host"),
                basePath: "/rest/v1",
                schemes: ["http", "https"],
                definitions: this.generateDefinitions(schema.tables),
                paths: this.generatePaths(schema.tables),
            };

            res.json(openApiSchema);
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    }

    /**
     * Get all schemas
     */
    private async handleGetSchemas(
        _req: Request,
        res: Response
    ): Promise<void> {
        try {
            const schema = await this.adapter.getSchema();

            // Format for Studio
            const schemas = schema.schemas.map((name) => ({
                id: name,
                name: name,
                owner: "postgres", // Studio expects this
            }));

            res.json(schemas);
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    }

    /**
     * Get all tables
     */
    private async handleGetTables(req: Request, res: Response): Promise<void> {
        try {
            const schemaName = (req.query.schema as string) || "public";
            const tables = await this.adapter.getTables(schemaName);

            // Format for Studio
            const studioTables = tables.map((table) => ({
                id: `${table.schema}.${table.name}`,
                schema: table.schema,
                name: table.name,
                rls_enabled: false, // TODO: Check if security is enabled
                rls_forced: false,
                replica_identity: "DEFAULT",
                bytes: 0,
                size: "0 bytes",
                live_rows_estimate: 0,
                dead_rows_estimate: 0,
                comment: null,
            }));

            res.json(studioTables);
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    }

    /**
     * Get columns for tables
     */
    private async handleGetColumns(req: Request, res: Response): Promise<void> {
        try {
            const schemaName = (req.query.schema as string) || "public";
            const tableName = req.query.table as string;

            if (!tableName) {
                res.status(400).json({ error: "table parameter required" });
                return;
            }

            const columns = await this.adapter.getColumns(
                tableName,
                schemaName
            );

            // Format for Studio
            const studioColumns = columns.map((col, index) => ({
                table_id: `${schemaName}.${tableName}`,
                schema: schemaName,
                table: tableName,
                id: `${schemaName}.${tableName}.${col.name}`,
                ordinal_position: index + 1,
                name: col.name,
                default_value: col.defaultValue,
                data_type: col.dataType.toLowerCase(),
                format: this.mapDataTypeFormat(col.dataType),
                is_identity: col.isIdentity,
                identity_generation: col.isIdentity ? "BY DEFAULT" : null,
                is_nullable: col.nullable,
                is_updatable: !col.isIdentity,
                is_unique: false, // TODO: Check indexes
                enums: [],
                comment: null,
            }));

            res.json(studioColumns);
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    }

    /**
     * Get functions/stored procedures
     */
    private async handleGetFunctions(
        req: Request,
        res: Response
    ): Promise<void> {
        try {
            const schemaName = (req.query.schema as string) || "public";
            const functions = await this.adapter.getFunctions(schemaName);

            // Format for Studio
            const studioFunctions = functions.map((func) => ({
                id: `${func.schema}.${func.name}`,
                schema: func.schema,
                name: func.name,
                language: func.language,
                definition: func.definition,
                return_type: func.returnType,
                args: func.parameters.map((p) => ({
                    name: p.name,
                    type: p.dataType,
                    mode: p.mode,
                })),
            }));

            res.json(studioFunctions);
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    }

    /**
     * Get RLS policies
     */
    private async handleGetPolicies(
        req: Request,
        res: Response
    ): Promise<void> {
        try {
            const schemaName = (req.query.schema as string) || "public";
            const tableName = req.query.table as string;

            if (!tableName) {
                res.status(400).json({ error: "table parameter required" });
                return;
            }

            const policies = await this.adapter.getSecurityPolicies(
                tableName,
                schemaName
            );

            // Format for Studio
            const studioPolicies = policies.map((policy) => ({
                id: policy.name,
                schema: schemaName,
                table: tableName,
                name: policy.name,
                action: policy.operation.toLowerCase(),
                roles: [policy.role || "public"],
                command: policy.operation,
                definition: policy.using,
                check: policy.withCheck,
            }));

            res.json(studioPolicies);
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    }

    /**
     * Create RLS policy
     */
    private async handleCreatePolicy(
        req: Request,
        res: Response
    ): Promise<void> {
        try {
            const {
                schema: _schema,
                table,
                name,
                action,
                definition,
                check,
                roles,
            } = req.body;

            // Note: _schema parameter reserved for future schema-aware operations
            await this.adapter.applySecurityPolicy({
                name,
                table,
                operation: action.toUpperCase(),
                using: definition,
                withCheck: check,
                role: roles?.[0],
            });

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    }

    /**
     * Delete RLS policy
     */
    private async handleDeletePolicy(
        req: Request,
        res: Response
    ): Promise<void> {
        try {
            const policyId = req.params.id;
            const [_schema, table, ...nameParts] = policyId.split(".");
            const policyName = nameParts.join(".");

            await this.adapter.removeSecurityPolicy(policyName, table);

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    }

    /**
     * Execute SQL query (for Table Editor)
     */
    private async handleQuery(req: Request, res: Response): Promise<void> {
        try {
            const { query, params } = req.body;

            const result = await this.adapter.query(query, params);

            res.json({
                rows: result.rows,
                rowCount: result.rowCount,
                fields: result.fields,
            });
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    }

    /**
     * Health check
     */
    private async handleHealthCheck(
        _req: Request,
        res: Response
    ): Promise<void> {
        try {
            const healthy = await this.adapter.healthCheck();
            res.json({
                status: healthy ? "healthy" : "unhealthy",
                database: this.adapter.provider,
            });
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    }

    /**
     * Database configuration (for Studio header)
     */
    private async handleGetConfig(_req: Request, res: Response): Promise<void> {
        try {
            const stats = await this.adapter.getStats();

            res.json({
                db_name: this.config.adapter.provider,
                db_version: "1.0.0",
                max_connections: this.adapter.capabilities.maxConnections,
                current_connections: stats.connections,
                capabilities: this.adapter.capabilities,
            });
        } catch (error) {
            res.status(500).json({ error: (error as Error).message });
        }
    }

    /**
     * Generate OpenAPI definitions from tables
     */
    private generateDefinitions(tables: any[]): any {
        const definitions: any = {};

        for (const table of tables) {
            const properties: any = {};

            for (const col of table.columns) {
                properties[col.name] = {
                    type: this.mapDataTypeToJSON(col.dataType),
                    format: this.mapDataTypeFormat(col.dataType),
                };
            }

            definitions[table.name] = {
                type: "object",
                properties,
            };
        }

        return definitions;
    }

    /**
     * Generate OpenAPI paths from tables
     */
    private generatePaths(tables: any[]): any {
        const paths: any = {};

        for (const table of tables) {
            paths[`/${table.name}`] = {
                get: {
                    summary: `List ${table.name}`,
                    responses: { 200: { description: "Success" } },
                },
                post: {
                    summary: `Create ${table.name}`,
                    responses: { 201: { description: "Created" } },
                },
            };
        }

        return paths;
    }

    /**
     * Map database types to JSON types
     */
    private mapDataTypeToJSON(dataType: string): string {
        const type = dataType.toLowerCase();

        if (type.includes("int") || type.includes("serial")) return "integer";
        if (
            type.includes("numeric") ||
            type.includes("decimal") ||
            type.includes("float")
        )
            return "number";
        if (type.includes("bool") || type.includes("bit")) return "boolean";
        if (type.includes("json")) return "object";
        if (type.includes("array")) return "array";

        return "string";
    }

    /**
     * Map database types to OpenAPI formats
     */
    private mapDataTypeFormat(dataType: string): string | undefined {
        const type = dataType.toLowerCase();

        if (type.includes("timestamp")) return "date-time";
        if (type.includes("date")) return "date";
        if (type.includes("time")) return "time";
        if (type.includes("uuid")) return "uuid";
        if (type === "bigint") return "int64";
        if (type === "integer" || type === "int") return "int32";

        return undefined;
    }

    /**
     * Start the bridge service
     */
    listen(callback?: () => void) {
        return this.app.listen(this.config.port, () => {
            console.log(`\n🌉 Supabase Studio Bridge running!`);
            console.log(`   Database: ${this.adapter.provider}`);
            console.log(
                `   REST API: http://localhost:${this.config.port}/rest/v1`
            );
            console.log(
                `   Meta API: http://localhost:${this.config.port}/pg/meta`
            );

            // Display configured ports for full Supabase stack
            console.log(`\n🔌 Configured Ports:`);
            console.log(`   Studio Bridge: ${this.config.port}`);
            if (this.config.postgrestPort) {
                console.log(`   PostgREST: ${this.config.postgrestPort}`);
            }
            if (this.config.realtimePort) {
                console.log(`   Realtime: ${this.config.realtimePort}`);
            }
            if (this.config.authPort) {
                console.log(`   Auth (GoTrue): ${this.config.authPort}`);
            }
            if (this.config.storagePort) {
                console.log(`   Storage: ${this.config.storagePort}`);
            }

            console.log(`\n📊 Configure Supabase Studio to use:`);
            console.log(`   SUPABASE_URL=http://localhost:${this.config.port}`);
            console.log(`   SUPABASE_ANON_KEY=your-anon-key\n`);

            if (callback) callback();
        });
    }

    /**
     * Get Express app (for testing)
     */
    getApp(): express.Application {
        return this.app;
    }

    /**
     * Get all configured ports for the Supabase stack
     */
    getPortConfiguration(): {
        bridge: number;
        postgrest?: number;
        realtime?: number;
        auth?: number;
        storage?: number;
    } {
        return {
            bridge: this.config.port,
            postgrest: this.config.postgrestPort,
            realtime: this.config.realtimePort,
            auth: this.config.authPort,
            storage: this.config.storagePort,
        };
    }
}

/**
 * Quick start helper
 */
export async function createStudioBridge(
    adapter: DatabaseAdapter,
    port: number = 54321
) {
    const bridge = new StudioBridge({
        adapter,
        port,
    });

    return bridge;
}
