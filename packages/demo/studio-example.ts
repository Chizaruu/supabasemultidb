/**
 * Complete Studio Setup Example
 *
 * This example shows how to run Supabase Studio with Azure SQL
 * (or any other database)
 */

import { AzureSQLAdapter } from "../database-adapters/azuresql/azuresql-adapter";
import { PostgreSQLAdapter } from "../database-adapters/postgresql/postgresql-adapter";
import { StudioBridge } from "../studio-bridge/studio-bridge";

/**
 * Example 1: Studio with Azure SQL
 */
async function runWithAzureSQL() {
    console.log("🚀 Starting Supabase Studio with Azure SQL...\n");

    // 1. Connect to Azure SQL
    console.log("1️⃣ Connecting to Azure SQL...");
    const adapter = new AzureSQLAdapter();

    await adapter.connect({
        host: process.env.AZURE_SQL_HOST || "myserver.database.windows.net",
        port: parseInt(process.env.AZURE_SQL_PORT || "1433"),
        database: process.env.AZURE_SQL_DATABASE || "mydb",
        username: process.env.AZURE_SQL_USER || "admin",
        password: process.env.AZURE_SQL_PASSWORD || "P@ssw0rd!",
        ssl: true,
    });

    console.log("✅ Connected to Azure SQL\n");

    // 2. Create sample table if it doesn't exist
    console.log("2️⃣ Setting up sample data...");
    try {
        await adapter.createTable("users", [
            {
                name: "id",
                dataType: "INT",
                nullable: false,
                isIdentity: true,
                defaultValue: null,
            },
            {
                name: "name",
                dataType: "NVARCHAR",
                nullable: false,
                isIdentity: false,
                maxLength: 100,
                defaultValue: null,
            },
            {
                name: "email",
                dataType: "NVARCHAR",
                nullable: false,
                isIdentity: false,
                maxLength: 255,
                defaultValue: null,
            },
            {
                name: "created_at",
                dataType: "DATETIME2",
                nullable: false,
                isIdentity: false,
                defaultValue: "GETDATE()",
            },
        ]);
        console.log("✅ Created users table\n");
    } catch (e) {
        console.log("✅ Users table already exists\n");
    }

    // 3. Insert sample data
    try {
        await adapter.query(
            "INSERT INTO users (name, email) OUTPUT INSERTED.* VALUES (@param0, @param1)",
            ["John Doe", "john@example.com"]
        );
        console.log("✅ Inserted sample data\n");
    } catch (e) {
        console.log("✅ Sample data already exists\n");
    }

    // 4. Start bridge service
    console.log("3️⃣ Starting Studio Bridge...");
    const bridge = new StudioBridge({
        adapter,
        port: 54321,
        allowedOrigins: ["http://localhost:3000", "http://localhost:8000"],
    });

    bridge.listen(() => {
        console.log("\n✅ Everything is ready!\n");
        console.log("╔════════════════════════════════════════════════════╗");
        console.log("║  Supabase Studio is ready to use!                 ║");
        console.log("╚════════════════════════════════════════════════════╝\n");
        console.log("📊 Studio Bridge running on:");
        console.log("   http://localhost:54321\n");
        console.log("📝 Next steps:\n");
        console.log("   1. Run Supabase Studio:");
        console.log("      docker run -p 3000:3000 \\");
        console.log(
            "        -e SUPABASE_URL=http://host.docker.internal:54321 \\"
        );
        console.log(
            "        -e SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 \\"
        );
        console.log("        supabase/studio:latest\n");
        console.log("   2. Open Studio:");
        console.log("      http://localhost:3000\n");
        console.log("   3. Explore your Azure SQL database in Studio! 🎉\n");
        console.log("🔗 API Endpoints available:");
        console.log("   • REST API:     http://localhost:54321/rest/v1");
        console.log("   • Tables:       http://localhost:54321/pg/meta/tables");
        console.log(
            "   • Columns:      http://localhost:54321/pg/meta/columns"
        );
        console.log("   • Health Check: http://localhost:54321/health\n");
        console.log("💡 Test the API:");
        console.log("   curl http://localhost:54321/rest/v1/users\n");
    });
}

