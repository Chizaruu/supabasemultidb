/**
 * Core Database Adapter Interface
 *
 * This interface defines the contract that all database adapters must implement
 * to work with Supabase's multi-database architecture.
 */

export interface DatabaseCapabilities {
    /** Native Row-Level Security support */
    hasNativeRLS: boolean;

    /** Logical replication for realtime (PostgreSQL) or CDC (SQL Server) */
    hasLogicalReplication: boolean;

    /** Native JSONB data type */
    hasJSONB: boolean;

    /** Native pub/sub for realtime notifications */
    hasPubSub: boolean;

    /** Vector search capabilities */
    hasVectorSearch: boolean;

    /** Supported extensions (e.g., 'postgis', 'pg_stat_statements') */
    supportsExtensions: string[];

    /** Full-text search capabilities */
    hasFullTextSearch: boolean;

    /** Maximum connections allowed */
    maxConnections: number;

    /** Supports stored procedures/functions */
    hasStoredProcedures: boolean;
}

export interface ConnectionConfig {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl?: boolean;
    /** Additional provider-specific options */
    options?: Record<string, any>;
}

export interface QueryResult<T = any> {
    rows: T[];
    rowCount: number;
    fields: FieldInfo[];
    command: string;
}

export interface FieldInfo {
    name: string;
    dataType: string;
    nullable: boolean;
    isPrimaryKey: boolean;
    isForeignKey: boolean;
    defaultValue?: any;
}

export interface TableInfo {
    schema: string;
    name: string;
    columns: ColumnInfo[];
    primaryKeys: string[];
    foreignKeys: ForeignKeyInfo[];
    indexes: IndexInfo[];
}

export interface ColumnInfo {
    name: string;
    dataType: string;
    nullable: boolean;
    defaultValue?: any;
    isIdentity: boolean;
    maxLength?: number;
    precision?: number;
    scale?: number;
}

export interface ForeignKeyInfo {
    name: string;
    columns: string[];
    referencedTable: string;
    referencedColumns: string[];
    onDelete?: "CASCADE" | "SET NULL" | "NO ACTION" | "RESTRICT";
    onUpdate?: "CASCADE" | "SET NULL" | "NO ACTION" | "RESTRICT";
}

export interface IndexInfo {
    name: string;
    columns: string[];
    isUnique: boolean;
    isPrimary: boolean;
}

export interface SecurityPolicy {
    name: string;
    table: string;
    operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
    using?: string; // SQL expression for filtering
    withCheck?: string; // SQL expression for validation
    role?: string;
}

export interface ChangeEvent {
    operation: "INSERT" | "UPDATE" | "DELETE";
    table: string;
    schema: string;
    old?: Record<string, any>;
    new?: Record<string, any>;
    timestamp: Date;
    commitLsn?: string; // Log sequence number or CDC tracking
}

export interface Subscription {
    unsubscribe: () => Promise<void>;
    isActive: () => boolean;
}

export interface TransactionContext {
    query: <T = any>(sql: string, params?: any[]) => Promise<QueryResult<T>>;
    commit: () => Promise<void>;
    rollback: () => Promise<void>;
}

export interface SchemaInfo {
    schemas: string[];
    tables: TableInfo[];
    functions: FunctionInfo[];
    views: ViewInfo[];
}

export interface FunctionInfo {
    schema: string;
    name: string;
    parameters: ParameterInfo[];
    returnType: string;
    language: string;
    definition: string;
}

export interface ParameterInfo {
    name: string;
    dataType: string;
    mode: "IN" | "OUT" | "INOUT";
}

export interface ViewInfo {
    schema: string;
    name: string;
    definition: string;
    columns: ColumnInfo[];
}

/**
 * Main Database Adapter Interface
 *
 * All database providers must implement this interface to be compatible
 * with Supabase's multi-database system.
 */
export interface DatabaseAdapter {
    /** Database provider name (e.g., 'postgresql', 'azuresql') */
    readonly provider: string;

    /** Database capabilities and features */
    readonly capabilities: DatabaseCapabilities;

    /** SQL dialect for query generation */
    readonly dialect: "postgresql" | "tsql" | "mysql";

    // Connection Management

    /** Initialize connection to the database */
    connect(config: ConnectionConfig): Promise<void>;

    /** Close database connection */
    disconnect(): Promise<void>;

    /** Test if connection is active */
    isConnected(): boolean;

    // Query Operations

    /** Execute a raw SQL query */
    query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;

    /** Execute query and return first row */
    queryOne<T = any>(sql: string, params?: any[]): Promise<T | null>;

