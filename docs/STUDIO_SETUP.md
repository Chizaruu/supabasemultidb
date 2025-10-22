# Using Supabase Studio with Any Database

This guide shows you how to use the official **Supabase Studio** (self-hosted) with PostgreSQL, Azure SQL, MySQL, or any other database.

## Architecture

```
┌─────────────────────────────────────┐
│   Supabase Studio (Self-Hosted)    │
│   localhost:3000                    │
│   • Table Editor                    │
│   • SQL Editor                      │
│   • Auth Management                 │
│   • Storage Browser                 │
└─────────────────────────────────────┘
              ↓ HTTP
┌─────────────────────────────────────┐
│    Studio Bridge Service            │
│    localhost:54321                  │
│    • Translates Studio requests     │
│    • Routes to database adapter     │
│    • Returns Studio-compatible JSON │
└─────────────────────────────────────┘
              ↓
    ┌─────────┴──────────┐
    ↓                    ↓
PostgreSQL          Azure SQL
 Adapter             Adapter
```

## Quick Start (5 Minutes)

### Step 1: Start the Bridge Service

```typescript
// bridge-server.ts
import { AzureSQLAdapter } from './packages/database-adapters/azuresql/azuresql-adapter'
import { createStudioBridge } from './packages/studio-bridge/studio-bridge'

async function main() {
  // 1. Connect to your database
  const adapter = new AzureSQLAdapter()
  await adapter.connect({
    host: 'myserver.database.windows.net',
    port: 1433,
    database: 'mydb',
    username: 'admin',
    password: 'P@ssw0rd!'
  })
  
  // 2. Start bridge service
  const bridge = await createStudioBridge(adapter, 54321)
  bridge.listen()
}

main()
```

Run it:
```bash
ts-node bridge-server.ts
```

Output:
```
🌉 Supabase Studio Bridge running!
   Database: azuresql
   REST API: http://localhost:54321/rest/v1
   Meta API: http://localhost:54321/pg/meta

📊 Configure Supabase Studio to use:
   SUPABASE_URL=http://localhost:54321
   SUPABASE_ANON_KEY=your-anon-key
```

### Step 2: Run Supabase Studio

Option A: **Docker** (Easiest)
```bash
docker run -p 3000:3000 \
  -e SUPABASE_URL=http://host.docker.internal:54321 \
  -e SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 \
  supabase/studio:latest
```

Option B: **From Source**
```bash
# Clone Supabase
git clone https://github.com/supabase/supabase
cd supabase/apps/studio

# Install dependencies
npm install

# Configure environment
cat > .env.local << EOF
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
EOF

# Start Studio
npm run dev
```

### Step 3: Open Studio

Visit: **http://localhost:3000**

You'll see:
- ✅ Table Editor (works with any database!)
- ✅ SQL Editor (syntax adapts to your database)
- ✅ Database Schema
- ✅ API Documentation

---

## Full Setup Guide

### 1. PostgreSQL Setup

```typescript
// Use with PostgreSQL (works exactly like normal Supabase)
import { PostgreSQLAdapter } from './packages/database-adapters/postgresql/postgresql-adapter'
import { createStudioBridge } from './packages/studio-bridge/studio-bridge'

const adapter = new PostgreSQLAdapter()
await adapter.connect({
  host: 'localhost',
  port: 5432,
  database: 'postgres',
  username: 'postgres',
  password: 'password'
})

const bridge = await createStudioBridge(adapter)
bridge.listen()
```

### 2. Azure SQL Setup

```typescript
// Use with Azure SQL
import { AzureSQLAdapter } from './packages/database-adapters/azuresql/azuresql-adapter'
import { createStudioBridge } from './packages/studio-bridge/studio-bridge'

const adapter = new AzureSQLAdapter()
await adapter.connect({
  host: 'myserver.database.windows.net',
  port: 1433,
  database: 'mydb',
  username: 'admin',
  password: 'YourPassword123!',
  ssl: true // Azure SQL requires SSL
})

const bridge = await createStudioBridge(adapter)
bridge.listen()
```

### 3. MySQL Setup (Coming Soon)

