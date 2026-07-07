using Winche.Console.Tabs;
using Xunit;

namespace Winche.Console.Tests;

public class TabTreeTests
{
    private sealed class DemoData
    {
        public Task<StatRowData> Kpis(WidgetContext ctx, CancellationToken ct) =>
            Task.FromResult(new StatRowData(new Stat("Users", 42)));
        public Task<ChartData> Signups(WidgetContext ctx, CancellationToken ct) =>
            Task.FromResult(new ChartData(new Series("s", new Point("Mon", 1))));
        public Task<TableData> Recent(WidgetContext ctx, CancellationToken ct) =>
            Task.FromResult(TableData.From(Array.Empty<int>()).Build());
    }

    private static TabBuilder ValidTab()
    {
        var b = new TabBuilder { MinRole = ConsoleRole.Member, Icon = "chart-bar" };
        b.Layout(new Column([
            new StatRow<DemoData>(d => d.Kpis),
            new Row([ new Chart<DemoData>(d => d.Signups, ChartKind.Line) { Flex = 2 }, new Table<DemoData>(d => d.Recent) ]),
        ]));
        return b;
    }

    [Fact]
    public void StatRowData_accepts_params_stats()
    {
        var data = new StatRowData(new Stat("Users", 42, "+1%", Trend.Up), new Stat("Docs", 7));
        Assert.Equal(2, data.Stats.Count);
        Assert.Equal("Users", data.Stats[0].Label);
        Assert.Equal(Trend.Up, data.Stats[0].Trend);
        Assert.Equal(Trend.Neutral, data.Stats[1].Trend);
    }

    [Fact]
    public void TableData_From_builds_columns_and_rows_from_typed_projections()
    {
        var rows = new[] { new { User = "alice", Action = "Created" }, new { User = "bob", Action = "Deleted" } };
        TableData table = TableData.From(rows)
            .Column("User", x => x.User)
            .Column("Action", x => x.Action);

        Assert.Equal(new[] { "User", "Action" }, table.Columns);
        Assert.Equal(2, table.Rows.Count);
        Assert.Equal(new object?[] { "alice", "Created" }, table.Rows[0]);
    }

    [Fact]
    public void Leaf_derives_id_from_the_bound_method_name()
    {
        var stat = new StatRow<DemoData>(d => d.Kpis);
        var chart = new Chart<DemoData>(d => d.Signups, ChartKind.Line);

        Assert.Equal("kpis", stat.Id);
        Assert.Equal("statRow", stat.Kind);
        Assert.Equal(typeof(DemoData), stat.ProviderType);
        Assert.Equal("signups", chart.Id);
        Assert.Equal("chart", chart.Kind);
        Assert.Equal(ChartKind.Line, chart.ChartKind);
    }

    [Fact]
    public void Leaf_flex_defaults_to_one_and_is_settable()
    {
        Assert.Equal(1, new StatRow<DemoData>(d => d.Kpis).Flex);
        Assert.Equal(2, new Chart<DemoData>(d => d.Signups, ChartKind.Bar) { Flex = 2 }.Flex);
    }

    [Fact]
    public void Embed_defaults_flex_and_minheight_and_keeps_route()
    {
        var e = new Embed("note-editor", "/plugins/notes");
        Assert.Equal("note-editor", e.Id);
        Assert.Equal("/plugins/notes", e.Route);
        Assert.Equal(1, e.Flex);
        Assert.Equal(240, e.MinHeight);
        Assert.Equal(320, (e with { MinHeight = 320 }).MinHeight);
        Assert.IsAssignableFrom<Node>(e);
    }

    [Fact]
    public void Containers_hold_children_in_order()
    {
        var col = new Column([
            new StatRow<DemoData>(d => d.Kpis),
            new Row([ new Chart<DemoData>(d => d.Signups, ChartKind.Line) ]),
            new Section("Details", "sub", [ new StatRow<DemoData>(d => d.Kpis) ]),
        ]);

        Assert.Equal(3, col.Children.Count);
        Assert.IsType<Row>(col.Children[1]);
        var section = Assert.IsType<Section>(col.Children[2]);
        Assert.Equal("Details", section.Title);
        Assert.Equal("sub", section.Subtitle);
    }

