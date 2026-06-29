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
builder.Services.AddWincheConsole(o =>
{
    // The console manages its own accounts/roles in this separate auth database.
    o.ConnectionString = builder.Configuration["Console:ConnectionString"]!;

    // First run: with no admin seeded, opening /_console shows the "Create the first admin" setup
    // screen (POST /api/auth/setup). To skip that and seed an admin instead, set:
    //   o.SeedAdminEmail = builder.Configuration["Console:SeedAdminEmail"];
    //   o.SeedAdminPassword = builder.Configuration["Console:SeedAdminPassword"];

    // Wire an email transport to enable self-service password reset and invites. Admins can then invite
    // users (Users -> Invites) with per-invite requirements (complete name, enroll in two-factor) and a
    // link expiry; the invitee sets their password and profile via the emailed link. This demo logs the
    // link to the app console — replace LoggingConsoleEmailSender with a real SMTP adapter in production.
    o.UseEmailSender<LoggingConsoleEmailSender>();
});

var app = builder.Build();

// Create the schema (winche_documents / winche_files) and seed demo data on first run.
await app.InitializeWincheDatabaseAsync();
await app.InitializeWincheStorageAsync();
await SampleData.SeedAsync(app.Services);

app.MapGet("/", () => Results.Redirect("/_console"));

// Mount the console. It protects its own endpoints with the Admin/Member/Viewer roles it manages —
// open /_console; on first run it asks you to create the first admin.
app.MapWincheConsole("/_console");

app.Run();
