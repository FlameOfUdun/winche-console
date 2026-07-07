using Winche.Console.Tabs;
using Xunit;

namespace Winche.Console.Tests.Tabs;

public class WidgetContextTests
{
    private static WidgetContext Ctx(Dictionary<string, string?> inputs) =>
        new(new ConsoleTabUser("u", null, ConsoleRole.Viewer), inputs, Services: null!);

    [Fact]
    public void Page_reads_reserved_key_and_defaults_to_one()
    {
        var a = Ctx(new()).Page("rows", 20);
        Assert.Equal((1, 20), a);
        var b = Ctx(new() { ["page:rows"] = "3" }).Page("rows", 20);
        Assert.Equal((3, 20), b);
    }

    [Fact]
    public void Page_clamps_non_positive_pages_to_one()
    {
        Assert.Equal((1, 10), Ctx(new() { ["page:rows"] = "0" }).Page("rows", 10));
        Assert.Equal((1, 10), Ctx(new() { ["page:rows"] = "-4" }).Page("rows", 10));
        Assert.Equal((1, 10), Ctx(new() { ["page:rows"] = "abc" }).Page("rows", 10));
    }

    [Fact]
    public void TableData_carries_total_and_row_keys()
    {
        var t = new TableData(new[] { "Name" }, total: 42, new[] { new TableRow("k1", new object?[] { "Alice" }) });
        Assert.Equal(42, t.Total);
        Assert.Equal("k1", t.Rows[0].Key);
        Assert.Equal("Alice", t.Rows[0].Cells[0]);
    }

    [Fact]
    public void Builder_uses_key_selector_and_explicit_total()
    {
        TableData t = TableData.From(new[] { new { Path = "users/alice", Name = "Alice" } })
            .Key(x => x.Path).Column("Name", x => x.Name).Total(99);
        Assert.Equal(99, t.Total);
        Assert.Equal("users/alice", t.Rows[0].Key);
        Assert.Equal("Alice", t.Rows[0].Cells[0]);
    }

    [Fact]
    public void Builder_defaults_key_to_index_and_total_to_count()
    {
        TableData t = TableData.From(new[] { new { Name = "Bob" } }).Column("Name", x => x.Name);
        Assert.Equal(1, t.Total);
        Assert.Equal("0", t.Rows[0].Key);
    }
}