```typescript
// Use with MySQL
import { MySQLAdapter } from './packages/database-adapters/mysql/mysql-adapter'
import { createStudioBridge } from './packages/studio-bridge/studio-bridge'

const adapter = new MySQLAdapter()
await adapter.connect({
  host: 'localhost',
  port: 3306,
  database: 'mydb',
  username: 'root',
  password: 'password'
})

const bridge = await createStudioBridge(adapter)
bridge.listen()
```

---

## Studio Features That Work

### ✅ **Table Editor**
- View all tables
- Browse table data
- Filter and sort rows
- Add/edit/delete rows
- See column types and constraints

### ✅ **SQL Editor**
- Write and execute queries
- Syntax highlighting (adapts to your database!)
- Query history
- Save favorite queries

### ✅ **Database Schema**
- View all tables and columns
- See relationships (foreign keys)
- Check indexes
- View functions/stored procedures

### ✅ **API Documentation**
- Auto-generated REST API docs
- See all available endpoints
- Try API calls directly

### ✅ **RLS Policies** (if supported by database)
- View existing policies
- Create new policies
- Edit/delete policies

### ⚠️ **Auth Management**
- Requires additional setup (GoTrue integration)
- Coming soon!

### ⚠️ **Storage Browser**
- Requires additional setup (Storage API integration)
- Coming soon!

---

## Docker Compose Setup (Recommended)

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  # Your database (example: Azure SQL)
  database:
    image: mcr.microsoft.com/mssql/server:2022-latest
    environment:
      ACCEPT_EULA: Y
      SA_PASSWORD: YourPassword123!
    ports:
      - "1433:1433"
  
  # Bridge service
  studio-bridge:
    build: .
    environment:
      DB_HOST: database
      DB_PORT: 1433
      DB_NAME: master
      DB_USER: sa
      DB_PASSWORD: YourPassword123!
      DB_PROVIDER: azuresql
    ports:
      - "54321:54321"
    depends_on:
      - database
  
  # Supabase Studio
  studio:
    image: supabase/studio:latest
    environment:
      SUPABASE_URL: http://studio-bridge:54321
      SUPABASE_ANON_KEY: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
    ports:
      - "3000:3000"
    depends_on:
      - studio-bridge
```

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Copy source
COPY packages/ ./packages/

# Install dependencies
RUN npm install

# Build TypeScript
RUN npm run build

# Start bridge service
CMD ["node", "dist/bridge-server.js"]
```

Create `bridge-server.ts`:

```typescript
import { AdapterRegistry } from './packages/database-adapters/core/adapter'
import { PostgreSQLAdapter } from './packages/database-adapters/postgresql/postgresql-adapter'
import { AzureSQLAdapter } from './packages/database-adapters/azuresql/azuresql-adapter'
import { createStudioBridge } from './packages/studio-bridge/studio-bridge'

// Register adapters
AdapterRegistry.register('postgresql', async (config) => {
  const adapter = new PostgreSQLAdapter()
  await adapter.connect(config)
  return adapter
})

AdapterRegistry.register('azuresql', async (config) => {
  const adapter = new AzureSQLAdapter()
  await adapter.connect(config)
  return adapter
})

async function main() {
  const provider = process.env.DB_PROVIDER || 'postgresql'
  
  const adapter = await AdapterRegistry.create(provider, {
    host: process.env.DB_HOST!,
    port: parseInt(process.env.DB_PORT!),
    database: process.env.DB_NAME!,
    username: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
  })
  
  const bridge = await createStudioBridge(adapter, 54321)
  bridge.listen()
}

main().catch(console.error)
```

Start everything:

```bash
docker-compose up
```

Visit: **http://localhost:3000** 🎉

---

## Configuration Options

### Bridge Configuration

```typescript
import { StudioBridge } from './packages/studio-bridge/studio-bridge'

const bridge = new StudioBridge({
  adapter: adapter,
  port: 54321,
  
  // Optional: Custom ports for different services
  postgrestPort: 54321,
  realtimePort: 54322,
  authPort: 54323,
  storagePort: 54324,
  
  // Optional: CORS configuration
  allowedOrigins: [
    'http://localhost:3000',  // Studio
    'http://localhost:8000',  // Your app
  ],
})

bridge.listen()
```

