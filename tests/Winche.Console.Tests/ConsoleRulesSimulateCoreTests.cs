using Winche.Rules;
using Winche.Rules.Evaluation;
using Winche.Rules.Expressions;
using Xunit;
using Winche.Values;

namespace Winche.Console.Tests;

/// <summary>
/// Exercises the same core evaluation path the <c>api/rules/{sys}/simulate</c> endpoint uses — a
/// <see cref="RuleEngine"/> built over a <see cref="StaticRuleSetRepository"/> wrapping a draft (not
/// live) ruleset — without any HTTP or database involved. Also confirms that path-pattern captures
/// (e.g. <c>userId</c> from <c>users/{userId}</c>) are derived by the evaluator from the document path
/// itself, so a simulate request can pass an empty <see cref="RuleRequest.Params"/>.
/// </summary>
public sealed class ConsoleRulesSimulateCoreTests
{
    private static readonly RuleSet DraftRules = RuleSetBuilder.Build(root =>
        root.Match("users/{userId}", u =>
            u.Allow(RuleOperations.Read, Expr.Auth("uid").Eq(Expr.Param("userId")))));

    private static RuleRequest RequestFor(string uid) => new()
    {
        Request = new MapValue(new Dictionary<string, Value>
        {
            ["auth"] = new MapValue(new Dictionary<string, Value> { ["uid"] = new StringValue(uid) }),
        }),
    };

    [Fact]
    public async Task AllowsAsync_WhenAuthUidMatchesPathCapture_ReturnsTrue()
    {
        var engine = new RuleEngine(new StaticRuleSetRepository(DraftRules));

        var allowed = await engine.AllowsAsync(RuleOperation.Get, "users/alice", RequestFor("alice"));

        Assert.True(allowed);
    }

    [Fact]
    public async Task AllowsAsync_WhenAuthUidDoesNotMatchPathCapture_ReturnsFalse()
    {
        var engine = new RuleEngine(new StaticRuleSetRepository(DraftRules));

        var denied = await engine.AllowsAsync(RuleOperation.Get, "users/alice", RequestFor("bob"));

        Assert.False(denied);
    }
}
