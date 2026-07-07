namespace Winche.Console.Tabs;

/// <summary>Immutable, validated description of one custom tab.</summary>
public sealed record TabDefinition(
    string Id,
    string Label,
    string Icon,
    ConsoleRole MinRole,
    Node Root,
    IReadOnlyList<Type> ProviderTypes,
    IReadOnlyList<CommandDefinition> Commands);
