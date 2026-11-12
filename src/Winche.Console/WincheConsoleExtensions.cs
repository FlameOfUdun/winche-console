using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Winche.Console.Api;
using Winche.Console.Diagnostics;
using Winche.Console.Email;
using Winche.Console.Identity;
using Winche.Console.Logs;
using Winche.Console.Options;
using Winche.Console.Rules;
using Winche.Console.Spa;
using Winche.Console.Tabs;
using Winche.Database.Constants;
using Winche.Database.Runtime;
using Winche.Storage.Constants;
using Winche.Storage.Services;

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

        services.AddSingleton(options);
        options.EmailSenderRegistration?.Invoke(services);
        services.AddSingleton<ConsolePrefix>();

        services.AddSingleton<TabRegistry>();
        foreach (var providerType in options.Tabs.SelectMany(t => t.ProviderTypes).Distinct())
            services.TryAddScoped(providerType);

        services.TryAddSingleton(TimeProvider.System);
        if (options.DatabaseRulesEditor is not null || options.StorageRulesEditor is not null)
        {
            // The versioned rules store reuses the console's connection string (a dedicated table, never
            // the identity tables). Mandatory whenever any rules editor is enabled — including Keycloak
            // mode, where ConnectionString is otherwise unused.
            if (string.IsNullOrWhiteSpace(options.ConnectionString))
                throw new InvalidOperationException(
                    "Enabling the rules editor (UseDatabaseRulesEditor/UseStorageRulesEditor) requires ConsoleOptions.ConnectionString — the versioned rules store reuses it.");

            services.AddSingleton(new RuleStoreFactory(options.ConnectionString));
            services.AddHostedService<ConsoleRulesStartupService>();
            services.AddHostedService<ConsoleRulesSyncService>();

            if (options.DatabaseRulesEditor is not null)
            {
                services.AddSingleton(new RuleSubsystemRegistration(
                    RuleSubsystems.Database,
                    WincheDatabaseKeys.RuleEngine,
                    options.DatabaseRulesEditor.ApplyPersistedRulesOnStartup,
                    options.DatabaseRulesEditor.SyncInterval));
            }

            if (options.StorageRulesEditor is not null)
            {
                services.AddSingleton(new RuleSubsystemRegistration(
                    RuleSubsystems.Storage,
                    WincheStorageKeys.RULE_ENGINE_KEY,
                    options.StorageRulesEditor.ApplyPersistedRulesOnStartup,
                    options.StorageRulesEditor.SyncInterval));
            }
        }

        if (options.AnyLogs)
        {
            if (string.IsNullOrWhiteSpace(options.ConnectionString))
                throw new InvalidOperationException(
                    "The Logs tab (AddLogsTab / UseLogs) requires ConsoleOptions.ConnectionString — the entries are kept in the console's database.");
            var prefixes = new List<string>();
            if (options.DatabaseTab?.Logs == true) prefixes.Add(ConsoleLogsEndpoints.DatabaseScope);
            if (options.StorageTab?.Logs == true) prefixes.Add(ConsoleLogsEndpoints.StorageScope);
            services.AddSingleton(new ConsoleLogQueue(options.Logs, options.AppLogsTab, prefixes));
            services.AddSingleton(new ConsoleLogStore(options.ConnectionString, options.Logs));
            services.AddSingleton<Microsoft.Extensions.Logging.ILoggerProvider, ConsoleLoggerProvider>();
            // The console's collector receives every level whatever the host's filters say (so a source can be set
            // to Debug from the console without changing what reaches the app's other log outputs); it then keeps
            // only what the levels set in code or in the console allow.
            services.Configure<Microsoft.Extensions.Logging.LoggerFilterOptions>(o =>
                Microsoft.Extensions.Logging.FilterLoggingBuilderExtensions.AddFilter<ConsoleLoggerProvider>(o, null, Microsoft.Extensions.Logging.LogLevel.Trace));
            services.AddHostedService<ConsoleLogWriter>();
        }

        if (options.Provider == ConsoleAuthProvider.Keycloak)
        {
            services.AddConsoleKeycloak(options);
        }
        else
        {
            if (string.IsNullOrWhiteSpace(options.ConnectionString))
                throw new InvalidOperationException(
                    "AddWincheConsole requires ConsoleOptions.ConnectionString (the console's own auth database).");
            services.AddConsoleIdentity(options);
            services.AddHostedService<ConsoleStartupService>();
        }

        return services;
    }

    public static IEndpointConventionBuilder MapWincheConsole(
        this IEndpointRouteBuilder endpoints, string prefix = "/_console")
    {
        endpoints.ServiceProvider.GetRequiredService<ConsolePrefix>().Value = prefix;
        var options = endpoints.ServiceProvider.GetRequiredService<ConsoleOptions>();
        var group = endpoints.MapGroup(prefix);

        // Surface the most common deployment mistake (behind a TLS-terminating proxy without
        // UseForwardedHeaders -> cookie/OIDC login 401s) as one actionable log line. Logs once.
        group.AddEndpointFilter(async (ctx, next) =>
        {
            ForwardedHeadersDiagnostic.Inspect(ctx.HttpContext);
            return await next(ctx);
        });

        group.MapAuthConfigEndpoint(options);

        if (options.Provider == ConsoleAuthProvider.Keycloak)
        {
            group.MapKeycloakStateEndpoint(options);
        }
        else
        {
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
            group.MapInviteEndpoints();
        }

        var isService = endpoints.ServiceProvider.GetService<IServiceProviderIsService>();
        if (options.DatabaseTab is { } databaseTab)
        {
            if (isService?.IsService(typeof(DocumentDatabase)) == false)
                throw new InvalidOperationException(
                    "AddDatabaseTab() requires AddWincheDatabase() — the Database tab browses the document store.");
            group.MapConsoleDataEndpoints(databaseTab.MinRole);
        }
        if (options.StorageTab is { } storageTab)
        {
            if (isService?.IsService(typeof(FileStorage)) == false)
                throw new InvalidOperationException(
                    "AddStorageTab() requires AddWincheStorage() — the Storage tab browses the file store.");
            group.MapConsoleStorageEndpoints(storageTab.MinRole);
        }
        if (options.DatabaseRulesEditor is not null || options.StorageRulesEditor is not null)
        {
            group.MapConsoleRulesEndpoints();
        }

        if (options.AnyLogs)
        {
            group.MapConsoleLogsEndpoints(options);
        }

        var tabRegistry = endpoints.ServiceProvider.GetRequiredService<TabRegistry>();
        group.MapConsoleTabsEndpoints(tabRegistry, options);

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
