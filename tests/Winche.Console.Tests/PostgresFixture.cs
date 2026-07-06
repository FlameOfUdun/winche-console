using Npgsql;
using Testcontainers.PostgreSql;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>One PostgreSQL container for the whole run; the single app database lives in it.</summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container =
        new PostgreSqlBuilder("postgres:17-alpine").WithDatabase("winche_app").Build();

    public string ConnectionString { get; private set; } = null!;
    public NpgsqlDataSource DataSource { get; private set; } = null!;

    /// <summary>Connection for the console's own auth database (a separate database in the same
    /// container). EF MigrateAsync creates it on first console boot.</summary>
    public string ConsoleAuthConnectionString { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();
        DataSource = NpgsqlDataSource.Create(ConnectionString);
        ConsoleAuthConnectionString =
            new NpgsqlConnectionStringBuilder(ConnectionString) { Database = "winche_console_auth" }.ConnectionString;
    }

    public async Task DisposeAsync()
    {
        await DataSource.DisposeAsync();
        await _container.DisposeAsync();
    }

    /// <summary>Clears document + file rows between tests. Tolerates a fresh container whose schema
    /// has not been created yet (the host app creates the tables on first boot), so it only truncates
    /// tables that already exist.</summary>
    public async Task ResetAsync()
    {
        await using var conn = await DataSource.OpenConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            DO $$
            DECLARE present text[];
            BEGIN
                SELECT array_agg(c) INTO present
                FROM (VALUES ('winche_documents'), ('winche_files')) AS t(c)
                WHERE to_regclass(c) IS NOT NULL;
                IF present IS NOT NULL THEN
                    EXECUTE 'TRUNCATE ' || array_to_string(present, ', ');
                END IF;
            END $$;
            """;
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>Clears console users between tests (roles are re-seeded idempotently on each console boot).
    /// No-ops if the auth database does not exist yet (no console has booted).</summary>
    public async Task ResetAuthAsync()
    {
        try
        {
            await using var conn = new NpgsqlConnection(ConsoleAuthConnectionString);
            await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                DO $$
                DECLARE present text[];
                BEGIN
                    SELECT array_agg(c) INTO present
                    FROM (VALUES ('"AspNetUsers"'), ('"AspNetUserRoles"'), ('"AspNetUserLogins"'),
                                 ('"AspNetUserClaims"'), ('"AspNetUserTokens"'), ('"Invites"')) AS t(c)
                    WHERE to_regclass(c) IS NOT NULL;
                    IF present IS NOT NULL THEN
                        EXECUTE 'TRUNCATE ' || array_to_string(present, ', ') || ' RESTART IDENTITY CASCADE';
                    END IF;
                END $$;
                """;
            await cmd.ExecuteNonQueryAsync();
        }
        catch (PostgresException ex) when (ex.SqlState == "3D000")
        {
            // Auth database does not exist yet — nothing to reset.
        }
    }

    /// <summary>Clears the rules-editor version-history table between tests. The rules store reuses the
    /// console's connection string, so the table lives in the console auth database. Tolerates a fresh
    /// container whose schema has not been created yet (the rules editor's startup service creates the
    /// table via EF migration on first console boot), and the auth database not existing yet.</summary>
    public async Task ResetRulesAsync()
    {
        try
        {
            await using var conn = new NpgsqlConnection(ConsoleAuthConnectionString);
            await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                DO $$
                BEGIN
                    IF to_regclass('console_rule_versions') IS NOT NULL THEN
                        TRUNCATE console_rule_versions;
                    END IF;
                END $$;
                """;
            await cmd.ExecuteNonQueryAsync();
        }
        catch (PostgresException ex) when (ex.SqlState == "3D000")
        {
            // Auth database does not exist yet — nothing to reset.
        }
    }
}

[CollectionDefinition("postgres")]
public sealed class PostgresCollection : ICollectionFixture<PostgresFixture>;
