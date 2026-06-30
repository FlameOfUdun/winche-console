using SampleHost;
using Winche.Console;
using Winche.Database.DependencyInjection;
using Winche.Storage.DependencyInjection;
using Winche.Storage.Interfaces;

var builder = WebApplication.CreateBuilder(args);
var wincheConn = builder.Configuration["Winche:ConnectionString"]
    ?? throw new InvalidOperationException("Winche:ConnectionString is required.");

builder.Services.AddWincheDatabase(cfg => cfg.ConnectionString = wincheConn);
builder.Services.AddWincheStorage(opts => opts.ConnectionString = wincheConn);
builder.Services.AddSingleton<IArchive, NoOpArchive>();

if (string.Equals(builder.Configuration["Console:Provider"], "Keycloak", StringComparison.OrdinalIgnoreCase))
{
    // The console takes explicit values; the host reads its own config and passes them in.
    builder.Services.AddWincheConsole(o => o.UseKeycloak(k =>
    {
        k.Server = builder.Configuration["Keycloak:Server"];
        k.Realm = builder.Configuration["Keycloak:Realm"];
        k.ClientId = builder.Configuration["Keycloak:Resource"];
    }));
}
else
{
    var authConn = builder.Configuration["Console:ConnectionString"]
        ?? throw new InvalidOperationException("Console:ConnectionString is required.");
    builder.Services.AddWincheConsole(o => o.ConnectionString = authConn);   // no seed: tests use /setup
}

var app = builder.Build();

await app.InitializeWincheDatabaseAsync();
await app.InitializeWincheStorageAsync();

app.MapWincheConsole("/_console");

app.Run();

public partial class Program { }
