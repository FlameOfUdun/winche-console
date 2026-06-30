namespace Winche.Console.Options;

/// <summary>Which authentication backend the console uses. Selected per deployment; mutually exclusive.</summary>
public enum ConsoleAuthProvider
{
    /// <summary>Built-in ASP.NET Core Identity (cookie sessions, console-owned user DB). Default.</summary>
    Identity = 0,

    /// <summary>External Keycloak realm (JWT bearer; user/role management delegated to Keycloak).</summary>
    Keycloak = 1,
}
