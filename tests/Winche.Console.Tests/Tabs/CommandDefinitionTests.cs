using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.DependencyInjection;
using Winche.Console.Tabs;
using Xunit;

namespace Winche.Console.Tests.Tabs;

public class CommandDefinitionTests
{
    public sealed record Input([property: Required] string Name);

    public sealed class Provider
    {
        public CommandHandler<Input> Create => (ctx, ct) => Task.FromResult(CommandResult.Ok(ctx.Input.Name));
        public CommandHandler Delete => (ctx, ct) => Task.FromResult(CommandResult.Ok(ctx.RowKey));
    }

    [Fact]
    public async Task Typed_command_binds_input_and_invokes()
    {
        var def = CommandDefinition.Create<Provider, Input>(p => p.Create, "Create", ConsoleRole.Admin, confirm: null);
        Assert.Equal("create", def.Id);
        Assert.Equal(ConsoleRole.Admin, def.MinRole);
        Assert.False(def.RowScoped);
        Assert.Single(def.Fields);

        var sp = new ServiceCollection().AddSingleton<Provider>().BuildServiceProvider();
        var ctx = new CommandContext(new ConsoleTabUser("u", null, ConsoleRole.Admin),
            new Dictionary<string, string?>(), RowKey: null, sp);
        var result = await def.Invoke(sp, ctx, """{"name":"abc"}""", CancellationToken.None);
        Assert.Equal(CommandStatus.Ok, result.Status);
        Assert.Equal("abc", result.Message);
    }

    [Fact]
    public async Task Identity_command_is_row_scoped_and_reads_rowkey()
    {
        var def = CommandDefinition.Create<Provider>(p => p.Delete, "Delete", ConsoleRole.Admin, confirm: "sure?");
        Assert.Equal("delete", def.Id);
        Assert.True(def.RowScoped);
        Assert.Empty(def.Fields);

        var sp = new ServiceCollection().AddSingleton<Provider>().BuildServiceProvider();
        var ctx = new CommandContext(new ConsoleTabUser("u", null, ConsoleRole.Admin),
            new Dictionary<string, string?>(), RowKey: "row-1", sp);
        var result = await def.Invoke(sp, ctx, inputJson: null, CancellationToken.None);
        Assert.Equal("row-1", result.Message);
    }

    [Fact]
    public async Task Invalid_input_json_returns_field_errors()
    {
        var def = CommandDefinition.Create<Provider, Input>(p => p.Create, "Create", ConsoleRole.Admin, confirm: null);
        var sp = new ServiceCollection().AddSingleton<Provider>().BuildServiceProvider();
        var ctx = new CommandContext(new ConsoleTabUser("u", null, ConsoleRole.Admin),
            new Dictionary<string, string?>(), RowKey: null, sp);
        var result = await def.Invoke(sp, ctx, """{"name":""}""", CancellationToken.None); // Required violated
        Assert.Equal(CommandStatus.Invalid, result.Status);
        Assert.True(result.FieldErrors.ContainsKey("name"));
    }
}
