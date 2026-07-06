using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Email;

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

    /// <summary>
    /// Rules-editor options for the database subsystem; null when <see cref="UseDatabaseRulesEditor"/>
    /// was never called (the feature stays off for this subsystem).
    /// </summary>
    internal RulesEditorOptions? DatabaseRulesEditor { get; private set; }

    /// <summary>
    /// Rules-editor options for the storage subsystem; null when <see cref="UseStorageRulesEditor"/>
    /// was never called (the feature stays off for this subsystem).
    /// </summary>
    internal RulesEditorOptions? StorageRulesEditor { get; private set; }

    /// <summary>
    /// Enable the GUI rules editor for the database (Firestore-style) rule engine. Its versioned rules
    /// store reuses <see cref="ConnectionString"/> (required whenever any rules editor is enabled — see
    /// <c>AddWincheConsole</c>), in a dedicated table separate from the identity tables.
    /// </summary>
    public ConsoleOptions UseDatabaseRulesEditor(Action<RulesEditorOptions>? configure = null)
    {
        var opts = new RulesEditorOptions();
        configure?.Invoke(opts);
        DatabaseRulesEditor = opts;
        return this;
    }

    /// <summary>
    /// Enable the GUI rules editor for the storage (Firestore-style) rule engine. Its versioned rules
    /// store reuses <see cref="ConnectionString"/> (required whenever any rules editor is enabled — see
    /// <c>AddWincheConsole</c>), in a dedicated table separate from the identity tables.
    /// </summary>
    public ConsoleOptions UseStorageRulesEditor(Action<RulesEditorOptions>? configure = null)
    {
        var opts = new RulesEditorOptions();
        configure?.Invoke(opts);
        StorageRulesEditor = opts;
        return this;
    }
}
