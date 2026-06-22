using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Winche.Console.Options;

namespace Winche.Console.Identity;

/// <summary>On startup: migrate the console auth DB, seed the three roles, and seed the first admin
/// (only if configured and no users exist).</summary>
internal sealed class ConsoleStartupService(IServiceProvider services, ConsoleOptions options) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var sp = scope.ServiceProvider;

        await sp.GetRequiredService<ConsoleIdentityDbContext>().Database.MigrateAsync(ct);

        var roles = sp.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        foreach (var role in ConsoleRoles.All)
            if (!await roles.RoleExistsAsync(role))
                await roles.CreateAsync(new IdentityRole<Guid>(role));

        if (!string.IsNullOrWhiteSpace(options.SeedAdminEmail) && !string.IsNullOrWhiteSpace(options.SeedAdminPassword))
        {
            var users = sp.GetRequiredService<UserManager<ConsoleUser>>();
            if (!users.Users.Any())
            {
                var user = new ConsoleUser { UserName = options.SeedAdminEmail, Email = options.SeedAdminEmail, EmailConfirmed = true, Active = true };
                var created = await users.CreateAsync(user, options.SeedAdminPassword);
                if (created.Succeeded) await users.AddToRoleAsync(user, ConsoleRoles.Admin);
            }
        }
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
