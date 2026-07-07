using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Email;
using Winche.Console.Tabs;

namespace Winche.Console.Options;

/// <summary>Configuration for the console's built-in authentication.</summary>
public sealed class ConsoleOptions
{
    /// <summary>Connection string for the console's own auth database (Identity tables). Required.</summary>
    public string ConnectionString { get; set; } = "";

    /// <summary>Which auth backend to use. Defaults to Identity; set to Keycloak by calling <see cref="UseKeycloak"/>.</summary>
    public ConsoleAuthProvider Provider { get; private set; } = ConsoleAuthProvider.Identity;

    /// <summary>Keycloak settings; only meaningful when <see cref="Provider"/> is Keycloak.</summary>
    public KeycloakOptions Keycloak { get; } = new();

    /// <summary>Switch the console to the Keycloak provider and configure it. ConnectionString/SeedAdmin* are ignored in this mode.</summary>
    public ConsoleOptions UseKeycloak(Action<KeycloakOptions> configure)
    {
        ArgumentNullException.ThrowIfNull(configure);
        Provider = ConsoleAuthProvider.Keycloak;
        configure(Keycloak);
        return this;
    }

    /// <summary>Optional first-admin seed; applied on startup only when no users exist.</summary>
    public string? SeedAdminEmail { get; set; }
    public string? SeedAdminPassword { get; set; }

    /// <summary>Self-service password reset (effective only when an IConsoleEmailSender is registered). Phase 4.</summary>
    public bool AllowSelfServicePasswordReset { get; set; } = true;

    /// <summary>
    /// Buffered email-sender registration; applied against the host's service collection by
    /// AddWincheConsole. Null when the consumer never calls UseEmailSender (email features stay off).
    /// </summary>
    internal Action<IServiceCollection>? EmailSenderRegistration { get; private set; }

    /// <summary>
    /// Register an <see cref="IConsoleEmailSender"/> implementation type; resolved from DI so it can take
    /// constructor dependencies. Enables self-service password reset and admin invites.
    /// </summary>
    public ConsoleOptions UseEmailSender<TSender>(ServiceLifetime lifetime = ServiceLifetime.Singleton)
        where TSender : class, IConsoleEmailSender
    {
        EmailSenderRegistration = services =>
            services.Add(new ServiceDescriptor(typeof(IConsoleEmailSender), typeof(TSender), lifetime));
        return this;
    }

    /// <summary>
    /// Register an <see cref="IConsoleEmailSender"/> via a factory with access to the
    /// <see cref="IServiceProvider"/> for full control over construction.
    /// </summary>
    public ConsoleOptions UseEmailSender(
        Func<IServiceProvider, IConsoleEmailSender> factory,
        ServiceLifetime lifetime = ServiceLifetime.Singleton)
    {
        ArgumentNullException.ThrowIfNull(factory);
        EmailSenderRegistration = services =>
            services.Add(new ServiceDescriptor(typeof(IConsoleEmailSender), factory, lifetime));
        return this;
    }

    /// <summary>Register an already-constructed singleton <see cref="IConsoleEmailSender"/> instance.</summary>
    public ConsoleOptions UseEmailSender(IConsoleEmailSender instance)
    {
        ArgumentNullException.ThrowIfNull(instance);
        EmailSenderRegistration = services => services.AddSingleton(instance);
        return this;
    }

    internal BuiltInTabConfig? DatabaseTab { get; private set; }
    internal BuiltInTabConfig? StorageTab { get; private set; }

    // Kept as pass-throughs so the existing rules wiring (store factory, startup service, subsystem
    // registration, MapConsoleRulesEndpoints) is unchanged: a rules editor is enabled iff its tab set one.
    internal RulesEditorOptions? DatabaseRulesEditor => DatabaseTab?.RulesEditor;
    internal RulesEditorOptions? StorageRulesEditor => StorageTab?.RulesEditor;

    /// <summary>Enable the Database browser tab (requires AddWincheDatabase). Configure its min role and optional rules editor.</summary>
    public ConsoleOptions AddDatabaseTab(Action<BuiltInTabBuilder>? configure = null)
    {
        DatabaseTab = BuildBuiltInTab(configure, DatabaseTab, "Database");
        return this;
    }

    /// <summary>Enable the Storage browser tab (requires AddWincheStorage). Configure its min role and optional rules editor.</summary>
    public ConsoleOptions AddStorageTab(Action<BuiltInTabBuilder>? configure = null)
    {
        StorageTab = BuildBuiltInTab(configure, StorageTab, "Storage");
        return this;
    }

    private static BuiltInTabConfig BuildBuiltInTab(Action<BuiltInTabBuilder>? configure, BuiltInTabConfig? existing, string name)
    {
        if (existing is not null)
            throw new InvalidOperationException($"The {name} tab is already registered.");
        var b = new BuiltInTabBuilder();
        configure?.Invoke(b);
        return new BuiltInTabConfig { MinRole = b.MinRole, RulesEditor = b.RulesEditor };
    }

    private readonly List<TabDefinition> _tabs = new();
    internal IReadOnlyList<TabDefinition> Tabs => _tabs;

    /// <summary>Register a custom console tab: a declarative layout tree rendered by the console, with widget
    /// data supplied by typed handler methods on DI-resolved provider classes.</summary>
    public ConsoleOptions AddTab(string id, string label, Action<TabBuilder> configure)
    {
        ArgumentNullException.ThrowIfNull(configure);
        var builder = new TabBuilder();
        configure(builder);
        var definition = builder.Build(id, label);
        if (_tabs.Any(t => t.Id == definition.Id))
            throw new InvalidOperationException($"A tab with id '{definition.Id}' is already registered.");
        _tabs.Add(definition);
        return this;
    }
}
