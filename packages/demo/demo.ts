/**
 * Proof-of-Concept Demo
 *
 * Demonstrates both PostgreSQL and Azure SQL adapters working
 * with the same REST API interface.
 */

import { PostgreSQLAdapter } from "../database-adapters/postgresql/postgresql-adapter";
import { AzureSQLAdapter } from "../database-adapters/azuresql/azuresql-adapter";
import { RestAPIGenerator } from "../rest-api/rest-generator";
import { AdapterRegistry } from "../database-adapters/core/adapter";

/**
 * Helper function to safely extract error message from unknown error type
 */
function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

// Register adapters
AdapterRegistry.register("postgresql", async (config) => {
    const adapter = new PostgreSQLAdapter();
    await adapter.connect(config);
    return adapter;
});

AdapterRegistry.register("azuresql", async (config) => {
    const adapter = new AzureSQLAdapter();
    await adapter.connect(config);
    return adapter;
});

/**
 * Demo 1: Basic Connection and Queries
 */
async function demoBasicOperations() {
    console.log("\n=== Demo 1: Basic Operations ===\n");

    // PostgreSQL Setup
    console.log("1. Connecting to PostgreSQL...");
    const pgAdapter = await AdapterRegistry.create("postgresql", {
        host: "localhost",
        port: 5432,
        database: "demo_db",
        username: "postgres",
        password: "password",
    });

    console.log("✓ PostgreSQL connected");
    console.log("  Capabilities:", pgAdapter.capabilities);

    // Azure SQL Setup
    console.log("\n2. Connecting to Azure SQL...");
    const azureAdapter = await AdapterRegistry.create("azuresql", {
        host: "myserver.database.windows.net",
        port: 1433,
        database: "demo_db",
        username: "admin",
        password: "P@ssw0rd!",
    });

    console.log("✓ Azure SQL connected");
    console.log("  Capabilities:", azureAdapter.capabilities);

    // Create same table on both
    console.log('\n3. Creating "users" table on both databases...');

    const userColumns = [
        {
            name: "id",
            dataType: "INTEGER",
            nullable: false,
            isIdentity: true,
            defaultValue: null,
        },
        {
            name: "name",
            dataType: "VARCHAR",
            nullable: false,
            isIdentity: false,
            maxLength: 100,
            defaultValue: null,
        },
        {
            name: "email",
            dataType: "VARCHAR",
            nullable: false,
            isIdentity: false,
            maxLength: 255,
            defaultValue: null,
        },
        {
            name: "created_at",
            dataType: "TIMESTAMP",
            nullable: false,
            isIdentity: false,
            defaultValue: "CURRENT_TIMESTAMP",
        },
    ];

    try {
        await pgAdapter.createTable("users", userColumns);
        console.log("✓ PostgreSQL: users table created");
    } catch (_error) {
        console.log("✓ PostgreSQL: users table already exists");
    }

    try {
        // Azure SQL needs adapted column types
        const azureColumns = userColumns.map((col) => ({
            ...col,
            dataType: azureAdapter.mapTypeFromStandard(
                pgAdapter.mapTypeToStandard(col.dataType)
            ),
        }));
        await azureAdapter.createTable("users", azureColumns);
        console.log("✓ Azure SQL: users table created");
    } catch (_error) {
        console.log("✓ Azure SQL: users table already exists");
    }

    // Insert data
    console.log("\n4. Inserting test data...");

    const insertSQL =
        pgAdapter.dialect === "postgresql"
            ? "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *"
            : "INSERT INTO users (name, email) OUTPUT INSERTED.* VALUES (@param0, @param1)";

    const pgResult = await pgAdapter.query(insertSQL, [
        "Alice",
        "alice@example.com",
    ]);
    console.log("✓ PostgreSQL insert:", pgResult.rows[0]);

    // For Azure SQL, adjust the query
    const azureInsertSQL =
        "INSERT INTO users (name, email) OUTPUT INSERTED.* VALUES (@param0, @param1)";
    const azureResult = await azureAdapter.query(azureInsertSQL, [
        "Bob",
        "bob@example.com",
    ]);
    console.log("✓ Azure SQL insert:", azureResult.rows[0]);

    // Query data
    console.log("\n5. Querying data...");

    const pgUsers = await pgAdapter.query("SELECT * FROM users");
    console.log(`✓ PostgreSQL: Found ${pgUsers.rowCount} users`);
    pgUsers.rows.forEach((user) => console.log("  -", user));

    const azureUsers = await azureAdapter.query("SELECT * FROM users");
    console.log(`✓ Azure SQL: Found ${azureUsers.rowCount} users`);
    azureUsers.rows.forEach((user) => console.log("  -", user));

    // Cleanup
    await pgAdapter.disconnect();
    await azureAdapter.disconnect();
    console.log("\n✓ Disconnected from both databases");
}

/**
 * Demo 2: REST API with Both Databases
 */
