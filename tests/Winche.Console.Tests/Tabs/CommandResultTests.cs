using Winche.Console.Tabs;
using Xunit;

namespace Winche.Console.Tests.Tabs;

public class CommandResultTests
{
    [Fact]
    public void Ok_defaults_to_tab_refetch()
    {
        var r = CommandResult.Ok("done");
        Assert.Equal(CommandStatus.Ok, r.Status);
        Assert.Equal("done", r.Message);
        Assert.Equal(RefetchScope.Tab, r.Refetch);
        Assert.Empty(r.FieldErrors);
    }

    [Fact]
    public void Ok_without_refetch_suppresses()
    {
        var r = CommandResult.Ok("done").WithoutRefetch();
        Assert.Equal(RefetchScope.None, r.Refetch);
    }

    [Fact]
    public void Fail_carries_message_and_error_status()
    {
        var r = CommandResult.Fail("boom");
        Assert.Equal(CommandStatus.Error, r.Status);
        Assert.Equal("boom", r.Message);
    }

    [Fact]
    public void Invalid_collects_field_errors()
    {
        var r = CommandResult.Invalid(("email", "taken"), ("role", "required"));
        Assert.Equal(CommandStatus.Invalid, r.Status);
        Assert.Equal("taken", r.FieldErrors["email"]);
        Assert.Equal("required", r.FieldErrors["role"]);
    }

    [Fact]
    public void Invalid_lowercases_field_keys_to_match_schema()
    {
        // Handlers typically call Invalid(nameof(Input.Email), ...) which passes "Email" (PascalCase);
        // FieldSchema keys and the SPA are lower-case, so the key must be normalized to land on the field.
        var r = CommandResult.Invalid("Email", "taken");
        Assert.True(r.FieldErrors.ContainsKey("email"));
        Assert.False(r.FieldErrors.ContainsKey("Email"));
    }
}
