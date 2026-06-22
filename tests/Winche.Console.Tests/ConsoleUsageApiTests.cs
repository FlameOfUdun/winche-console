using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Winche.Storage.Services;
using Xunit;

namespace Winche.Console.Tests;

[Collection("postgres")]
public class ConsoleUsageApiTests(PostgresFixture fx) : IAsyncLifetime
{
    public async Task InitializeAsync() => await fx.ResetAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    private static string B64(string s) => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(s));

    [Fact]
    public async Task Usage_counts_documents()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();
        await client.PutAsJsonAsync($"/_console/api/data/documents/{B64("users/alice")}",
            new { fields = new { name = new { stringValue = "Alice" } } });

        var usage = await client.GetFromJsonAsync<UsageDto>("/_console/api/usage");
        Assert.Equal(1, usage!.DocumentCount);
        Assert.Equal(0, usage.FileCount);
    }

    [Fact]
    public async Task Usage_counts_files()
    {
        await fx.ResetAuthAsync();
        using var app = new ConsoleAppFactory(fx);
        using (var scope = app.Services.CreateScope())
        {
            var files = scope.ServiceProvider.GetRequiredService<FileStorage>();
            await files.SetAsync("docs/a.txt", "text/plain", 3, new System.Text.Json.Nodes.JsonObject(), default);
        }
        using var client = app.CreateClient();
        await client.SetupAdminAsync();
        await client.LoginAsync();
        var usage = await client.GetFromJsonAsync<UsageDto>("/_console/api/usage");
        Assert.Equal(0, usage!.DocumentCount);
        Assert.Equal(1, usage.FileCount);
    }

    private sealed record UsageDto(long DocumentCount, long FileCount);
}