async function demoRESTAPI() {
    console.log("\n=== Demo 2: REST API Generation ===\n");

    // Setup PostgreSQL adapter
    const pgAdapter = await AdapterRegistry.create("postgresql", {
        host: "localhost",
        port: 5432,
        database: "demo_db",
        username: "postgres",
        password: "password",
    });

    // Setup Azure SQL adapter
    const azureAdapter = await AdapterRegistry.create("azuresql", {
        host: "myserver.database.windows.net",
        port: 1433,
        database: "demo_db",
        username: "admin",
        password: "P@ssw0rd!",
    });

    // Create REST API for PostgreSQL
    console.log("1. Creating REST API for PostgreSQL...");
    const pgAPI = new RestAPIGenerator({
        adapter: pgAdapter,
        basePath: "/pg-api",
        enableCors: true,
        maxRows: 100,
    });

    // Create REST API for Azure SQL
    console.log("2. Creating REST API for Azure SQL...");
    const azureAPI = new RestAPIGenerator({
        adapter: azureAdapter,
        basePath: "/azure-api",
        enableCors: true,
        maxRows: 100,
    });

    // Start servers
    console.log("\n3. Starting API servers...");

    pgAPI.listen(3000, () => {
        console.log(
            "✓ PostgreSQL REST API listening on http://localhost:3000/pg-api"
        );
        console.log("  Try: curl http://localhost:3000/pg-api/users");
    });

    azureAPI.listen(3001, () => {
        console.log(
            "✓ Azure SQL REST API listening on http://localhost:3001/azure-api"
        );
        console.log("  Try: curl http://localhost:3001/azure-api/users");
    });

    console.log("\n4. Example API calls:");
    console.log(
        "  GET /pg-api/users              - List all users (PostgreSQL)"
    );
    console.log("  GET /pg-api/users?name=eq.Alice - Filter users");
    console.log("  GET /pg-api/users?order=name.asc - Sort users");
    console.log("  POST /pg-api/users             - Create user");
    console.log("  PATCH /pg-api/users/1          - Update user");
    console.log("  DELETE /pg-api/users/1         - Delete user");
    console.log("\n  Same endpoints work for Azure SQL at /azure-api/*");
}

/**
 * Demo 3: Schema Introspection
 */
async function demoSchemaIntrospection() {
    console.log("\n=== Demo 3: Schema Introspection ===\n");

    const adapter = await AdapterRegistry.create("postgresql", {
        host: "localhost",
        port: 5432,
        database: "demo_db",
        username: "postgres",
        password: "password",
    });

    console.log("1. Getting schema information...");
    const schema = await adapter.getSchema();

    console.log(`\n✓ Found ${schema.tables.length} tables:`);

    for (const table of schema.tables) {
        console.log(`\n  Table: ${table.schema}.${table.name}`);
        console.log(`  Columns: ${table.columns.length}`);
        table.columns.forEach((col) => {
            console.log(
                `    - ${col.name}: ${col.dataType} ${col.nullable ? "NULL" : "NOT NULL"}`
            );
        });

        if (table.primaryKeys.length > 0) {
            console.log(`  Primary Keys: ${table.primaryKeys.join(", ")}`);
        }

        if (table.foreignKeys.length > 0) {
            console.log(`  Foreign Keys:`);
            table.foreignKeys.forEach((fk) => {
                console.log(
                    `    - ${fk.name}: ${fk.columns.join(", ")} -> ${fk.referencedTable}(${fk.referencedColumns.join(", ")})`
                );
            });
        }

        if (table.indexes.length > 0) {
            console.log(`  Indexes: ${table.indexes.length}`);
        }
    }

    await adapter.disconnect();
}

/**
 * Demo 4: Security Policies (RLS)
 */
async function demoSecurityPolicies() {
    console.log("\n=== Demo 4: Security Policies ===\n");

    console.log("1. PostgreSQL Row-Level Security...");
    const pgAdapter = await AdapterRegistry.create("postgresql", {
        host: "localhost",
        port: 5432,
        database: "demo_db",
        username: "postgres",
        password: "password",
    });

    // Enable RLS
    await pgAdapter.enableSecurity("users");
    console.log("✓ RLS enabled on users table");

    // Create policy
    await pgAdapter.applySecurityPolicy({
        name: "users_select_policy",
        table: "users",
        operation: "SELECT",
        using: "auth.uid() = user_id",
    });
    console.log("✓ Policy created: users can only see their own data");

    // Get policies
    const policies = await pgAdapter.getSecurityPolicies("users");
    console.log(`✓ Found ${policies.length} policies:`);
    policies.forEach((p) => {
        console.log(`  - ${p.name}: ${p.operation} using ${p.using}`);
    });

    console.log("\n2. Azure SQL Security Predicates...");
    console.log(
        "  Note: Azure SQL uses different syntax (Security Predicates)"
    );
    console.log("  Similar functionality, different implementation");

    await pgAdapter.disconnect();
}

/**
 * Demo 5: Realtime / Change Data Capture
 */
