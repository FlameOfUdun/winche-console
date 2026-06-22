namespace Winche.Console;

/// <summary>
/// DI service keys under which Winche.Database / Winche.Storage register their <see cref="Npgsql.NpgsqlDataSource"/>.
/// The console resolves these keyed data sources (for raw-SQL endpoints) so a consumer needs only
/// <c>AddWincheDatabase</c> / <c>AddWincheStorage</c> + <c>AddWincheConsole</c> — no extra registration.
/// </summary>
internal static class WincheServiceKeys
{
    public const string Database = "WincheDatabase";
    public const string Storage = "WincheStorage";
}
