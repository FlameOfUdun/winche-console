using SampleHost;
using Winche.Console;
using Winche.Database.DependencyInjection;
using Winche.Storage.DependencyInjection;
using Winche.Storage.Interfaces;

var builder = WebApplication.CreateBuilder(args);
var wincheConn = builder.Configuration["Winche:ConnectionString"]
    ?? throw new InvalidOperationException("Winche:ConnectionString is required.");
var authConn = builder.Configuration["Console:ConnectionString"]
    ?? throw new InvalidOperationException("Console:ConnectionString is required.");

builder.Services.AddWincheDatabase(cfg => cfg.ConnectionString = wincheConn);
builder.Services.AddWincheStorage(opts => opts.ConnectionString = wincheConn);
builder.Services.AddSingleton<IArchive, NoOpArchive>();
builder.Services.AddWincheConsole(o => o.ConnectionString = authConn);   // no seed: tests use /setup

var app = builder.Build();

await app.InitializeWincheDatabaseAsync();
await app.InitializeWincheStorageAsync();

app.MapWincheConsole("/_console");

app.Run();

public partial class Program { }
