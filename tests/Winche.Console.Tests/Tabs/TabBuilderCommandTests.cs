using System.ComponentModel.DataAnnotations;
using Winche.Console.Tabs;
using Xunit;

namespace Winche.Console.Tests.Tabs;

public class TabBuilderCommandTests
{
    public sealed record Input([property: Required] string Name);
    public sealed class Prov
    {
        public WidgetHandler<TableData> Rows => (ctx, ct) => Task.FromResult(TableData.Of(new[] { "N" }, Array.Empty<IReadOnlyList<object?>>()));
        public CommandHandler<Input> CreateThing => (ctx, ct) => Task.FromResult(CommandResult.Ok());
        public CommandHandler DeleteThing => (ctx, ct) => Task.FromResult(CommandResult.Ok());
    }

    private static TabDefinition Build(Action<TabBuilder> configure)
    {
        var b = new TabBuilder();
        configure(b);
        return b.Build("things", "Things");
    }

    [Fact]
    public void Command_registers_and_is_referenced_by_button_and_rowaction()
    {
        var def = Build(tab =>
        {
            tab.MinRole = ConsoleRole.Member;
            var create = tab.Command((Prov d) => d.CreateThing, c => { c.Label = "Create"; c.MinRole = ConsoleRole.Admin; });
            var del = tab.Command((Prov d) => d.DeleteThing, c => { c.Label = "Delete"; c.MinRole = ConsoleRole.Admin; c.Confirm = "sure?"; });
            tab.Layout(new Column(new Node[]
            {
                new Button(create),
                new Table<Prov>(d => d.Rows) { Paginate = 20, RowActions = new[] { new RowActionRef(del) } },
            }));
        });

        Assert.Equal(2, def.Commands.Count);
        Assert.Contains(def.Commands, c => c.Id == "creatething" && c.Fields.Count == 1);
        Assert.Contains(def.Commands, c => c.Id == "deletething" && c.RowScoped);
    }

    [Fact]
    public void Command_below_tab_minrole_is_rejected()
    {
        var ex = Assert.Throws<InvalidOperationException>(() => Build(tab =>
        {
            tab.MinRole = ConsoleRole.Admin;
            var c = tab.Command((Prov d) => d.CreateThing, x => { x.Label = "C"; x.MinRole = ConsoleRole.Member; });
            tab.Layout(new Column(new Node[] { new Button(c), new Table<Prov>(d => d.Rows) }));
        }));
        Assert.Contains("MinRole", ex.Message);
    }

    [Fact]
    public void Button_referencing_unregistered_command_is_rejected()
    {
        var ex = Assert.Throws<InvalidOperationException>(() => Build(tab =>
        {
            var orphan = new CommandRef("ghost", "Ghost", ConsoleRole.Admin, false);
            tab.Layout(new Column(new Node[] { new Button(orphan), new Table<Prov>(d => d.Rows) }));
        }));
        Assert.Contains("ghost", ex.Message);
    }

    // Prov authors handlers as property-lambdas; ids must still derive from the member name.
    [Fact]
    public void Property_style_widget_and_command_ids_derive_from_member_name()
    {
        var def = Build(tab =>
        {
            tab.MinRole = ConsoleRole.Member;
            var create = tab.Command((Prov d) => d.CreateThing, c => { c.Label = "Create"; c.MinRole = ConsoleRole.Admin; });
            tab.Layout(new Column(new Node[] { new Button(create), new Table<Prov>(d => d.Rows) }));
        });
        Assert.Contains(LayoutWalk.Widgets(def.Root), w => w.Id == "rows");
        Assert.Contains(def.Commands, c => c.Id == "creatething");
    }

    [Fact]
    public void Command_only_provider_type_is_registered_for_di()
    {
        var def = Build(tab =>
        {
            tab.MinRole = ConsoleRole.Viewer;
            var c = tab.Command((CmdOnly d) => d.DoThing, x => { x.Label = "Do"; x.MinRole = ConsoleRole.Viewer; });
            tab.Layout(new Column(new Node[] { new Button(c), new Table<Prov>(d => d.Rows) }));
        });
        Assert.Contains(typeof(CmdOnly), def.ProviderTypes);
        Assert.Contains(typeof(Prov), def.ProviderTypes);
    }

    public sealed class CmdOnly
    {
        public CommandHandler DoThing => (ctx, ct) => Task.FromResult(CommandResult.Ok());
    }
}