    /** Execute query within a transaction */
    transaction<T>(
        callback: (ctx: TransactionContext) => Promise<T>
    ): Promise<T>;

    // Schema Operations

    /** Get complete database schema information */
    getSchema(): Promise<SchemaInfo>;

    /** Get all tables in a schema */
    getTables(schema?: string): Promise<TableInfo[]>;

    /** Get detailed information about a specific table */
    getTable(tableName: string, schema?: string): Promise<TableInfo>;

    /** Get all columns for a table */
    getColumns(tableName: string, schema?: string): Promise<ColumnInfo[]>;

    /** Get all functions/stored procedures */
    getFunctions(schema?: string): Promise<FunctionInfo[]>;

    /** Get all views */
    getViews(schema?: string): Promise<ViewInfo[]>;

    // DDL Operations

    /** Create a new table */
    createTable(
        tableName: string,
        columns: ColumnInfo[],
        schema?: string
    ): Promise<void>;

    /** Alter an existing table */
    alterTable(
        tableName: string,
        changes: {
            addColumns?: ColumnInfo[];
            dropColumns?: string[];
            modifyColumns?: ColumnInfo[];
        },
        schema?: string
    ): Promise<void>;

    /** Drop a table */
    dropTable(tableName: string, schema?: string): Promise<void>;

    /** Create an index */
    createIndex(
        tableName: string,
        indexName: string,
        columns: string[],
        options?: { unique?: boolean; where?: string }
    ): Promise<void>;

    // Security & RLS

    /** Apply security policies (RLS for PostgreSQL, Security Predicates for Azure SQL) */
    applySecurityPolicy(policy: SecurityPolicy): Promise<void>;

    /** Remove a security policy */
    removeSecurityPolicy(policyName: string, tableName: string): Promise<void>;

    /** Get all security policies for a table */
    getSecurityPolicies(
        tableName: string,
        schema?: string
    ): Promise<SecurityPolicy[]>;

    /** Enable RLS/security on a table */
    enableSecurity(tableName: string, schema?: string): Promise<void>;

    /** Disable RLS/security on a table */
    disableSecurity(tableName: string, schema?: string): Promise<void>;

    // Realtime & Change Data Capture

    /** Subscribe to table changes (uses replication or CDC) */
    subscribeToChanges(
        tables: string[],
        callback: (event: ChangeEvent) => void,
        options?: {
            operations?: ("INSERT" | "UPDATE" | "DELETE")[];
            schema?: string;
        }
    ): Promise<Subscription>;

    /** Enable CDC/replication for a table */
    enableChangeTracking(tableName: string, schema?: string): Promise<void>;

    /** Disable CDC/replication for a table */
    disableChangeTracking(tableName: string, schema?: string): Promise<void>;

    // Type Mapping

    /** Convert database-specific type to standard type */
    mapTypeToStandard(dbType: string): string;

    /** Convert standard type to database-specific type */
    mapTypeFromStandard(standardType: string): string;

    // Query Building Helpers

    /** Generate parameterized query with correct syntax for this database */
    buildParameterizedQuery(sql: string, params: any[]): string;

    /** Escape identifier (table name, column name) */
    escapeIdentifier(identifier: string): string;

    /** Quote string value */
    quoteValue(value: any): string;

    // Migration Support

    /** Export schema as SQL DDL */
    exportSchema(schema?: string): Promise<string>;

    /** Import schema from SQL DDL */
    importSchema(ddl: string): Promise<void>;

    // Health & Monitoring

    /** Get current database statistics */
    getStats(): Promise<{
        connections: number;
        activeQueries: number;
        databaseSize: number;
        tableCount: number;
    }>;

    /** Check database health */
    healthCheck(): Promise<boolean>;
}

/**
 * Factory function type for creating database adapters
 */
export type AdapterFactory = (
    config: ConnectionConfig
) => Promise<DatabaseAdapter>;

/**
 * Registry for database adapters
 */
export class AdapterRegistry {
    private static adapters = new Map<string, AdapterFactory>();

    static register(provider: string, factory: AdapterFactory): void {
        this.adapters.set(provider.toLowerCase(), factory);
    }

    static async create(
        provider: string,
        config: ConnectionConfig
    ): Promise<DatabaseAdapter> {
        const factory = this.adapters.get(provider.toLowerCase());
        if (!factory) {
            throw new Error(
                `Unknown database provider: ${provider}. ` +
                    `Available providers: ${Array.from(
                        this.adapters.keys()
                    ).join(", ")}`
            );
        }
        return factory(config);
    }

    static getProviders(): string[] {
        return Array.from(this.adapters.keys());
    }
}
