using System.Diagnostics;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Winche.Console.Tests;

/// <summary>Boots the sample host (which calls AddWincheConsole) against the test container DB.</summary>
public sealed class ConsoleAppFactory(PostgresFixture fx, params (string Key, string Value)[] settings) : WebApplicationFactory<Program>
{
    /// <summary>Where slow stops are written (set WINCHE_STOP_LOG to collect them).</summary>
    private static readonly string? StopLog = Environment.GetEnvironmentVariable("WINCHE_STOP_LOG");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        // UseSetting writes straight into host configuration, so it is visible when the sample host's
        // top-level Program reads these during host build.
        builder.UseSetting("Winche:ConnectionString", fx.ConnectionString);
        builder.UseSetting("Console:ConnectionString", fx.ConsoleAuthConnectionString);
        foreach (var (key, value) in settings) builder.UseSetting(key, value);
        if (StopLog is null) return;
        builder.ConfigureServices(services =>
        {
            // Each background service, timed on the way down: which one keeps a test host from stopping?
            // Only Winche's own: wrapping ASP.NET Core's web host service breaks how the app's middleware is set up.
            static bool Ours(ServiceDescriptor d) => d.ImplementationType?.Namespace?.StartsWith("Microsoft", StringComparison.Ordinal) != true
                && d.ImplementationInstance?.GetType().Namespace?.StartsWith("Microsoft", StringComparison.Ordinal) != true;
            foreach (var d in services.Where(d => d.ServiceType == typeof(IHostedService) && Ours(d)).ToList())
            {
                services.Remove(d);
                services.AddSingleton<IHostedService>(sp => new Timed(d.ImplementationInstance as IHostedService
                    ?? d.ImplementationFactory?.Invoke(sp) as IHostedService
                    ?? (IHostedService)ActivatorUtilities.CreateInstance(sp, d.ImplementationType!)));
            }
        });
    }

    private sealed class Timed(IHostedService inner) : IHostedService
    {
        public Task StartAsync(CancellationToken ct) => inner.StartAsync(ct);

        public async Task StopAsync(CancellationToken ct)
        {
            var watch = Stopwatch.StartNew();
            try { await inner.StopAsync(ct); }
            finally
            {
                if (watch.Elapsed > TimeSpan.FromSeconds(2))
                    lock (typeof(Timed)) File.AppendAllText(StopLog!, $"{DateTime.Now:HH:mm:ss} {inner.GetType().FullName} took {watch.Elapsed.TotalSeconds:0.0} s to stop{Environment.NewLine}");
            }
        }
    }
}
