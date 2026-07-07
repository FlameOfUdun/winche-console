using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Winche.Storage.Services;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class ConsoleStorageApiTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync() => await fx.ResetAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private static string B64(string s) => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(s));

    private static async Task SeedAsync(ConsoleAppFactory app)
    {
        // Seed a file record via the host's unguarded FileStorage core (NoOpArchive; metadata only).
        using var scope = app.Services.CreateScope();
        var files = scope.ServiceProvider.GetRequiredService<FileStorage>();
        await files.SetAsync("docs/a.txt", "text/plain", 3, new System.Text.Json.Nodes.JsonObject(), default);
    }

    [Fact]
    public async Task Browse_get_delete()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        await SeedAsync(app);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var browse = await client.GetAsync("/_console/api/storage/browse?path=");
        Assert.Equal(HttpStatusCode.OK, browse.StatusCode);
        Assert.Contains("docs", await browse.Content.ReadAsStringAsync());   // "docs" appears as a folder

        var get = await client.GetAsync($"/_console/api/storage/files/{B64("docs/a.txt")}");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);

        var del = await client.DeleteAsync($"/_console/api/storage/files/{B64("docs/a.txt")}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);
        var after = await client.GetAsync($"/_console/api/storage/files/{B64("docs/a.txt")}");
        Assert.Equal(HttpStatusCode.NotFound, after.StatusCode);
    }

    [Fact]
    public async Task Delete_directory_cascades_to_all_files_underneath()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using (var scope = app.Services.CreateScope())
        {
            var files = scope.ServiceProvider.GetRequiredService<FileStorage>();
            await files.SetAsync("docs/a.txt", "text/plain", 1, new System.Text.Json.Nodes.JsonObject(), default);
            await files.SetAsync("docs/sub/b.txt", "text/plain", 1, new System.Text.Json.Nodes.JsonObject(), default);
            await files.SetAsync("other/c.txt", "text/plain", 1, new System.Text.Json.Nodes.JsonObject(), default);
        }
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        var del = await client.DeleteAsync($"/_console/api/storage/directories/{B64("docs")}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        // Everything under docs/ is gone; the sibling directory is untouched.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/_console/api/storage/files/{B64("docs/a.txt")}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/_console/api/storage/files/{B64("docs/sub/b.txt")}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/_console/api/storage/files/{B64("other/c.txt")}")).StatusCode);
    }

    [Fact]
    public async Task Upload_confirm_download_and_metadata()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();

        // Create the record + get a presigned upload URL (the SPA would PUT the bytes to it).
        var up = await client.PostAsJsonAsync("/_console/api/storage/upload-url",
            new { path = "uploads/report.pdf", mimeType = "application/pdf", sizeBytes = 1024, metadata = new { author = "alice" } });
        Assert.Equal(HttpStatusCode.OK, up.StatusCode);
        Assert.Contains("uploadUrl", await up.Content.ReadAsStringAsync());

        // Confirm marks the upload complete; the record is then browsable.
        var confirm = await client.PostAsJsonAsync("/_console/api/storage/confirm", new { path = "uploads/report.pdf" });
        Assert.Equal(HttpStatusCode.OK, confirm.StatusCode);
        var get = await client.GetAsync($"/_console/api/storage/files/{B64("uploads/report.pdf")}");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);

        // Presigned download URL.
        var dl = await client.GetAsync($"/_console/api/storage/download-url?path={Uri.EscapeDataString("uploads/report.pdf")}");
        Assert.Equal(HttpStatusCode.OK, dl.StatusCode);
        Assert.Contains("downloadUrl", await dl.Content.ReadAsStringAsync());

        // Edit metadata.
        var meta = await client.PostAsJsonAsync("/_console/api/storage/metadata",
            new { path = "uploads/report.pdf", metadata = new { author = "bob", reviewed = true } });
        Assert.Equal(HttpStatusCode.OK, meta.StatusCode);
        Assert.Contains("bob", await meta.Content.ReadAsStringAsync());
    }
}
