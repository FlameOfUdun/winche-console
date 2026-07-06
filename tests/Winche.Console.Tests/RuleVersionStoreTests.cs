using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Time.Testing;
using Winche.Console.Rules;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>
/// Unit tests for <see cref="RuleVersionStore"/> append-only versioning semantics, exercised against a
/// real relational provider (Sqlite in-memory) so transactions and the unique (Subsystem, Version) index
/// behave the same as they will under Npgsql.
/// </summary>
public sealed class RuleVersionStoreTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly ConsoleRulesDbContext _dbContext;
    private readonly FakeTimeProvider _timeProvider;
    private readonly RuleVersionStore _store;

    public RuleVersionStoreTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<ConsoleRulesDbContext>()
            .UseSqlite(_connection)
            .Options;

        _dbContext = new ConsoleRulesDbContext(options);
        _dbContext.Database.EnsureCreated();

        _timeProvider = new FakeTimeProvider(new DateTimeOffset(2026, 7, 5, 12, 0, 0, TimeSpan.Zero));
        _store = new RuleVersionStore(_dbContext, _timeProvider);
    }

    public void Dispose()
    {
        _dbContext.Dispose();
        _connection.Dispose();
    }

    [Fact]
    public async Task FirstAppend_IsVersion1AndActive()
    {
        var result = await _store.AppendAsync("database", "{}", "initial", "alice@example.com", null, null);

        Assert.Equal(1, result.Version);
        Assert.True(result.IsActive);
        Assert.Equal("database", result.Subsystem);
        Assert.Equal("initial", result.Note);
        Assert.Equal("alice@example.com", result.CreatedBy);
        Assert.Null(result.RevertedFromVersion);
        Assert.Equal(_timeProvider.GetUtcNow(), result.CreatedAtUtc);
    }

    [Fact]
    public async Task SecondAppend_IsVersion2ActiveAndDeactivatesVersion1()
    {
        var v1 = await _store.AppendAsync("database", "{\"v\":1}", null, null, null, null);
        var v2 = await _store.AppendAsync("database", "{\"v\":2}", null, null, null, expectedActiveVersion: v1.Version);

        Assert.Equal(2, v2.Version);
        Assert.True(v2.IsActive);

        var reloadedV1 = await _store.GetAsync("database", 1);
        Assert.NotNull(reloadedV1);
        Assert.False(reloadedV1!.IsActive);

        var active = await _store.GetActiveAsync("database");
        Assert.NotNull(active);
        Assert.Equal(2, active!.Version);
    }

    [Fact]
    public async Task ListAsync_ReturnsNewestFirst()
    {
        await _store.AppendAsync("database", "{\"v\":1}", null, null, null, null);
        await _store.AppendAsync("database", "{\"v\":2}", null, null, null, 1);
        await _store.AppendAsync("database", "{\"v\":3}", null, null, null, 2);

        var list = await _store.ListAsync("database");

        Assert.Equal(3, list.Count);
        Assert.Equal([3, 2, 1], list.Select(r => r.Version));
    }

    [Fact]
    public async Task GetAsync_And_GetActiveAsync_ReturnExpectedRows()
    {
        await _store.AppendAsync("database", "{\"v\":1}", null, null, null, null);
        await _store.AppendAsync("database", "{\"v\":2}", null, null, null, 1);

        var v1 = await _store.GetAsync("database", 1);
        Assert.NotNull(v1);
        Assert.Equal("{\"v\":1}", v1!.RulesJson);

        var missing = await _store.GetAsync("database", 99);
        Assert.Null(missing);

        var active = await _store.GetActiveAsync("database");
        Assert.NotNull(active);
        Assert.Equal(2, active!.Version);
    }

    [Fact]
    public async Task RevertStyleAppend_RecordsRevertedFromVersion()
    {
        var v1 = await _store.AppendAsync("database", "{\"v\":1}", "first", null, null, null);
        await _store.AppendAsync("database", "{\"v\":2}", "second", null, null, v1.Version);

        var reverted = await _store.AppendAsync(
            "database",
            v1.RulesJson,
            "revert to v1",
            "bob@example.com",
            revertedFromVersion: v1.Version,
            expectedActiveVersion: 2);

        Assert.Equal(3, reverted.Version);
        Assert.True(reverted.IsActive);
        Assert.Equal(1, reverted.RevertedFromVersion);
        Assert.Equal(v1.RulesJson, reverted.RulesJson);
    }

    [Fact]
    public async Task AppendAsync_WithStaleExpectedActiveVersion_ThrowsConflict()
    {
        await _store.AppendAsync("database", "{\"v\":1}", null, null, null, null);
        await _store.AppendAsync("database", "{\"v\":2}", null, null, null, 1);

        var ex = await Assert.ThrowsAsync<RuleVersionConflictException>(
            () => _store.AppendAsync("database", "{\"v\":3}", null, null, null, expectedActiveVersion: 1));

        Assert.Equal("database", ex.Subsystem);
        Assert.Equal(1, ex.ExpectedActiveVersion);
        Assert.Equal(2, ex.ActualActiveVersion);

        // No new row should have been written.
        var list = await _store.ListAsync("database");
        Assert.Equal(2, list.Count);
    }

    [Fact]
    public async Task AppendAsync_WithExpectedActiveVersionWhenNoneExists_ThrowsConflict()
    {
        await _store.AppendAsync("database", "{\"v\":1}", null, null, null, null);

        var ex = await Assert.ThrowsAsync<RuleVersionConflictException>(
            () => _store.AppendAsync("other-subsystem", "{}", null, null, null, expectedActiveVersion: 1));

        Assert.Equal("other-subsystem", ex.Subsystem);
        Assert.Equal(1, ex.ExpectedActiveVersion);
        Assert.Null(ex.ActualActiveVersion);
    }

    [Fact]
    public async Task TwoSubsystems_KeepIndependentVersionSequences()
    {
        await _store.AppendAsync("database", "{\"v\":1}", null, null, null, null);
        await _store.AppendAsync("database", "{\"v\":2}", null, null, null, 1);

        var storageV1 = await _store.AppendAsync("storage", "{\"s\":1}", null, null, null, null);

        Assert.Equal(1, storageV1.Version);

        var databaseActive = await _store.GetActiveAsync("database");
        var storageActive = await _store.GetActiveAsync("storage");

        Assert.NotNull(databaseActive);
        Assert.Equal(2, databaseActive!.Version);
        Assert.NotNull(storageActive);
        Assert.Equal(1, storageActive!.Version);

        var databaseList = await _store.ListAsync("database");
        var storageList = await _store.ListAsync("storage");
        Assert.Equal(2, databaseList.Count);
        Assert.Single(storageList);
    }
}
