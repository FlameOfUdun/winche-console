using Microsoft.EntityFrameworkCore;

namespace Winche.Console.Rules;

/// <summary>
/// The console's rules-versioning database. One context <em>type</em> shared by both subsystems: it is
/// instantiated per enabled subsystem against that subsystem's own connection string, so the
/// <c>console_rule_versions</c> table lives in each subsystem's own database (or is shared, distinguished
/// by the <see cref="RuleVersion.Subsystem"/> column, when both point at the same connection string).
/// Completely separate from <see cref="Identity.ConsoleIdentityDbContext"/> — never depends on and never
/// creates identity tables.
/// </summary>
public sealed class ConsoleRulesDbContext(DbContextOptions<ConsoleRulesDbContext> options) : DbContext(options)
{
    public DbSet<RuleVersion> RuleVersions => Set<RuleVersion>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.Entity<RuleVersion>(e =>
        {
            e.ToTable("console_rule_versions");
            e.HasKey(r => r.Id);
            e.Property(r => r.Subsystem).IsRequired();
            e.Property(r => r.RulesJson).IsRequired();

            e.HasIndex(r => new { r.Subsystem, r.Version }).IsUnique();

            // Look up the active ("head") row for a subsystem without scanning the whole history.
            e.HasIndex(r => new { r.Subsystem, r.IsActive });
        });
    }
}
