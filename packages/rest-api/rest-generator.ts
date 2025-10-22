/**
 * Universal REST API Generator
 *
 * Database-agnostic REST API layer that replaces PostgREST.
 * Works with any DatabaseAdapter implementation.
 */

import express, { Request, Response, NextFunction } from "express";
import { DatabaseAdapter, ColumnInfo } from "../database-adapters/core/adapter";

export interface RestAPIConfig {
    /** Database adapter instance */
    adapter: DatabaseAdapter;

    /** Base path for API routes (default: '/api') */
    basePath?: string;

    /** Enable CORS */
    enableCors?: boolean;

    /** Maximum rows per request */
    maxRows?: number;

    /** Authentication middleware */
    authMiddleware?: (req: Request, res: Response, next: NextFunction) => void;

    /** Custom error handler */
    errorHandler?: (error: Error, req: Request, res: Response) => void;
}

interface QueryFilters {
    select?: string[];
    where?: WhereClause[];
    order?: OrderClause[];
    limit?: number;
    offset?: number;
}

interface WhereClause {
    column: string;
    operator: string;
    value: any;
}

interface OrderClause {
    column: string;
    direction: "ASC" | "DESC";
}

/**
 * REST API Generator
 *
 * Generates REST endpoints for database tables automatically
 * based on introspection of the database schema.
 */
export class RestAPIGenerator {
    private adapter: DatabaseAdapter;
    private app: express.Application;
    private basePath: string;
    private maxRows: number;

    constructor(config: RestAPIConfig) {
        this.adapter = config.adapter;
        this.basePath = config.basePath || "/api";
        this.maxRows = config.maxRows || 1000;
        this.app = express();

        this.app.use(express.json());

        if (config.enableCors) {
            this.app.use((req, res, next) => {
                res.header("Access-Control-Allow-Origin", "*");
                res.header(
                    "Access-Control-Allow-Methods",
                    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
                );
                res.header(
                    "Access-Control-Allow-Headers",
                    "Content-Type, Authorization"
                );
                if (req.method === "OPTIONS") {
                    res.sendStatus(200);
                    return;
                }
                next();
            });
        }

        if (config.authMiddleware) {
            this.app.use(config.authMiddleware);
        }

        this.setupRoutes();

        if (config.errorHandler) {
            this.app.use(
                (
                    err: Error,
                    req: Request,
                    res: Response,
                    _next: NextFunction
                ) => {
                    config.errorHandler!(err, req, res);
                }
            );
        } else {
            this.app.use(this.defaultErrorHandler.bind(this));
        }
    }

    private setupRoutes() {
        // OpenAPI schema endpoint
        this.app.get(
            `${this.basePath}/schema`,
            this.getOpenAPISchema.bind(this)
        );

        // Health check
        this.app.get(`${this.basePath}/health`, this.healthCheck.bind(this));

        // Dynamic table routes
        this.app.get(`${this.basePath}/:table`, this.handleSelect.bind(this));
        this.app.post(`${this.basePath}/:table`, this.handleInsert.bind(this));
        this.app.patch(`${this.basePath}/:table`, this.handleUpdate.bind(this));
        this.app.delete(
            `${this.basePath}/:table`,
            this.handleDelete.bind(this)
        );

        // Single row operations (by primary key)
        this.app.get(
            `${this.basePath}/:table/:id`,
            this.handleSelectOne.bind(this)
        );
        this.app.put(
            `${this.basePath}/:table/:id`,
            this.handleUpdateOne.bind(this)
        );
        this.app.delete(
            `${this.basePath}/:table/:id`,
            this.handleDeleteOne.bind(this)
        );
    }

