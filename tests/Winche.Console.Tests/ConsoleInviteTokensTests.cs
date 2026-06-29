using Microsoft.AspNetCore.DataProtection;
using Winche.Console.Identity;
using Xunit;

namespace Winche.Console.Tests;

public class ConsoleInviteTokensTests
{
    private static ConsoleInviteTokens NewTokens() =>
        new(new EphemeralDataProtectionProvider());

    [Fact]
    public void Round_trips_an_invite_id()
    {
        var tokens = NewTokens();
        var id = Guid.NewGuid();
        var token = tokens.Protect(id, TimeSpan.FromHours(1));
        Assert.True(tokens.TryUnprotect(token, out var parsed));
        Assert.Equal(id, parsed);
    }

    [Fact]
    public void Rejects_tampered_or_empty_tokens()
    {
        var tokens = NewTokens();
        Assert.False(tokens.TryUnprotect("not-a-real-token", out _));
        Assert.False(tokens.TryUnprotect("", out _));
    }

    [Fact]
    public async Task Rejects_expired_tokens()
    {
        var tokens = NewTokens();
        var token = tokens.Protect(Guid.NewGuid(), TimeSpan.FromMilliseconds(1));
        await Task.Delay(50);
        Assert.False(tokens.TryUnprotect(token, out _));
    }
}
