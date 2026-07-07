namespace Winche.Console.Tabs;

/// <summary>Whether a button invokes a command or refreshes the tab.</summary>
public enum ButtonIntent { Command, Refresh }

/// <summary>A layout button: either invokes a command or refreshes the tab.</summary>
public sealed record Button : Node
{
    public ButtonIntent Intent { get; }
    public string Label { get; }
    public CommandRef? Command { get; }

    public Button(CommandRef command)
    {
        Intent = ButtonIntent.Command;
        Command = command;
        Label = command.Label;
    }

    private Button(string label) { Intent = ButtonIntent.Refresh; Label = label; }
    public static Button Refresh(string label = "Refresh") => new(label);
}