    /**
     * Handle SELECT requests with filtering, sorting, pagination
     */
    private async handleSelect(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        try {
            const { table } = req.params;
            const filters = this.parseQueryFilters(req.query);

            // Build SQL query
            const sql = this.buildSelectQuery(table, filters);

            // Execute query
            const result = await this.adapter.query(sql.query, sql.params);

            // Return results with metadata
            res.json({
                data: result.rows,
                count: result.rowCount,
                total: await this.getTableCount(table, filters.where),
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Handle SELECT single row by ID
     */
    private async handleSelectOne(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        try {
            const { table, id } = req.params;

            // Get primary key column
            const tableInfo = await this.adapter.getTable(table);
            const pkColumn = tableInfo.primaryKeys[0];

            if (!pkColumn) {
                res.status(400).json({ error: "Table has no primary key" });
                return;
            }

            // Build query
            const sql = `SELECT * FROM ${this.adapter.escapeIdentifier(
                table
            )} WHERE ${this.adapter.escapeIdentifier(
                pkColumn
            )} = ${this.getParamPlaceholder(0)}`;

            const result = await this.adapter.queryOne(sql, [id]);

            if (!result) {
                res.status(404).json({ error: "Record not found" });
                return;
            }

            res.json({ data: result });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Handle INSERT requests
     */
    private async handleInsert(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        try {
            const { table } = req.params;
            const data = req.body;

            if (Array.isArray(data)) {
                // Bulk insert
                const results = [];
                for (const row of data) {
                    const result = await this.insertRow(table, row);
                    results.push(result);
                }
                res.status(201).json({ data: results, count: results.length });
                return;
            } else {
                // Single insert
                const result = await this.insertRow(table, data);
                res.status(201).json({ data: result });
                return;
            }
        } catch (error) {
            next(error);
        }
    }

    private async insertRow(table: string, data: Record<string, any>) {
        const columns = Object.keys(data);
        const values = Object.values(data);

        const columnList = columns
            .map((c) => this.adapter.escapeIdentifier(c))
            .join(", ");
        const valuePlaceholders = values
            .map((_, i) => this.getParamPlaceholder(i))
            .join(", ");

        let sql: string;

        // Handle RETURNING clause (PostgreSQL) vs OUTPUT clause (SQL Server)
        if (this.adapter.dialect === "postgresql") {
            sql = `INSERT INTO ${this.adapter.escapeIdentifier(
                table
            )} (${columnList}) VALUES (${valuePlaceholders}) RETURNING *`;
        } else if (this.adapter.dialect === "tsql") {
            sql = `INSERT INTO ${this.adapter.escapeIdentifier(
                table
            )} (${columnList}) OUTPUT INSERTED.* VALUES (${valuePlaceholders})`;
        } else {
            sql = `INSERT INTO ${this.adapter.escapeIdentifier(
                table
            )} (${columnList}) VALUES (${valuePlaceholders})`;
        }

        const result = await this.adapter.query(sql, values);
        return result.rows[0] || data;
    }

    /**
     * Handle UPDATE requests (batch update with WHERE clause)
     */
    private async handleUpdate(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        try {
            const { table } = req.params;
            const data = req.body;
            const filters = this.parseQueryFilters(req.query);

            if (!filters.where || filters.where.length === 0) {
                res.status(400).json({
                    error: "WHERE clause required for batch updates",
                });
                return;
            }

            const sql = this.buildUpdateQuery(table, data, filters.where);
            const result = await this.adapter.query(sql.query, sql.params);

            res.json({ count: result.rowCount });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Handle UPDATE single row by ID
     */
    private async handleUpdateOne(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        try {
            const { table, id } = req.params;
            const data = req.body;

            const tableInfo = await this.adapter.getTable(table);
            const pkColumn = tableInfo.primaryKeys[0];

            if (!pkColumn) {
                res.status(400).json({ error: "Table has no primary key" });
                return;
            }

            const setClauses = Object.keys(data)
                .map(
                    (key, i) =>
                        `${this.adapter.escapeIdentifier(
                            key
                        )} = ${this.getParamPlaceholder(i)}`
                )
                .join(", ");

            const values = Object.values(data);
            values.push(id);

            let sql: string;

            if (this.adapter.dialect === "postgresql") {
                sql = `UPDATE ${this.adapter.escapeIdentifier(
                    table
                )} SET ${setClauses} WHERE ${this.adapter.escapeIdentifier(
                    pkColumn
                )} = ${this.getParamPlaceholder(
                    values.length - 1
                )} RETURNING *`;
            } else if (this.adapter.dialect === "tsql") {
                sql = `UPDATE ${this.adapter.escapeIdentifier(
                    table
                )} SET ${setClauses} OUTPUT INSERTED.* WHERE ${this.adapter.escapeIdentifier(
                    pkColumn
                )} = ${this.getParamPlaceholder(values.length - 1)}`;
            } else {
                sql = `UPDATE ${this.adapter.escapeIdentifier(
                    table
                )} SET ${setClauses} WHERE ${this.adapter.escapeIdentifier(
                    pkColumn
                )} = ${this.getParamPlaceholder(values.length - 1)}`;
            }

            const result = await this.adapter.query(sql, values);

            if (result.rowCount === 0) {
                res.status(404).json({ error: "Record not found" });
                return;
            }

            res.json({ data: result.rows[0] || { ...data, [pkColumn]: id } });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Handle DELETE requests (batch delete with WHERE clause)
     */
    private async handleDelete(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        try {
            const { table } = req.params;
            const filters = this.parseQueryFilters(req.query);

            if (!filters.where || filters.where.length === 0) {
                res.status(400).json({
                    error: "WHERE clause required for batch deletes",
                });
                return;
            }

            const whereClause = this.buildWhereClause(filters.where);
            const sql = `DELETE FROM ${this.adapter.escapeIdentifier(
                table
            )} WHERE ${whereClause.clause}`;

            const result = await this.adapter.query(sql, whereClause.params);

            res.json({ count: result.rowCount });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Handle DELETE single row by ID
     */
    private async handleDeleteOne(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        try {
            const { table, id } = req.params;

            const tableInfo = await this.adapter.getTable(table);
            const pkColumn = tableInfo.primaryKeys[0];

            if (!pkColumn) {
                res.status(400).json({ error: "Table has no primary key" });
                return;
            }

            const sql = `DELETE FROM ${this.adapter.escapeIdentifier(
                table
            )} WHERE ${this.adapter.escapeIdentifier(
                pkColumn
            )} = ${this.getParamPlaceholder(0)}`;
            const result = await this.adapter.query(sql, [id]);

            if (result.rowCount === 0) {
                res.status(404).json({ error: "Record not found" });
                return;
            }

            res.json({ count: result.rowCount });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Build SELECT query from filters
     */
    private buildSelectQuery(
        table: string,
        filters: QueryFilters
    ): { query: string; params: any[] } {
        let sql = `SELECT `;

        // SELECT clause
        if (filters.select && filters.select.length > 0) {
            sql += filters.select
                .map((c) => this.adapter.escapeIdentifier(c))
                .join(", ");
        } else {
            sql += "*";
        }

        sql += ` FROM ${this.adapter.escapeIdentifier(table)}`;

        const params: any[] = [];

        // WHERE clause
        if (filters.where && filters.where.length > 0) {
            const whereClause = this.buildWhereClause(filters.where);
            sql += ` WHERE ${whereClause.clause}`;
            params.push(...whereClause.params);
        }

        // ORDER BY clause
        if (filters.order && filters.order.length > 0) {
            const orderClauses = filters.order
                .map(
                    (o) =>
                        `${this.adapter.escapeIdentifier(o.column)} ${
                            o.direction
                        }`
                )
                .join(", ");
            sql += ` ORDER BY ${orderClauses}`;
        }

        // LIMIT/OFFSET
        const limit = Math.min(filters.limit || this.maxRows, this.maxRows);
        const offset = filters.offset || 0;

        if (this.adapter.dialect === "postgresql") {
            sql += ` LIMIT ${limit} OFFSET ${offset}`;
        } else if (this.adapter.dialect === "tsql") {
            if (!filters.order || filters.order.length === 0) {
                sql += ` ORDER BY (SELECT NULL)`; // SQL Server requires ORDER BY for OFFSET
            }
            sql += ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
        }

        return { query: sql, params };
    }

    /**
     * Build UPDATE query
     */
    private buildUpdateQuery(
        table: string,
        data: Record<string, any>,
        whereFilters: WhereClause[]
    ): { query: string; params: any[] } {
        const setClauses = Object.keys(data)
            .map(
                (key, i) =>
                    `${this.adapter.escapeIdentifier(
                        key
                    )} = ${this.getParamPlaceholder(i)}`
            )
            .join(", ");

        const params = Object.values(data);

        const whereClause = this.buildWhereClause(whereFilters, params.length);
        params.push(...whereClause.params);

        const sql = `UPDATE ${this.adapter.escapeIdentifier(
            table
        )} SET ${setClauses} WHERE ${whereClause.clause}`;

        return { query: sql, params };
    }

    /**
     * Build WHERE clause from filters
     */
    private buildWhereClause(
        filters: WhereClause[],
        paramOffset: number = 0
    ): { clause: string; params: any[] } {
        const clauses: string[] = [];
        const params: any[] = [];

        for (const filter of filters) {
            const column = this.adapter.escapeIdentifier(filter.column);
            const paramIdx = paramOffset + params.length;

            switch (filter.operator.toLowerCase()) {
                case "eq":
                    clauses.push(
                        `${column} = ${this.getParamPlaceholder(paramIdx)}`
                    );
                    params.push(filter.value);
                    break;
                case "neq":
                    clauses.push(
                        `${column} != ${this.getParamPlaceholder(paramIdx)}`
                    );
                    params.push(filter.value);
                    break;
                case "gt":
                    clauses.push(
                        `${column} > ${this.getParamPlaceholder(paramIdx)}`
                    );
                    params.push(filter.value);
                    break;
                case "gte":
                    clauses.push(
                        `${column} >= ${this.getParamPlaceholder(paramIdx)}`
                    );
                    params.push(filter.value);
                    break;
                case "lt":
                    clauses.push(
                        `${column} < ${this.getParamPlaceholder(paramIdx)}`
                    );
                    params.push(filter.value);
                    break;
                case "lte":
                    clauses.push(
                        `${column} <= ${this.getParamPlaceholder(paramIdx)}`
                    );
                    params.push(filter.value);
                    break;
                case "like":
                    clauses.push(
                        `${column} LIKE ${this.getParamPlaceholder(paramIdx)}`
                    );
                    params.push(filter.value);
                    break;
                case "ilike":
                    if (this.adapter.dialect === "postgresql") {
                        clauses.push(
                            `${column} ILIKE ${this.getParamPlaceholder(
                                paramIdx
                            )}`
                        );
                    } else {
                        clauses.push(
                            `LOWER(${column}) LIKE LOWER(${this.getParamPlaceholder(
                                paramIdx
                            )})`
                        );
                    }
                    params.push(filter.value);
                    break;
                case "in":
                    const inValues = Array.isArray(filter.value)
                        ? filter.value
                        : [filter.value];
                    const inPlaceholders = inValues
                        .map((_, i) => this.getParamPlaceholder(paramIdx + i))
                        .join(", ");
                    clauses.push(`${column} IN (${inPlaceholders})`);
                    params.push(...inValues);
                    break;
                case "is":
                    clauses.push(
                        `${column} IS ${
                            filter.value === null ? "NULL" : "NOT NULL"
                        }`
                    );
                    break;
                default:
                    throw new Error(`Unsupported operator: ${filter.operator}`);
            }
        }

        return {
            clause: clauses.join(" AND "),
            params,
        };
    }

    /**
     * Parse query parameters into filters
     */
    private parseQueryFilters(query: any): QueryFilters {
        const filters: QueryFilters = {
            where: [],
            order: [],
        };

        // Parse select
        if (query.select) {
            filters.select = query.select
                .split(",")
                .map((s: string) => s.trim());
        }

        // Parse where conditions
        for (const [key, value] of Object.entries(query)) {
            if (
                key === "select" ||
                key === "order" ||
                key === "limit" ||
                key === "offset"
            ) {
                continue;
            }

            // Format: column=eq.value or column=gt.100
            const [operator, ...valueParts] = (value as string).split(".");
            const filterValue = valueParts.join(".");

            filters.where!.push({
                column: key,
                operator: operator || "eq",
                value: this.parseValue(filterValue),
            });
        }

        // Parse order
        if (query.order) {
            const orders = query.order.split(",");
            for (const order of orders) {
                const [column, direction] = order.trim().split(".");
                filters.order!.push({
                    column,
                    direction: (direction?.toUpperCase() || "ASC") as
                        | "ASC"
                        | "DESC",
                });
            }
        }

        // Parse limit and offset
        if (query.limit) {
            filters.limit = parseInt(query.limit);
        }
        if (query.offset) {
            filters.offset = parseInt(query.offset);
        }

        return filters;
    }

    /**
     * Parse value from string (handle numbers, booleans, null)
     */
    private parseValue(value: string): any {
        if (value === "null") return null;
        if (value === "true") return true;
        if (value === "false") return false;
        if (!isNaN(Number(value))) return Number(value);
        return value;
    }

    /**
     * Get parameter placeholder for current dialect
     */
    private getParamPlaceholder(index: number): string {
        if (this.adapter.dialect === "postgresql") {
            return `$${index + 1}`;
        } else if (this.adapter.dialect === "tsql") {
            return `@param${index}`;
        } else {
            return "?";
        }
    }

    /**
     * Get table row count
     */
    private async getTableCount(
        table: string,
        whereFilters?: WhereClause[]
    ): Promise<number> {
        let sql = `SELECT COUNT(*) as count FROM ${this.adapter.escapeIdentifier(
            table
        )}`;
        let params: any[] = [];

        if (whereFilters && whereFilters.length > 0) {
            const whereClause = this.buildWhereClause(whereFilters);
            sql += ` WHERE ${whereClause.clause}`;
            params = whereClause.params;
        }

        const result = await this.adapter.queryOne<{ count: number }>(
            sql,
            params
        );
        return result?.count || 0;
    }

    /**
     * Generate OpenAPI schema
     */
    private async getOpenAPISchema(
        _req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        try {
            const schema = await this.adapter.getSchema();

            const paths: any = {};

            for (const table of schema.tables) {
                const tablePath = `${this.basePath}/${table.name}`;

                paths[tablePath] = {
                    get: {
                        summary: `List ${table.name}`,
                        parameters: this.generateQueryParameters(table.columns),
                        responses: {
                            200: {
                                description: "Success",
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object",
                                            properties: {
                                                data: {
                                                    type: "array",
                                                    items: this.generateTableSchema(
                                                        table.columns
                                                    ),
                                                },
                                                count: { type: "number" },
                                                total: { type: "number" },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    post: {
                        summary: `Create ${table.name}`,
                        requestBody: {
                            content: {
                                "application/json": {
                                    schema: this.generateTableSchema(
                                        table.columns
                                    ),
                                },
                            },
                        },
                        responses: {
                            201: { description: "Created" },
                        },
                    },
                };
            }

            const openApiSchema = {
                openapi: "3.0.0",
                info: {
                    title: `${this.adapter.provider} REST API`,
                    version: "1.0.0",
                },
                paths,
            };

            res.json(openApiSchema);
        } catch (error) {
            next(error);
        }
    }

    private generateQueryParameters(columns: ColumnInfo[]) {
        return [
            {
                name: "select",
                in: "query",
                schema: { type: "string" },
                description: "Columns to select (comma-separated)",
            },
            {
                name: "order",
                in: "query",
                schema: { type: "string" },
                description: "Order by (column.asc|desc)",
            },
            {
                name: "limit",
                in: "query",
                schema: { type: "number" },
                description: "Limit results",
            },
            {
                name: "offset",
                in: "query",
                schema: { type: "number" },
                description: "Offset results",
            },
            ...columns.map((col) => ({
                name: col.name,
                in: "query",
                schema: { type: this.mapTypeToOpenAPI(col.dataType) },
                description: `Filter by ${col.name} (operators: eq, neq, gt, gte, lt, lte, like, in)`,
            })),
        ];
    }

    private generateTableSchema(columns: ColumnInfo[]) {
        const properties: any = {};

        for (const col of columns) {
            properties[col.name] = {
                type: this.mapTypeToOpenAPI(col.dataType),
                nullable: col.nullable,
            };
        }

        return {
            type: "object",
            properties,
        };
    }

    private mapTypeToOpenAPI(dbType: string): string {
        const type = dbType.toLowerCase();
        if (type.includes("int") || type.includes("serial")) return "integer";
        if (
            type.includes("numeric") ||
            type.includes("decimal") ||
            type.includes("float") ||
            type.includes("double")
        )
            return "number";
        if (type.includes("bool") || type.includes("bit")) return "boolean";
        return "string";
    }

    /**
     * Health check endpoint
     */
    private async healthCheck(
        _req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        try {
            const healthy = await this.adapter.healthCheck();
            const stats = await this.adapter.getStats();

            res.json({
                status: healthy ? "healthy" : "unhealthy",
                database: this.adapter.provider,
                stats,
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Default error handler
     */
    private defaultErrorHandler(
        err: Error,
        _req: Request,
        res: Response,
        _next: NextFunction
    ): void {
        console.error("API Error:", err);

        res.status(500).json({
            error: err.message,
            code: "INTERNAL_ERROR",
        });
    }

    /**
     * Get Express app
     */
    getApp(): express.Application {
        return this.app;
    }

    /**
     * Start server
     */
    listen(port: number, callback?: () => void) {
        return this.app.listen(port, callback);
    }
}
