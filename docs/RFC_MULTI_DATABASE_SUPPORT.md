# RFC: Multi-Database Support for Supabase

**Status:** Draft  
**Author:** Supabase Community  
**Created:** 2025-10-22  
**Last Updated:** 2025-10-22

## Executive Summary

This RFC proposes adding multi-database support to Supabase through a database adapter architecture, allowing users to choose between PostgreSQL, Azure SQL, MySQL, and other databases while maintaining a unified API interface. This would expand Supabase's addressable market, enable enterprise adoption in regulated industries, and position Supabase as the leading database-agnostic BaaS platform.

## Background

### Current State

Supabase is currently tightly coupled to PostgreSQL:
- PostgREST generates REST APIs directly from PostgreSQL schemas
- Realtime uses PostgreSQL's logical replication
- Auth (GoTrue) queries PostgreSQL directly
- Storage uses PostgreSQL for metadata
- Row-Level Security (RLS) relies on PostgreSQL's native implementation

### Motivation

1. **Enterprise Requirements**: Many organizations are locked into Azure SQL, Oracle, or other databases due to compliance, existing infrastructure, or vendor agreements.

2. **Market Expansion**: Supporting multiple databases opens Supabase to:
   - Azure-first organizations (Fortune 500, government)
   - AWS-first organizations considering Aurora MySQL
   - Companies with existing database investments

3. **Competitive Advantage**: No major BaaS platform offers true database-agnostic functionality. This would be a unique differentiator.

4. **Migration Path**: Easier migration from competitors (Firebase → Supabase, Parse → Supabase) if users can keep their existing database.

5. **Cost Optimization**: Users could choose the most cost-effective database for their needs (e.g., Azure SQL Basic tier vs RDS PostgreSQL).

## Proposal

### Architecture: Database Adapter Layer

Introduce a `DatabaseAdapter` interface that all database implementations must satisfy. Supabase components would code against this interface rather than PostgreSQL directly.

```typescript
interface DatabaseAdapter {
  // Core operations
  query(sql: string, params?: any[]): Promise<QueryResult>
  transaction(callback: TransactionCallback): Promise<void>
  
  // Schema introspection
  getSchema(): Promise<SchemaInfo>
  getTables(): Promise<TableInfo[]>
  
  // Security
  applySecurityPolicy(policy: SecurityPolicy): Promise<void>
  
  // Realtime
  subscribeToChanges(tables: string[], callback: ChangeCallback): Subscription
  
  // Capabilities
  readonly capabilities: DatabaseCapabilities
}
```

### Component Modifications

#### 1. PostgREST → Universal REST Generator

Replace PostgREST with a database-agnostic REST API generator that:
- Introspects any database schema
- Generates OpenAPI specs
- Handles query parameters (filtering, sorting, pagination)
- Supports all HTTP methods (GET, POST, PATCH, DELETE)
- Maintains backward compatibility with PostgREST API

**Implementation:**
- New package: `@supabase/rest-api`
- Can still use PostgREST for PostgreSQL (no breaking changes)
- New generators for Azure SQL, MySQL, etc.

#### 2. Realtime: Abstracted Change Streams

Modify `@supabase/realtime` to support multiple change tracking mechanisms:

| Database | Technology | Latency |
|----------|-----------|---------|
| PostgreSQL | Logical Replication | ~10ms |
| Azure SQL | Change Data Capture (CDC) | ~200ms |
| MySQL | Binlog | ~50ms |
| SQL Server | CDC | ~200ms |

**Implementation:**
- Polling-based CDC for databases without native replication
- Configurable polling intervals (100-1000ms)
- Same WebSocket protocol for all databases

#### 3. Auth (GoTrue): Database Abstraction

Update GoTrue to use adapter pattern:
- SQL query generation per dialect
- Schema migrations per database
- Auth tokens remain database-agnostic (JWT)

#### 4. Storage API: Metadata Abstraction

Storage API changes:
- Use adapter for metadata queries
- Keep S3/Azure Blob/GCS as-is (unchanged)
- RLS enforcement through adapter

#### 5. Studio: Multi-Database UI

Studio modifications:
- Database provider selector in project setup
- Syntax highlighting per dialect (PostgreSQL/T-SQL/MySQL)
- Different schema editors for different capabilities
- RLS vs Security Predicates UI

#### 6. CLI: Database Selection

CLI enhancements:
```bash
supabase init

? Select database provider:
  > PostgreSQL 15
    Azure SQL
    MySQL 8
    CockroachDB
    
? Connection string: postgresql://localhost/mydb

✓ Project initialized with PostgreSQL adapter
```

### Feature Parity Matrix