async function demoRealtime() {
    console.log("\n=== Demo 5: Realtime Changes ===\n");

    console.log("1. Setting up change tracking...");

    const pgAdapter = await AdapterRegistry.create("postgresql", {
        host: "localhost",
        port: 5432,
        database: "demo_db",
        username: "postgres",
        password: "password",
    });

    // Subscribe to changes
    console.log("2. Subscribing to users table changes...");

    const subscription = await pgAdapter.subscribeToChanges(
        ["users"],
        (event) => {
            console.log(`\n  Change detected!`);
            console.log(`  Operation: ${event.operation}`);
            console.log(`  Table: ${event.table}`);
            console.log(`  Data:`, event.new || event.old);
        }
    );

    console.log("✓ Subscribed to changes");
    console.log(
        "  Waiting for changes... (make some INSERT/UPDATE/DELETE operations)"
    );
    console.log("  Press Ctrl+C to stop");

    // Keep process alive
    process.on("SIGINT", async () => {
        console.log("\n\nCleaning up...");
        await subscription.unsubscribe();
        await pgAdapter.disconnect();
        process.exit(0);
    });
}

/**
 * Demo 6: Performance Comparison
 */
async function demoPerformance() {
    console.log("\n=== Demo 6: Performance Comparison ===\n");

    const pgAdapter = await AdapterRegistry.create("postgresql", {
        host: "localhost",
        port: 5432,
        database: "demo_db",
        username: "postgres",
        password: "password",
    });

    const azureAdapter = await AdapterRegistry.create("azuresql", {
        host: "myserver.database.windows.net",
        port: 1433,
        database: "demo_db",
        username: "admin",
        password: "P@ssw0rd!",
    });

    // Benchmark simple query
    console.log("1. Benchmarking SELECT queries...");

    const iterations = 100;

    // PostgreSQL
    const pgStart = Date.now();
    for (let i = 0; i < iterations; i++) {
        await pgAdapter.query("SELECT * FROM users LIMIT 10");
    }
    const pgTime = Date.now() - pgStart;

    // Azure SQL
    const azureStart = Date.now();
    for (let i = 0; i < iterations; i++) {
        await azureAdapter.query("SELECT TOP 10 * FROM users");
    }
    const azureTime = Date.now() - azureStart;

    console.log(
        `\n  PostgreSQL: ${iterations} queries in ${pgTime}ms (${(pgTime / iterations).toFixed(2)}ms avg)`
    );
    console.log(
        `  Azure SQL:  ${iterations} queries in ${azureTime}ms (${(azureTime / iterations).toFixed(2)}ms avg)`
    );

    // Get stats
    console.log("\n2. Database statistics:");

    const pgStats = await pgAdapter.getStats();
    console.log("\n  PostgreSQL:");
    console.log(`    Connections: ${pgStats.connections}`);
    console.log(`    Active queries: ${pgStats.activeQueries}`);
    console.log(
        `    Database size: ${(pgStats.databaseSize / 1024 / 1024).toFixed(2)} MB`
    );
    console.log(`    Tables: ${pgStats.tableCount}`);

    const azureStats = await azureAdapter.getStats();
    console.log("\n  Azure SQL:");
    console.log(`    Connections: ${azureStats.connections}`);
    console.log(`    Active queries: ${azureStats.activeQueries}`);
    console.log(
        `    Database size: ${(azureStats.databaseSize / 1024 / 1024).toFixed(2)} MB`
    );
    console.log(`    Tables: ${azureStats.tableCount}`);

    await pgAdapter.disconnect();
    await azureAdapter.disconnect();
}

/**
 * Main demo runner
 */
async function main() {
    console.log("╔════════════════════════════════════════════════════╗");
    console.log("║  Supabase Multi-Database Architecture Demo        ║");
    console.log("║  PostgreSQL + Azure SQL with Unified Interface     ║");
    console.log("╚════════════════════════════════════════════════════╝");

    const demos = [
        { name: "Basic Operations", fn: demoBasicOperations },
        { name: "REST API Generation", fn: demoRESTAPI },
        { name: "Schema Introspection", fn: demoSchemaIntrospection },
        { name: "Security Policies", fn: demoSecurityPolicies },
        { name: "Realtime Changes", fn: demoRealtime },
        { name: "Performance Comparison", fn: demoPerformance },
    ];

    console.log("\nAvailable demos:");
    demos.forEach((demo, i) => {
        console.log(`  ${i + 1}. ${demo.name}`);
    });

    console.log("\nTo run a specific demo:");
    console.log("  node demo.js <number>");
    console.log("\nTo run all demos:");
    console.log("  node demo.js all\n");

    const arg = process.argv[2];

    if (!arg) {
        console.log('Please specify a demo number or "all"');
        return;
    }

    if (arg === "all") {
        for (const demo of demos) {
            try {
                await demo.fn();
            } catch (error) {
                console.error(`\n❌ Error in ${demo.name}:`, getErrorMessage(error));
            }
        }
    } else {
        const demoIndex = parseInt(arg) - 1;
        if (demoIndex >= 0 && demoIndex < demos.length) {
            try {
                await demos[demoIndex].fn();
            } catch (error) {
                console.error(`\n❌ Error:`, getErrorMessage(error));
            }
        } else {
            console.log("Invalid demo number");
        }
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

export {
    demoBasicOperations,
    demoRESTAPI,
    demoSchemaIntrospection,
    demoSecurityPolicies,
    demoRealtime,
    demoPerformance,
};