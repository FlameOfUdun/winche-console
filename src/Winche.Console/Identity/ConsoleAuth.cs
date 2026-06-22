using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Options;

namespace Winche.Console.Identity;

internal static class ConsoleAuth
{
    /// <summary>
    /// Registers the console's Identity stack: EF stores, UserManager/SignInManager, the Identity cookie
    /// schemes (by their standard constant names, cookie named "WincheConsole") WITHOUT changing the host's
    /// default scheme, and the three role policies. The host's own auth is untouched.
    /// </summary>
    public static IServiceCollection AddConsoleIdentity(this IServiceCollection services, ConsoleOptions options)
    {
        services.AddDbContext<ConsoleIdentityDbContext>(o => o.UseNpgsql(options.ConnectionString));

        services.AddIdentityCore<ConsoleUser>(o =>
            {
                o.Password.RequiredLength = 8;
                o.Password.RequireNonAlphanumeric = false;
                o.User.RequireUniqueEmail = true;
                o.SignIn.RequireConfirmedAccount = false;
                o.Lockout.MaxFailedAccessAttempts = 5;
            })
            .AddRoles<IdentityRole<Guid>>()
            .AddEntityFrameworkStores<ConsoleIdentityDbContext>()
            .AddSignInManager()
            .AddDefaultTokenProviders();

        // Add the Identity cookie schemes WITHOUT calling AddIdentity (which would set them as the host
        // default). SignInManager uses these constant scheme names internally. Register all four so the
        // (Phase 3) two-factor flow has its schemes; only the application cookie carries a custom name.
        services.AddAuthentication()
            .AddCookie(IdentityConstants.ApplicationScheme, o =>
            {
                o.Cookie.Name = "WincheConsole";
                o.Cookie.HttpOnly = true;
                o.Cookie.SameSite = SameSiteMode.Lax;
                o.ExpireTimeSpan = TimeSpan.FromDays(7);
                o.SlidingExpiration = true;
                // API semantics: status codes, not redirects.
                o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
                o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
            })
            .AddCookie(IdentityConstants.ExternalScheme)
            .AddCookie(IdentityConstants.TwoFactorUserIdScheme)
            .AddCookie(IdentityConstants.TwoFactorRememberMeScheme);

        services.AddAuthorizationBuilder()
            .AddPolicy(ConsoleRoles.ViewerPolicy, p => p
                .AddAuthenticationSchemes(IdentityConstants.ApplicationScheme)
                .RequireRole(ConsoleRoles.Viewer, ConsoleRoles.Member, ConsoleRoles.Admin))
            .AddPolicy(ConsoleRoles.MemberPolicy, p => p
                .AddAuthenticationSchemes(IdentityConstants.ApplicationScheme)
                .RequireRole(ConsoleRoles.Member, ConsoleRoles.Admin))
            .AddPolicy(ConsoleRoles.AdminPolicy, p => p
                .AddAuthenticationSchemes(IdentityConstants.ApplicationScheme)
                .RequireRole(ConsoleRoles.Admin));

        return services;
    }
}
