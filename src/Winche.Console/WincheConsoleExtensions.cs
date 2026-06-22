using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Api;
using Winche.Console.Email;
using Winche.Console.Identity;
using Winche.Console.Options;
using Winche.Console.Spa;

namespace Winche.Console;

/// <summary>
/// Attaches the Winche admin console to a host app that has already registered Winche.Database and
/// Winche.Storage. The console brings its own authentication (EF Core + ASP.NET Core Identity): supply
/// a connection string for its auth database; it protects its own endpoints with Admin/Member/Viewer
/// roles. No host auth wiring is needed.
/// </summary>
public static class WincheConsoleExtensions
{
    public static IServiceCollection AddWincheConsole(this IServiceCollection services, Action<ConsoleOptions> configure)
    {
        var options = new ConsoleOptions();
        configure(options);
        if (string.IsNullOrWhiteSpace(options.ConnectionString))
            throw new InvalidOperationException(
                "AddWincheConsole requires ConsoleOptions.ConnectionString (the console's own auth database).");

        services.AddSingleton(options);
        services.AddSingleton<ConsolePrefix>();
        services.AddConsoleIdentity(options);
        services.AddHostedService<ConsoleStartupService>();
        return services;
    }

    public static IEndpointConventionBuilder MapWincheConsole(
        this IEndpointRouteBuilder endpoints, string prefix = "/_console")
    {
        endpoints.ServiceProvider.GetRequiredService<ConsolePrefix>().Value = prefix;
        var group = endpoints.MapGroup(prefix);

        // Forced two-factor setup gate: a user the admin marked TwoFactorRequired who has not yet enrolled
        // is allowed only to log out, view state, edit profile, and finish enrolling — everything else 403s.
        group.AddEndpointFilter(async (ctx, next) =>
        {
            var http = ctx.HttpContext;
            if (http.User.Identity?.IsAuthenticated == true)
            {
                var users = http.RequestServices.GetRequiredService<UserManager<ConsoleUser>>();
                var user = await users.GetUserAsync(http.User);
                if (user is { TwoFactorRequired: true, TwoFactorEnabled: false } && !IsTwoFactorSetupExempt(http.Request.Path))
                    return Results.Json(new { error = "two_factor_setup_required" }, statusCode: StatusCodes.Status403Forbidden);
            }
            return await next(ctx);
        });

        group.MapAuthEndpoints();
        group.MapTwoFactorEndpoints();
        group.MapUserEndpoints();
        group.MapConsoleDataEndpoints();
        group.MapConsoleStorageEndpoints();
        group.MapConsoleUsageEndpoints();
        ConsoleSpa.Map(group, prefix);
        return group;
    }

    private static bool IsTwoFactorSetupExempt(PathString path)
    {
        var p = path.Value ?? "";
        return p.EndsWith("/api/auth/logout", StringComparison.OrdinalIgnoreCase)
            || p.EndsWith("/api/auth/profile", StringComparison.OrdinalIgnoreCase)
            || p.EndsWith("/api/auth/2fa/setup", StringComparison.OrdinalIgnoreCase)
            || p.EndsWith("/api/auth/2fa/enable", StringComparison.OrdinalIgnoreCase);
    }
}
