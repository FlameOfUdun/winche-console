using Microsoft.Extensions.Logging;
using Winche.Console.Logs;
using Xunit;

namespace Winche.Console.Tests;

public class LogLevelSettingsTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 15, 0, 0, TimeSpan.Zero);

    [Fact]
    public void The_longest_matching_source_wins_at_dot_boundaries()
    {
        var s = new LogLevelSettings(LogLevel.Warning,
        [
            new("Microsoft", LogLevel.Error),
            new("SmartAirway.Reports", LogLevel.Debug),
            new("SmartAirway.Reports.Pdf", LogLevel.Critical),
        ]);
        Assert.Equal(LogLevel.Warning, s.For("SmartAirway.Users", Now));
        Assert.Equal(LogLevel.Debug, s.For("SmartAirway.Reports", Now));
        Assert.Equal(LogLevel.Debug, s.For("SmartAirway.Reports.ReportEmailService", Now));
        Assert.Equal(LogLevel.Critical, s.For("SmartAirway.Reports.Pdf.Renderer", Now));
        Assert.Equal(LogLevel.Warning, s.For("SmartAirway.ReportsArchive", Now));   // not under SmartAirway.Reports
        Assert.Equal(LogLevel.Error, s.For("Microsoft.AspNetCore.Hosting", Now));
    }

    [Fact]
    public void Overrides_end_on_their_own()
    {
        var s = new LogLevelSettings(LogLevel.Warning, [new("A", LogLevel.Debug, Now.AddHours(1))]);
        Assert.Equal(LogLevel.Debug, s.For("A.B", Now));
        Assert.Equal(LogLevel.Warning, s.For("A.B", Now.AddHours(1)));
        Assert.Empty(s.WithoutExpired(Now.AddHours(2)).Overrides);
    }

    [Fact]
    public void Problems_are_listed()
    {
        var s = new LogLevelSettings(LogLevel.Warning,
            [new(" ", LogLevel.Debug), new("A", LogLevel.Debug, Now.AddMinutes(-1)), new("B", LogLevel.Debug), new("B", LogLevel.Error)]);
        var problems = s.Problems(Now);
        Assert.Contains(problems, p => p.Contains("needs a source"));
        Assert.Contains(problems, p => p.Contains("already ended"));
        Assert.Contains(problems, p => p.Contains("more than one override"));
        Assert.Empty(new LogLevelSettings(LogLevel.Information, [new("A", LogLevel.Debug)]).Problems(Now));
    }

    [Fact]
    public void Code_levels_start_from_the_options()
    {
        var o = new LogsOptions { MinimumLevel = LogLevel.Information }.SetLevel("Microsoft", LogLevel.Warning);
        Assert.Equal(LogLevel.Warning, o.CodeLevels.For("Microsoft.EntityFrameworkCore", Now));
        Assert.Equal(LogLevel.Information, o.CodeLevels.For("App", Now));
    }
}