### Studio Configuration

Environment variables for Supabase Studio:

```bash
# Required
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=your-jwt-token

# Optional
SUPABASE_SERVICE_KEY=your-service-key
NEXT_PUBLIC_API_URL=http://localhost:54321
```

---

## Features by Database

| Feature | PostgreSQL | Azure SQL | MySQL |
|---------|-----------|-----------|-------|
| **Table Editor** | ✅ | ✅ | ✅ |
| **SQL Editor** | ✅ | ✅ (T-SQL) | ✅ |
| **Schema Viewer** | ✅ | ✅ | ✅ |
| **RLS Policies** | ✅ Native | ⚠️ Security Predicates | ❌ |
| **Functions** | ✅ PL/pgSQL | ✅ T-SQL | ✅ |
| **JSON Columns** | ✅ JSONB | ⚠️ NVARCHAR | ✅ JSON |
| **Full-Text Search** | ✅ | ✅ | ✅ |

---

## Troubleshooting

### Issue 1: Studio Can't Connect

**Symptoms:** Studio shows "Cannot connect to project"

**Solution:**
```bash
# Check bridge is running
curl http://localhost:54321/health

# Check CORS
curl -H "Origin: http://localhost:3000" http://localhost:54321/rest/v1/

# Verify environment variables
echo $SUPABASE_URL
```

### Issue 2: Tables Not Showing

**Symptoms:** Studio opens but no tables appear

**Solution:**
```bash
# Test meta endpoint
curl http://localhost:54321/pg/meta/tables?schema=public

# Check database connection
curl http://localhost:54321/pg/config
```

### Issue 3: SQL Syntax Errors

**Symptoms:** Queries fail with syntax errors

**Solution:**
- PostgreSQL: Use `$1, $2` for parameters
- Azure SQL: Use `@param0, @param1` for parameters
- MySQL: Use `?` for parameters

The bridge should translate automatically, but direct SQL queries need correct syntax.

---

## Advanced: Custom Studio Fork

For deeper integration, fork Supabase Studio:

```bash
# Clone Studio
git clone https://github.com/supabase/supabase
cd supabase/apps/studio

# Add database selector
# Edit: apps/studio/components/ui/DatabaseSelector.tsx
```

```typescript
// Add database provider selector
export function DatabaseSelector() {
  const [provider, setProvider] = useState('postgresql')
  
  return (
    <select value={provider} onChange={e => setProvider(e.target.value)}>
      <option value="postgresql">PostgreSQL</option>
      <option value="azuresql">Azure SQL</option>
      <option value="mysql">MySQL</option>
    </select>
  )
}
```

---

## Production Deployment

### 1. Deploy Bridge Service

```bash
# Build
npm run build

# Deploy to your server
pm2 start dist/bridge-server.js --name studio-bridge

# Or use Docker
docker build -t studio-bridge .
docker run -d -p 54321:54321 studio-bridge
```

### 2. Deploy Studio

```bash
# Build Studio
cd supabase/apps/studio
npm run build

# Deploy static files
npm run export
# Upload to S3, Netlify, Vercel, etc.
```

### 3. Configure for Production

```bash
# Production environment variables
SUPABASE_URL=https://api.yourdomain.com
SUPABASE_ANON_KEY=your-production-jwt
```

---

## Summary

✅ **What Works:**
- Full Supabase Studio UI
- Table Editor with any database
- SQL Editor with syntax adaptation
- Schema introspection
- API documentation
- RLS policy management

⚠️ **Limitations:**
- Auth management requires GoTrue integration
- Storage browser requires Storage API integration
- Some database-specific features may differ

🚀 **Next Steps:**
1. Start bridge service with your database
2. Run Supabase Studio
3. Connect and use Studio normally!

---

**The key insight:** Supabase Studio is just a UI that talks to APIs. By implementing those APIs with our bridge service, Studio works with ANY database! 🎉
