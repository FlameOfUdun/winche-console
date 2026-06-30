using Winche.Console.Identity;
using Winche.Console.Options;
using Xunit;

namespace Winche.Console.Tests;

public class KeycloakRoleMapTests
{
    private static readonly KeycloakOptions Defaults = new();

    [Theory]
    [InlineData(new[] { "Admin" }, "Admin")]
    [InlineData(new[] { "Member" }, "Member")]
    [InlineData(new[] { "Viewer" }, "Viewer")]
    [InlineData(new[] { "Viewer", "Admin" }, "Admin")]
    [InlineData(new[] { "Viewer", "Member" }, "Member")]
    public void Maps_to_highest_canonical_role(string[] roles, string expected) =>
        Assert.Equal(expected, KeycloakRoleMap.HighestRole(roles, Defaults));

    [Fact]
    public void Returns_null_when_no_mapped_role_present() =>
        Assert.Null(KeycloakRoleMap.HighestRole(new[] { "unrelated" }, Defaults));

    [Fact]
    public void Honors_custom_role_names()
    {
        var opts = new KeycloakOptions { AdminRole = "kc-admin", MemberRole = "kc-editor", ViewerRole = "kc-reader" };
        Assert.Equal("Admin", KeycloakRoleMap.HighestRole(new[] { "kc-reader", "kc-admin" }, opts));
    }
}