| Feature | PostgreSQL | Azure SQL | MySQL | Priority |
|---------|-----------|-----------|--------|----------|
| REST API | ✅ Native | ✅ Generated | ✅ Generated | P0 |
| Auth | ✅ | ✅ | ✅ | P0 |
| Realtime | ✅ ~10ms | ✅ ~200ms | ✅ ~50ms | P0 |
| RLS | ✅ Native | ⚠️ Security Predicates | ⚠️ Middleware | P0 |
| Storage | ✅ | ✅ | ✅ | P0 |
| Functions | ✅ PL/pgSQL | ⚠️ T-SQL | ⚠️ Different | P1 |
| Vector Search | ✅ pgvector | ❌ Azure AI Search | ❌ | P2 |
| Full-Text Search | ✅ Native | ✅ Native | ✅ Native | P1 |
| Extensions | ✅ Many | ❌ None | ⚠️ Limited | P2 |

Legend:
- ✅ Full support
- ⚠️ Partial support / Different approach
- ❌ Not supported

### Migration Strategy

#### Phase 1: Core Adapters (Months 1-3)
- Adapter interface definition
- PostgreSQL adapter (wraps existing code)
- Azure SQL adapter
- Basic REST API generator
- CLI database selection

**Deliverable:** Users can create new projects with Azure SQL

#### Phase 2: Feature Parity (Months 4-6)
- Auth integration
- Storage integration
- Realtime (CDC-based)
- Studio multi-database support

**Deliverable:** Full Supabase experience on Azure SQL

#### Phase 3: Additional Databases (Months 7-9)
- MySQL adapter
- CockroachDB adapter
- SQL Server adapter
- Performance optimizations

**Deliverable:** Support for 5+ databases

#### Phase 4: Advanced Features (Months 10-12)
- Vector search adapters
- Advanced RLS patterns
- Multi-database projects (microservices)
- Migration tools

**Deliverable:** Enterprise-grade multi-database platform

### Backward Compatibility

**Guarantee:** Zero breaking changes for existing PostgreSQL users.

- Existing projects continue using PostgreSQL
- PostgREST remains available
- All PostgreSQL features unchanged
- New projects can choose database

**Migration Path:**
```bash
# Existing project
supabase start  # Uses PostgreSQL (default)

# New project with Azure SQL
supabase init --db azuresql
supabase start

# Migrate existing project
supabase db migrate --to azuresql
```

## Implementation Plan

### Repository Structure

```
supabase/
├── packages/
│   ├── database-adapters/
│   │   ├── core/               # Interface definitions
│   │   ├── postgresql/         # PostgreSQL implementation
│   │   ├── azuresql/          # Azure SQL implementation
│   │   ├── mysql/             # MySQL implementation
│   │   └── cockroachdb/       # CockroachDB implementation
│   ├── rest-api/              # Universal REST generator
│   ├── realtime/              # Modified for adapters
│   ├── gotrue/                # Modified for adapters
│   ├── storage-api/           # Modified for adapters
│   └── studio/                # Multi-database UI
└── docker/
    ├── postgres/
    ├── azuresql/
    └── mysql/
```

### Testing Strategy

1. **Unit Tests**: Each adapter individually
2. **Integration Tests**: Full stack with each database
3. **Compatibility Tests**: Same API across all databases
4. **Performance Tests**: Benchmark each adapter
5. **Migration Tests**: PostgreSQL → Azure SQL, etc.

**Test Coverage Goal:** 90%+

### Documentation Requirements

1. **User Docs:**
   - Database selection guide
   - Feature comparison matrix
   - Migration guides
   - Best practices per database

2. **Developer Docs:**
   - Adapter API reference
   - Creating custom adapters
   - Dialect differences
   - Performance tuning

3. **Examples:**
   - Sample projects for each database
   - Migration scripts
   - Docker Compose configs

## Benefits

### For Users

1. **Choice:** Select the best database for their needs
2. **Flexibility:** Not locked into PostgreSQL
3. **Cost:** Use cheaper database tiers
4. **Compliance:** Meet regulatory requirements (e.g., Azure Gov Cloud)
5. **Migration:** Easier to adopt Supabase

### For Supabase

1. **Market Expansion:** Address enterprise customers
2. **Competitive Advantage:** Unique positioning
3. **Revenue Growth:** Capture Azure/AWS-first companies
4. **Ecosystem:** More adapters = more community contributions
5. **Future-Proof:** Not tied to single database

### For Ecosystem

1. **Innovation:** Community can create adapters
2. **Specialization:** Database-specific optimizations
3. **Integration:** Easier to integrate with existing systems
4. **Education:** Learn Supabase with any database

## Risks & Mitigation

### Risk 1: Increased Complexity

**Risk:** More code to maintain, more edge cases.

**Mitigation:**
- Adapter interface limits surface area
- Comprehensive testing
- Start with 2-3 databases, expand gradually
- Community contributions for additional adapters

### Risk 2: Feature Gaps