/**
 * Example 2: Studio with PostgreSQL
 */
async function runWithPostgreSQL() {
    console.log("🚀 Starting Supabase Studio with PostgreSQL...\n");

    // 1. Connect to PostgreSQL
    console.log("1️⃣ Connecting to PostgreSQL...");
    const adapter = new PostgreSQLAdapter();

    await adapter.connect({
        host: process.env.POSTGRES_HOST || "localhost",
        port: parseInt(process.env.POSTGRES_PORT || "5432"),
        database: process.env.POSTGRES_DATABASE || "postgres",
        username: process.env.POSTGRES_USER || "postgres",
        password: process.env.POSTGRES_PASSWORD || "postgres",
    });

    console.log("✅ Connected to PostgreSQL\n");

    // 2. Create sample table
    console.log("2️⃣ Setting up sample data...");
    try {
        await adapter.createTable("users", [
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
        ]);
        console.log("✅ Created users table\n");
    } catch (e) {
        console.log("✅ Users table already exists\n");
    }

    // 3. Insert sample data
    try {
        await adapter.query(
            "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *",
            ["Jane Smith", "jane@example.com"]
        );
        console.log("✅ Inserted sample data\n");
    } catch (e) {
        console.log("✅ Sample data already exists\n");
    }

    // 4. Start bridge service
    console.log("3️⃣ Starting Studio Bridge...");
    const bridge = new StudioBridge({
        adapter,
        port: 54321,
        allowedOrigins: ["http://localhost:3000", "http://localhost:8000"],
    });

    bridge.listen(() => {
        console.log("\n✅ Everything is ready!\n");
        console.log("╔════════════════════════════════════════════════════╗");
        console.log("║  Supabase Studio is ready to use!                 ║");
        console.log("╚════════════════════════════════════════════════════╝\n");
        console.log("📊 Studio Bridge running on:");
        console.log("   http://localhost:54321\n");
        console.log("📝 Next steps:\n");
        console.log("   1. Run Supabase Studio:");
        console.log("      docker run -p 3000:3000 \\");
        console.log(
            "        -e SUPABASE_URL=http://host.docker.internal:54321 \\"
        );
        console.log(
            "        -e SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 \\"
        );
        console.log("        supabase/studio:latest\n");
        console.log("   2. Open Studio:");
        console.log("      http://localhost:3000\n");
        console.log("   3. Explore your PostgreSQL database in Studio! 🎉\n");
    });
}

/**
 * Main entry point
 */
async function main() {
    const database = process.argv[2] || "postgresql";

    console.log("╔════════════════════════════════════════════════════╗");
    console.log("║   Supabase Studio with Multi-Database Support     ║");
    console.log("╚════════════════════════════════════════════════════╝\n");

    if (database === "azuresql") {
        await runWithAzureSQL();
    } else if (database === "postgresql") {
        await runWithPostgreSQL();
    } else {
        console.error(`Unknown database: ${database}`);
        console.log("\nUsage:");
        console.log("  npm run studio              # PostgreSQL (default)");
        console.log("  npm run studio azuresql     # Azure SQL");
        console.log("  npm run studio postgresql   # PostgreSQL");
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
    console.log("\n\n👋 Shutting down gracefully...");
    process.exit(0);
});

process.on("SIGTERM", () => {
    console.log("\n\n👋 Shutting down gracefully...");
    process.exit(0);
});

// Run
if (require.main === module) {
    main().catch((error) => {
        console.error("\n❌ Error:", error.message);
        console.error("\n💡 Make sure:");
        console.error("   1. Your database is running");
        console.error("   2. Connection credentials are correct");
        console.error("   3. Firewall allows connections");
        console.error("\nSet environment variables:");
        console.error(
            "   AZURE_SQL_HOST, AZURE_SQL_PORT, AZURE_SQL_DATABASE, etc."
        );
        console.error(
            "   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DATABASE, etc.\n"
        );
        process.exit(1);
    });
}

export { runWithAzureSQL, runWithPostgreSQL };
