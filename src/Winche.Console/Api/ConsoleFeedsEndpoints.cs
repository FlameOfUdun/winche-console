using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Winche.Console.Identity;
using Winche.Core.Feeds;

namespace Winche.Console.Api;

/// <summary>
/// Background deliveries inside the app: every package's durable consumers of its change feed (the database's hooks
/// and published changes, storage's file hooks), how far behind they are, and the changes they gave up on, which can be
/// retried or discarded.
/// </summary>
public static class ConsoleFeedsEndpoints
{
    public sealed record RetryRequest(string? Consumer);

    public static IEndpointRouteBuilder MapConsoleFeedsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/feeds").RequireAuthorization(ConsoleRoles.AdminPolicy);

        group.MapGet("", async (IEnumerable<IWincheFeedConsumers> feeds, CancellationToken ct) =>
        {
            var list = new List<object>();
            foreach (var f in feeds)
                list.Add(new
                {
                    feed = f.Feed,
                    consumers = (await f.ConsumersAsync(ct)).Select(c => new
                    {
                        name = c.Name, lagSeconds = (long)c.Lag.TotalSeconds, oldestPendingAt = c.OldestPendingAt, failingSince = c.FailingSince,
                        failingAttempts = c.FailingAttempts, lastError = c.LastError, deadLetters = c.DeadLetters,
                    }),
                });
            return Results.Json(new { feeds = list });
        });

        group.MapGet("/{feed}/dead-letters", async (string feed, string? consumer, IEnumerable<IWincheFeedConsumers> feeds, CancellationToken ct) =>
            Find(feeds, feed) is { } f
                ? Results.Json(new
                {
                    deadLetters = (await f.DeadLettersAsync(consumer, 200, ct)).Select(l => new
                    {
                        id = l.Id, consumer = l.Consumer, record = l.Record, error = l.Error, attempts = l.Attempts,
                        firstFailedAt = l.FirstFailedAt, deadLetteredAt = l.DeadLetteredAt,
                    }),
                })
                : NoFeed(feed));

        group.MapPost("/{feed}/retry", async (string feed, RetryRequest body, IEnumerable<IWincheFeedConsumers> feeds, CancellationToken ct) =>
        {
            if (Find(feeds, feed) is not { } f) return NoFeed(feed);
            if (string.IsNullOrEmpty(body.Consumer)) return ConsoleErrors.Problem("invalid-request", "Say which consumer's dead letters to retry.", null);
            var result = await f.RetryAsync(body.Consumer, ct);
            return Results.Json(new { replayed = result.Replayed, failed = result.Failed });
        });

        group.MapDelete("/{feed}/dead-letters/{id:long}", async (string feed, long id, IEnumerable<IWincheFeedConsumers> feeds, CancellationToken ct) =>
            Find(feeds, feed) is not { } f ? NoFeed(feed)
            : await f.DiscardAsync(id, ct) ? Results.NoContent()
            : Results.NotFound());

        return app;
    }

    private static IWincheFeedConsumers? Find(IEnumerable<IWincheFeedConsumers> feeds, string name) => feeds.FirstOrDefault(f => f.Feed == name);

    private static IResult NoFeed(string feed) => Results.Json(new { error = new { code = "not-found", message = $"No feed is named '{feed}'." } }, statusCode: 404);
}
