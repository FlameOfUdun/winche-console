using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Winche.Console.Identity;

namespace Winche.Console.Api;

public static class ConsoleUsageEndpoints
{
    public static IEndpointRouteBuilder MapConsoleUsageEndpoints(this IEndpointRouteBuilder app)
    {
        // Count each table via its owning service's keyed data source, so the counts stay correct even if
        // Database and Storage are ever configured against different databases. The two counts are not a
        // single snapshot (separate connections) — acceptable for an approximate usage display.
        app.MapGet("/api/usage", async (
            [FromKeyedServices(WincheServiceKeys.Database)] NpgsqlDataSource dbSource,
            [FromKeyedServices(WincheServiceKeys.Storage)] NpgsqlDataSource storageSource,
            CancellationToken ct) =>
        {
            var documentCount = await CountAsync(dbSource, "winche_documents", ct);
            var fileCount = await CountAsync(storageSource, "winche_files", ct);
            return Results.Json(new { documentCount, fileCount });
        }).RequireAuthorization(ConsoleRoles.ViewerPolicy);
        return app;
    }

    private static async Task<long> CountAsync(NpgsqlDataSource source, string table, CancellationToken ct)
    {
        await using var conn = await source.OpenConnectionAsync(ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT count(*) FROM {table}";   // table names are compile-time constants, not user input
        return (long)(await cmd.ExecuteScalarAsync(ct))!;
    }
}