    [Fact]
    public void Reactive_filter_keeps_children_and_is_not_switch()
    {
        var f = new Filter(new Select("range", ["7d", "30d"]), [ new StatRow<DemoData>(d => d.Kpis) ]);
        Assert.False(f.IsSwitch);
        Assert.NotNull(f.Children);
        Assert.Single(f.Children!);
        var sel = Assert.IsType<Select>(f.Control);
        Assert.Equal("range", sel.Id);
        Assert.Equal(new[] { "range" }, sel.Keys);
    }

    [Fact]
    public void Switch_filter_materializes_a_branch_per_option_at_construction()
    {
        var f = new Filter(new Select("view", ["Users", "Revenue"]), v => v switch
        {
            "Users"   => new Node[] { new Chart<DemoData>(d => d.Signups, ChartKind.Line) },
            "Revenue" => new Node[] { new StatRow<DemoData>(d => d.Kpis) },
            _ => [],
        });

        Assert.True(f.IsSwitch);
        Assert.NotNull(f.Branches);
        Assert.Equal(new[] { "Users", "Revenue" }, f.Branches!.Keys);
        Assert.IsType<Chart<DemoData>>(f.Branches["Users"][0]);
    }

    [Fact]
    public void DateRange_exposes_from_and_to_keys()
    {
        Assert.Equal(new[] { "rangeFrom", "rangeTo" }, new DateRange("range").Keys);
    }

    [Fact]
    public void Walk_enumerates_widgets_and_provider_types_across_containers_and_filter_branches()
    {
        var root = new Column([
            new StatRow<DemoData>(d => d.Kpis),
            new Filter(new Select("view", ["A", "B"]), v => v switch
            {
                "A" => new Node[] { new Chart<DemoData>(d => d.Signups, ChartKind.Line) },
                _   => new Node[] { new Table<DemoData>(d => d.Recent) },
            }),
        ]);

        var widgets = LayoutWalk.Widgets(root).ToList();
        Assert.Equal(new[] { "kpis", "recent", "signups" }, widgets.Select(w => w.Id).Order());
        Assert.Equal(new[] { typeof(DemoData) }, LayoutWalk.ProviderTypes(root));
        Assert.Equal("kpis", LayoutWalk.FindWidget(root, "kpis")!.Id);
        Assert.Null(LayoutWalk.FindWidget(root, "nope"));
    }

    [Fact]
    public void Walk_enumerates_embeds_and_excludes_them_from_widgets()
    {
        var root = new Column([
            new StatRow<DemoData>(d => d.Kpis),
            new Row([ new Embed("editor", "/plugins/editor"), new Chart<DemoData>(d => d.Signups, ChartKind.Line) ]),
        ]);

        Assert.Equal(new[] { "editor" }, LayoutWalk.Embeds(root).Select(e => e.Id));
        Assert.Equal(new[] { "kpis", "signups" }, LayoutWalk.Widgets(root).Select(w => w.Id).Order());
    }

    [Fact]
    public void Build_produces_a_definition_with_root_and_distinct_providers()
    {
        var def = ValidTab().Build("analytics", "Analytics");
        Assert.Equal("analytics", def.Id);
        Assert.Equal(ConsoleRole.Member, def.MinRole);
        Assert.Equal(new[] { typeof(DemoData) }, def.ProviderTypes);
        Assert.Equal(3, LayoutWalk.Widgets(def.Root).Count());
    }

    [Fact]
    public void Build_rejects_a_missing_layout()
    {
        Assert.Throws<InvalidOperationException>(() => new TabBuilder().Build("x", "X"));
    }

    [Fact]
    public void Build_rejects_duplicate_widget_ids()
    {
        var b = new TabBuilder();
        b.Layout(new Column([ new StatRow<DemoData>(d => d.Kpis), new StatRow<DemoData>(d => d.Kpis) ]));
        Assert.Throws<InvalidOperationException>(() => b.Build("x", "X"));
    }

