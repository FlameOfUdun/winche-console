using Winche.Console;
using Winche.Console.Sample;
using Winche.Database.DependencyInjection;
using Winche.Storage.DependencyInjection;
using Winche.Storage.S3.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration["Winche:ConnectionString"]
    ?? throw new InvalidOperationException("Set Winche:ConnectionString (see appsettings.json).");

builder.Services.AddWincheDatabase(cfg => cfg.ConnectionString = connectionString);
builder.Services.AddWincheStorage(opts =>
{
    opts.ConnectionString = connectionString;
    opts.UseS3Archive(s3 =>
    {
        s3.BucketName = builder.Configuration["Storage:Bucket"] ?? "winche-sample";
        s3.ServiceUrl = builder.Configuration["Storage:ServiceUrl"] ?? "http://localhost:9000";
        s3.AccessKey = builder.Configuration["Storage:AccessKey"] ?? "minioadmin";
        s3.SecretKey = builder.Configuration["Storage:SecretKey"] ?? "minioadmin";
        s3.RegionName = "us-east-1";
        s3.ForcePathStyle = true;   // required for MinIO
    });
});

builder.Services.AddWincheConsole(o =>
{
    o.ConnectionString = connectionString;
    o.SeedAdminEmail = "admin@winche.local";
    o.SeedAdminPassword = "Admin123!";

    o.UseDatabaseRulesEditor();
    o.UseStorageRulesEditor();
});

var app = builder.Build();

await app.InitializeWincheDatabaseAsync();
await app.InitializeWincheStorageAsync();
await SampleData.SeedAsync(app.Services);

app.MapGet("/", () => Results.Redirect("/_console"));

app.MapWincheConsole("/_console");

app.Run();
