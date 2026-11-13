using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Winche.Console.Apps;

/// <summary>One Winche service an app can use, and where it is under the server's address.</summary>
public sealed record AppSetupService(string Id, string Path, string? LivePath = null);

/// <summary>A sign-in provider an app can offer, with its public client ids.</summary>
public sealed record AppSetupProvider(string Name, string Kind, string DisplayName, IReadOnlyList<string> ClientIds);

/// <summary>
/// What an app needs to know to use this server: published at <c>GET /.well-known/winche</c> (nothing in it is
/// secret), and turned into <c>lib/winche_options.dart</c> by <c>winche configure</c> and the console's Apps page.
/// </summary>
public sealed record AppSetup(string ProjectId, string? Name, string BaseUrl, IReadOnlyList<AppSetupService> Services,
    IReadOnlyList<AppSetupProvider> Providers)
{
    /// <summary>The platforms <see cref="DartOptionsFile"/> writes when not told which.</summary>
    public static readonly IReadOnlyList<string> AllPlatforms = ["android", "ios", "macos", "web", "windows", "linux"];

    /// <summary>The setup of the server <paramref name="services"/> belongs to, reached at <paramref name="baseUrl"/>.</summary>
    public static AppSetup For(IServiceProvider services, string baseUrl, string projectId, string? name)
    {
        var isService = services.GetService<IServiceProviderIsService>();
        bool Has(Type t) => isService?.IsService(t) == true;
        var list = new List<AppSetupService>();
        if (Has(typeof(Winche.Database.Runtime.DocumentDatabase))) list.Add(new("database", "/documents/v1", "/documents/v1/ws"));
        if (Has(typeof(Winche.Storage.Services.FileStorage))) list.Add(new("storage", "/files/v1"));
        if (Has(typeof(Winche.Auth.IWincheAuth))) list.Add(new("auth", "/auth/v1"));
        if (Has(typeof(Winche.Functions.WincheFunctions))) list.Add(new("functions", "/functions/v1"));
        var providers = services.GetService<Winche.Auth.WincheAuthOptions>()?.IdentityProviders
            .Select(p => new AppSetupProvider(p.Name, p.Kind, p.DisplayName ?? p.Name, [.. p.Audiences]))
            .ToList() ?? [];
        return new AppSetup(projectId, name, baseUrl.TrimEnd('/'), list, providers);
    }

    /// <summary>The address the request came in on, behind a proxy too (with forwarded headers applied).</summary>
    public static string BaseUrlOf(HttpRequest request) => $"{request.Scheme}://{request.Host}{request.PathBase}";

    /// <summary>
    /// <c>lib/winche_options.dart</c>: a <c>DefaultWincheOptions</c> with one set of options per platform in
    /// <paramref name="platforms"/> (all of them by default) and <c>currentPlatform</c> choosing between them.
    /// A provider with one client id gets it on every platform; one with several gets a note listing them, since
    /// which belongs to which platform is the app's to say.
    /// </summary>
    public string DartOptionsFile(IEnumerable<string>? platforms = null)
    {
        var chosen = (platforms ?? AllPlatforms).Select(p => p.Trim().ToLowerInvariant()).Where(AllPlatforms.Contains).Distinct().ToList();
        if (chosen.Count == 0) chosen = [.. AllPlatforms];
        var b = new StringBuilder();
        b.Append("// Written by `winche configure` from ").Append(BaseUrl).Append(".\n");
        b.Append("// Run it again after adding a platform or a sign-in provider.\n");
        b.Append("//\n// ignore_for_file: type=lint\n");
        b.Append("import 'package:winche_flutter/winche_flutter.dart';\n\n");
        b.Append("/// Winche options for each platform this app runs on, for project `").Append(ProjectId).Append("`.\n");
        b.Append("///\n/// ```dart\n");
        b.Append("/// final app = await WincheFlutter.initializeApp(options: DefaultWincheOptions.currentPlatform);\n");
        b.Append("/// if (kDebugMode) app.useEmulator();   // `winche emulators start`\n");
        b.Append("/// ```\n");
        b.Append("abstract final class DefaultWincheOptions {\n");
        b.Append("  /// The options for the platform this runs on.\n");
        b.Append("  static WincheOptions get currentPlatform => WincheFlutter.select(\n");
        foreach (var p in chosen) b.Append("        ").Append(p).Append(": ").Append(p).Append(",\n");
        b.Append("      );\n");
        foreach (var p in chosen)
        {
            b.Append("\n  static final ").Append(p).Append(" = WincheOptions(\n");
            b.Append("    projectId: '").Append(Escape(ProjectId)).Append("',\n");
            b.Append("    baseUrl: Uri.parse('").Append(Escape(BaseUrl)).Append("'),\n");
            var single = Providers.Where(x => x.ClientIds.Count == 1).ToList();
            var several = Providers.Where(x => x.ClientIds.Count > 1).ToList();
            foreach (var x in several)
                b.Append("    // ").Append(x.Name).Append(": one of ").Append(string.Join(", ", x.ClientIds))
                 .Append(" — add this platform's to clientIds.\n");
            if (single.Count > 0)
            {
                b.Append("    clientIds: {\n");
                foreach (var x in single) b.Append("      '").Append(Escape(x.Name)).Append("': '").Append(Escape(x.ClientIds[0])).Append("',\n");
                b.Append("    },\n");
            }
            b.Append("  );\n");
        }
        b.Append("}\n");
        return b.ToString();
    }

    /// <summary>What to add to <c>main()</c>, for the console to show next to the file.</summary>
    public static string DartSnippet =>
        "import 'package:flutter/foundation.dart';\n" +
        "import 'package:winche_flutter/winche_flutter.dart';\n\n" +
        "import 'winche_options.dart';\n\n" +
        "Future<void> main() async {\n" +
        "  WidgetsFlutterBinding.ensureInitialized();\n" +
        "  final app = await WincheFlutter.initializeApp(options: DefaultWincheOptions.currentPlatform);\n" +
        "  if (kDebugMode) app.useEmulator();   // only with `winche emulators start` running\n" +
        "  runApp(const MyApp());\n" +
        "}\n";

    private static string Escape(string s) => s.Replace("\\", "\\\\").Replace("'", "\\'").Replace("$", "\\$");
}

/// <summary>Maps <c>GET /.well-known/winche</c>.</summary>
public static class AppSetupEndpoints
{
    /// <summary>
    /// Publishes <see cref="AppSetup"/> at <c>GET /.well-known/winche</c>, for <c>winche configure</c> and anyone setting
    /// up an app: the project, which services this server runs and where, and the sign-in providers' public client ids.
    /// The project comes from the console's options (<c>ProjectId</c>, <c>ProjectName</c>).
    /// </summary>
    public static IEndpointConventionBuilder MapWincheAppSetup(this IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("/.well-known/winche", (HttpContext http) =>
        {
            var options = http.RequestServices.GetService<Options.ConsoleOptions>();
            return Results.Json(AppSetup.For(http.RequestServices, AppSetup.BaseUrlOf(http.Request), options?.ProjectId ?? "winche", options?.ProjectName));
        }).AllowAnonymous();
}