    [Fact]
    public void Build_rejects_switch_over_a_date_range()
    {
        // A DateRange can't be a switch control; only Select can. The Filter switch ctor takes Select, so a
        // DateRange switch is unrepresentable — this test documents that reactive DateRange is the only form.
        var f = new Filter(new DateRange("d"), [ new StatRow<DemoData>(d => d.Kpis) ]);
        Assert.False(f.IsSwitch);
    }

    [Fact]
    public void Control_ids_may_repeat_across_sibling_switch_branches()
    {
        var b = new TabBuilder();
        b.Layout(new Filter(new Select("view", ["A", "B"]), v => v switch
        {
            "A" => new Node[] { new Filter(new Select("range", ["x"]), [ new StatRow<DemoData>(d => d.Kpis) ]) },
            _   => new Node[] { new Filter(new Select("range", ["y"]), [ new Chart<DemoData>(d => d.Signups, ChartKind.Line) ]) },
        }));
        var def = b.Build("t", "T");   // must NOT throw: the two "range" controls are in alternative branches
        Assert.Equal("t", def.Id);
    }

    [Fact]
    public void Control_ids_that_can_coexist_are_rejected()
    {
        var b = new TabBuilder();
        b.Layout(new Column([
            new Filter(new Select("range", ["x"]), [ new StatRow<DemoData>(d => d.Kpis) ]),
            new Filter(new Select("range", ["y"]), [ new Chart<DemoData>(d => d.Signups, ChartKind.Line) ]),
        ]));
        Assert.Throws<InvalidOperationException>(() => b.Build("t", "T"));   // both filters always visible
    }

    [Fact]
    public void Build_rejects_a_non_positive_flex()
    {
        var b = new TabBuilder();
        b.Layout(new Row([ new StatRow<DemoData>(d => d.Kpis) { Flex = 0 } ]));
        Assert.Throws<InvalidOperationException>(() => b.Build("x", "X"));
    }

    [Theory]
    [InlineData("//evil.com")]
    [InlineData("https://evil.com")]
    [InlineData("http://evil.com")]
    [InlineData("/\\evil.com")]
    [InlineData("/\\/evil.com")]
    [InlineData("plugins/x")]
    [InlineData("/")]
    public void Build_rejects_a_non_same_origin_embed_route(string route)
    {
        var b = new TabBuilder();
        b.Layout(new Column([ new Embed("editor", route) ]));
        Assert.Throws<InvalidOperationException>(() => b.Build("t", "T"));
    }

    [Fact]
    public void Build_accepts_a_root_relative_embed_only_tab()
    {
        var b = new TabBuilder();
        b.Layout(new Column([ new Embed("editor", "/plugins/editor") ]));
        var def = b.Build("t", "T");
        Assert.Equal("t", def.Id);
    }

    [Fact]
    public void Build_rejects_an_embed_id_colliding_with_a_widget_id()
    {
        var b = new TabBuilder();
        b.Layout(new Column([ new StatRow<DemoData>(d => d.Kpis), new Embed("kpis", "/plugins/x") ]));
        Assert.Throws<InvalidOperationException>(() => b.Build("t", "T"));
    }

    [Fact]
    public void Build_rejects_a_non_positive_embed_minheight()
    {
        var b = new TabBuilder();
        b.Layout(new Column([ new Embed("editor", "/plugins/x") { MinHeight = 0 } ]));
        Assert.Throws<InvalidOperationException>(() => b.Build("t", "T"));
    }

    [Theory]
    [InlineData("database")]
    [InlineData("storage")]
    [InlineData("access")]
    [InlineData("invite")]
    public void Build_rejects_a_reserved_tab_id(string reserved)
    {
        var b = new TabBuilder();
        b.Layout(new Column([ new StatRow<DemoData>(d => d.Kpis) ]));
        Assert.Throws<InvalidOperationException>(() => b.Build(reserved, "X"));
    }