**Risk:** Some databases can't match PostgreSQL features.

**Mitigation:**
- Clear feature matrix in docs
- Capability detection in code
- Graceful degradation
- Alternative implementations (e.g., middleware auth)

### Risk 3: Performance Variations

**Risk:** CDC polling slower than replication.

**Mitigation:**
- Document performance characteristics
- Tunable polling intervals
- Optimization per database
- Performance benchmarks in docs

### Risk 4: Split Development Resources

**Risk:** Slower PostgreSQL feature development.

**Mitigation:**
- PostgreSQL remains default and primary
- Adapter work doesn't block PostgreSQL features
- Community can contribute adapters
- Enterprise tier for official adapter support

## Success Metrics

### Adoption Metrics
- % of new projects using non-PostgreSQL databases
- Number of Azure SQL projects created
- Enterprise customers using multi-database

### Technical Metrics
- Adapter test coverage > 90%
- API compatibility > 99%
- Performance within 2x of native PostgreSQL

### Business Metrics
- Increase in enterprise deals
- Revenue from Azure/AWS-first customers
- Reduction in "PostgreSQL-only" lost deals

## Alternatives Considered

### Alternative 1: Fork Supabase for Each Database

**Rejected because:**
- Massive duplication of effort
- Diverging codebases
- No unified ecosystem
- Maintenance nightmare

### Alternative 2: PostgreSQL Protocol Translation

**Rejected because:**
- Too complex (protocol emulation)
- High latency
- Incomplete support
- Still limited to PostgreSQL features

### Alternative 3: Database-Specific Forks

**Rejected because:**
- Fragments community
- No cross-database learnings
- Marketing confusion
- Maintenance burden

### Alternative 4: Status Quo (PostgreSQL Only)

**Rejected because:**
- Excludes large enterprise market
- Competitive disadvantage
- Limits growth potential
- Doesn't solve real user problems

## Open Questions

1. **Licensing:** Should adapters be separate packages with different licenses?
2. **Hosting:** How does Supabase Cloud handle multi-database?
3. **Pricing:** Different pricing for different databases?
4. **Support:** Which databases get official support vs community?
5. **Edge Functions:** How do they work with different databases?

## Timeline

| Phase | Timeline | Deliverable |
|-------|----------|-------------|
| RFC Review | Month 1 | Approved RFC |
| Prototype | Month 2-3 | Working PoC with PostgreSQL + Azure SQL |
| Alpha | Month 4-6 | Internal testing, CLI integration |
| Beta | Month 7-9 | Public beta, Studio integration |
| GA | Month 10-12 | General availability, docs, examples |

## References

1. PostgREST: https://postgrest.org/
2. Azure SQL RLS: https://docs.microsoft.com/sql/relational-databases/security/row-level-security
3. SQL Server CDC: https://docs.microsoft.com/sql/relational-databases/track-changes/about-change-data-capture-sql-server
4. Prisma (multi-database ORM): https://www.prisma.io/
5. Hasura (multi-database GraphQL): https://hasura.io/

## Conclusion

Multi-database support positions Supabase as the leading database-agnostic BaaS platform. Through careful architecture (adapter pattern), phased rollout, and community involvement, we can expand our addressable market while maintaining our PostgreSQL excellence and zero breaking changes for existing users.

This is an ambitious but achievable goal that aligns with Supabase's mission to make backend development accessible to everyone, regardless of their database choice.

---

## Appendix A: Code Examples

### Example 1: Using PostgreSQL Adapter

```typescript
import { PostgreSQLAdapter } from '@supabase/adapters/postgresql'

const adapter = new PostgreSQLAdapter()
await adapter.connect({ host: 'localhost', ... })

const users = await adapter.query('SELECT * FROM users')
console.log(users.rows)
```

### Example 2: Using Azure SQL Adapter

```typescript
import { AzureSQLAdapter } from '@supabase/adapters/azuresql'

const adapter = new AzureSQLAdapter()
await adapter.connect({ host: 'myserver.database.windows.net', ... })

const users = await adapter.query('SELECT * FROM users')
console.log(users.rows) // Same API!
```

### Example 3: REST API with Any Database

```typescript
import { RestAPIGenerator } from '@supabase/rest-api'

const api = new RestAPIGenerator({
  adapter: adapter, // Works with any adapter!
  basePath: '/api'
})

api.listen(3000) // Auto-generated REST endpoints
```

## Appendix B: Community Feedback

_To be filled in during RFC review process_

## Appendix C: Performance Benchmarks

_To be filled in with actual measurements_

---

**Next Steps:**
1. Share RFC with Supabase team
2. Gather community feedback
3. Refine proposal based on input
4. Create implementation plan
5. Build prototype
6. Iterate and ship!

**Questions?** Open an issue or discussion on GitHub.