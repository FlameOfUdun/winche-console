using System.ComponentModel.DataAnnotations;
using Winche.Console.Tabs;
using Xunit;

namespace Winche.Console.Tests.Tabs;

public class FieldSchemaTests
{
    public enum Role { Viewer, Member, Admin }

    public sealed record Input(
        [property: Display(Name = "Email"), Required, RegularExpression("^.+@.+$")] string Email,
        [property: Required] Role Role,
        [property: Display(Name = "Active")] bool Active = true,
        [property: DataType(DataType.MultilineText)] string? Notes = null);

    [Fact]
    public void Derives_fields_in_constructor_order()
    {
        var fields = FieldSchema.For(typeof(Input));
        Assert.Equal(new[] { "email", "role", "active", "notes" }, fields.Select(f => f.Key).ToArray());
    }

    [Fact]
    public void Maps_kinds_labels_and_options()
    {
        var f = FieldSchema.For(typeof(Input));
        Assert.Equal(FieldKind.Text, f[0].Kind);
        Assert.Equal("Email", f[0].Label);
        Assert.True(f[0].Required);
        Assert.Equal("^.+@.+$", f[0].Pattern);
        Assert.Equal(FieldKind.Select, f[1].Kind);
        Assert.Equal(new[] { "Viewer", "Member", "Admin" }, f[1].Options);
        Assert.Equal(FieldKind.Boolean, f[2].Kind);
        Assert.Equal(true, f[2].Default);
        Assert.Equal(FieldKind.Textarea, f[3].Kind);
        Assert.False(f[3].Required);
    }
}
