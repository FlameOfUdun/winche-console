using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Winche.Console.Identity;

/// <summary>The console's own auth database: ASP.NET Core Identity users + roles, plus pending invites.</summary>
public sealed class ConsoleIdentityDbContext(DbContextOptions<ConsoleIdentityDbContext> options)
    : IdentityDbContext<ConsoleUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<ConsoleInvite> Invites => Set<ConsoleInvite>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.Entity<ConsoleInvite>(e =>
        {
            e.HasKey(i => i.Id);
            e.Property(i => i.Email).IsRequired();
            e.Property(i => i.Role).IsRequired();
            e.HasIndex(i => i.Email);
        });
    }
}
