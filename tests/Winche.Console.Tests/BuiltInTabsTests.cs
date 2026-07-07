using Winche.Console.Options;
using Winche.Console.Tabs;
using Xunit;

namespace Winche.Console.Tests;

public class BuiltInTabsTests
{
    [Fact]
    public void AddDatabaseTab_defaults_min_role_to_viewer_and_no_rules_editor()
    {
        var o = new ConsoleOptions();
        o.AddDatabaseTab();
        Assert.NotNull(o.DatabaseTab);
        Assert.Equal(ConsoleRole.Viewer, o.DatabaseTab!.MinRole);
        Assert.Null(o.DatabaseRulesEditor);
    }

    [Fact]
    public void AddDatabaseTab_carries_min_role_and_rules_editor()
    {
        var o = new ConsoleOptions();
        o.AddDatabaseTab(b => { b.MinRole = ConsoleRole.Member; b.UseRulesEditor(); });
        Assert.Equal(ConsoleRole.Member, o.DatabaseTab!.MinRole);
        Assert.NotNull(o.DatabaseRulesEditor);   // pass-through reflects the folded-in editor
    }

    [Fact]
    public void Storage_tab_absent_until_added()
    {
        var o = new ConsoleOptions();
        Assert.Null(o.StorageTab);
        Assert.Null(o.StorageRulesEditor);
        o.AddStorageTab();
        Assert.NotNull(o.StorageTab);
    }

    [Fact]
    public void Adding_a_built_in_tab_twice_throws()
    {
        var o = new ConsoleOptions();
        o.AddDatabaseTab();
        Assert.Throws<InvalidOperationException>(() => o.AddDatabaseTab());
    }
}
