using Winche.Console;
using Winche.Console.Sample;
using Winche.Database.DependencyInjection;
using Winche.Storage.DependencyInjection;
using Winche.Storage.S3.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration["Winche:ConnectionString"]
    ?? throw new InvalidOperationException("Set Winche:ConnectionString (see appsettings.json).");

// The whole integration: register the Winche cores, then add the console with its own auth DB.
builder.Services.AddWincheDatabase(cfg => cfg.ConnectionString = connectionString);
builder.Services.AddWincheStorage(opts =>
{
    opts.ConnectionString = connectionString;
    // Store objects in MinIO (S3-compatible) so file upload/download actually works (see docker-compose).
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
// This sample delegates authentication to Keycloak (see samples/docker-compose.yml + samples/keycloak).
// Keycloak owns login, MFA, and all user/role management; the console keeps no auth database. Server,
// realm, and client id come from the "Keycloak" section in appsettings.json; the Admin/Member/Viewer
// role names default to the realm roles imported by docker-compose.
//
// To use the built-in ASP.NET Core Identity provider instead, replace this call with:
//   builder.Services.AddWincheConsole(o =>
//   {
//       o.ConnectionString = builder.Configuration["Console:ConnectionString"]!;
//       o.UseEmailSender<LoggingConsoleEmailSender>();
//   });
builder.Services.AddWincheConsole(o => o.UseKeycloak(k =>
{
    // The console takes explicit settings — read them from this app's own config and pass them in.
    k.Server = builder.Configuration["Keycloak:Server"];
    k.Realm = builder.Configuration["Keycloak:Realm"];
    k.ClientId = builder.Configuration["Keycloak:Resource"];

    // Dev sample only: Keycloak runs over plain HTTP on localhost. In production serve Keycloak over
    // HTTPS and drop this line (it defaults to true).
    k.RequireHttpsMetadata = false;
}));

var app = builder.Build();

// Create the schema (winche_documents / winche_files) and seed demo data on first run.
await app.InitializeWincheDatabaseAsync();
await app.InitializeWincheStorageAsync();
await SampleData.SeedAsync(app.Services);

app.MapGet("/", () => Results.Redirect("/_console"));

// Mount the console. It protects its own endpoints with the Admin/Member/Viewer roles — open /_console
// and sign in with Keycloak (the imported realm seeds an "admin"/"admin" user with the Admin role).
app.MapWincheConsole("/_console");

app.Run();
