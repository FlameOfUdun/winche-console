using Winche.Console.Tabs;
using Xunit;

namespace Winche.Console.Tests.Tabs;

public class ButtonTests
{
    [Fact]
    public void TextInput_control_has_kind_and_apply()
    {
        var c = new TextInput("q") { Apply = Apply.Manual, Placeholder = "Search…" };
        Assert.Equal("text", c.Kind);
        Assert.Equal(new[] { "q" }, c.Keys);
        Assert.Equal(Apply.Manual, c.Apply);
    }

    [Fact]
    public void Refresh_button_has_refresh_intent()
    {
        var b = Button.Refresh("Reload");
        Assert.Equal(ButtonIntent.Refresh, b.Intent);
        Assert.Equal("Reload", b.Label);
        Assert.Null(b.Command);
    }

    [Fact]
    public void Command_button_takes_label_from_the_command_ref()
    {
        var cmd = new CommandRef("createuser", "Create user", ConsoleRole.Admin, RowScoped: false);
        var b = new Button(cmd);
        Assert.Equal(ButtonIntent.Command, b.Intent);
        Assert.Equal("Create user", b.Label);
        Assert.Equal(cmd, b.Command);
    }
}