    [Fact]
    public void AddTab_records_a_built_definition_and_rejects_duplicates()
    {
        var options = new Winche.Console.Options.ConsoleOptions();
        options.AddTab("analytics", "Analytics", tab =>
        {
            tab.MinRole = ConsoleRole.Member;
            tab.Layout(new Column([ new StatRow<DemoData>(d => d.Kpis) ]));
        });

        Assert.Single(options.Tabs);
        Assert.Equal("analytics", options.Tabs[0].Id);

        Assert.Throws<InvalidOperationException>(() => options.AddTab("analytics", "Dup", tab =>
            tab.Layout(new Column([ new StatRow<DemoData>(d => d.Kpis) ]))));
    }

    [Fact]
    public void Registry_visible_filters_by_role()
    {
        var member = ValidTab().Build("analytics", "Analytics");            // Member
        var adminB = new TabBuilder { MinRole = ConsoleRole.Admin };
        adminB.Layout(new Column([ new StatRow<DemoData>(d => d.Kpis) ]));
        var registry = new TabRegistry(new[] { member, adminB.Build("secret", "Secret") });

        Assert.Equal(new[] { "analytics" }, registry.Visible(ConsoleRole.Member).Select(t => t.Id));
        Assert.Equal(new[] { "analytics", "secret" }, registry.Visible(ConsoleRole.Admin).Select(t => t.Id));
    }

    [Fact]
    public void Manifest_projects_the_layout_tree_to_camelCase_json()
    {
        var def = new TabBuilder { Icon = "chart-bar", MinRole = ConsoleRole.Member };
        // reuse builder helper:
        def.Layout(new Filter(new Select("range", ["7d", "30d"]),
        [
            new StatRow<DemoData>(d => d.Kpis),
            new Row([ new Chart<DemoData>(d => d.Signups, ChartKind.Line) { Flex = 2 } ]),
        ]));
        var built = def.Build("analytics", "Analytics");

        var json = System.Text.Json.JsonSerializer.Serialize(TabManifest.Layout(built), TabManifest.JsonOptions);

        Assert.Contains("\"type\":\"filter\"", json);
        Assert.Contains("\"kind\":\"select\"", json);
        Assert.Contains("\"mode\":\"reactive\"", json);
        Assert.Contains("\"type\":\"widget\"", json);
        Assert.Contains("\"kind\":\"statRow\"", json);
        Assert.Contains("\"id\":\"kpis\"", json);
        Assert.Contains("\"chart\":\"line\"", json);
        Assert.Contains("\"flex\":2", json);
    }

    [Fact]
    public void Manifest_projects_an_embed_node()
    {
        var b = new TabBuilder();
        b.Layout(new Column([ new Embed("note-editor", "/plugins/notes") { Flex = 2, MinHeight = 320 } ]));
        var json = System.Text.Json.JsonSerializer.Serialize(TabManifest.Layout(b.Build("t", "T")), TabManifest.JsonOptions);

        Assert.Contains("\"type\":\"embed\"", json);
        Assert.Contains("\"id\":\"note-editor\"", json);
        Assert.Contains("\"route\":\"/plugins/notes\"", json);
        Assert.Contains("\"flex\":2", json);
        Assert.Contains("\"minHeight\":320", json);
    }

    [Fact]
    public void Manifest_switch_filter_emits_a_branch_per_option()
    {
        var b = new TabBuilder();
        b.Layout(new Filter(new Select("view", ["Users", "Revenue"]), v => v switch
        {
            "Users"   => new Node[] { new Chart<DemoData>(d => d.Signups, ChartKind.Line) },
            _         => new Node[] { new StatRow<DemoData>(d => d.Kpis) },
        }));
        var json = System.Text.Json.JsonSerializer.Serialize(TabManifest.Layout(b.Build("t", "T")), TabManifest.JsonOptions);

        Assert.Contains("\"mode\":\"switch\"", json);
        Assert.Contains("\"Users\":", json);
        Assert.Contains("\"Revenue\":", json);
    }
}
