using Microsoft.EntityFrameworkCore;

namespace Winche.Console.Rules;

/// <summary>
/// EF Core-backed <see cref="IRuleVersionStore"/> over a <see cref="ConsoleRulesDbContext"/> that is
/// already bound to one subsystem's connection string. Append-only: every save inserts a new row and
/// atomically moves the "active" pointer within a single transaction.
/// </summary>
public sealed class RuleVersionStore(ConsoleRulesDbContext dbContext, TimeProvider? timeProvider = null)
    : IRuleVersionStore
{
    private readonly TimeProvider _timeProvider = timeProvider ?? TimeProvider.System;

    public async Task<RuleVersion?> GetActiveAsync(string subsystem, CancellationToken ct = default) =>
        await dbContext.RuleVersions
            .AsNoTracking()
            .SingleOrDefaultAsync(r => r.Subsystem == subsystem && r.IsActive, ct);

    public async Task<IReadOnlyList<RuleVersion>> ListAsync(string subsystem, CancellationToken ct = default) =>
        await dbContext.RuleVersions
            .AsNoTracking()
            .Where(r => r.Subsystem == subsystem)
            .OrderByDescending(r => r.Version)
            .ToListAsync(ct);

    public async Task<RuleVersion?> GetAsync(string subsystem, int version, CancellationToken ct = default) =>
        await dbContext.RuleVersions
            .AsNoTracking()
            .SingleOrDefaultAsync(r => r.Subsystem == subsystem && r.Version == version, ct);

    public async Task<RuleVersion> AppendAsync(
        string subsystem,
        string rulesJson,
        string? note,
        string? actor,
        int? revertedFromVersion,
        int? expectedActiveVersion,
        CancellationToken ct = default)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(ct);

        var currentActive = await dbContext.RuleVersions
            .SingleOrDefaultAsync(r => r.Subsystem == subsystem && r.IsActive, ct);

        if (expectedActiveVersion is not null && expectedActiveVersion != currentActive?.Version)
        {
            throw new RuleVersionConflictException(subsystem, expectedActiveVersion, currentActive?.Version);
        }

        var maxVersion = await dbContext.RuleVersions
            .Where(r => r.Subsystem == subsystem)
            .Select(r => (int?)r.Version)
            .MaxAsync(ct);

        var newVersion = new RuleVersion
        {
            Id = Guid.NewGuid(),
            Subsystem = subsystem,
            Version = (maxVersion ?? 0) + 1,
            RulesJson = rulesJson,
            IsActive = true,
            Note = note,
            CreatedAtUtc = _timeProvider.GetUtcNow(),
            CreatedBy = actor,
            RevertedFromVersion = revertedFromVersion,
        };

        if (currentActive is not null)
        {
            currentActive.IsActive = false;
        }

        dbContext.RuleVersions.Add(newVersion);

        await dbContext.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return newVersion;
    }
}
