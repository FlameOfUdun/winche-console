using System.ComponentModel.DataAnnotations;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;

namespace Winche.Console.Tabs;

public sealed record CommandContext(
    ConsoleTabUser User,
    IReadOnlyDictionary<string, string?> Inputs,
    string? RowKey,
    IServiceProvider Services);

public sealed record CommandContext<TInput>(
    ConsoleTabUser User,
    IReadOnlyDictionary<string, string?> Inputs,
    string? RowKey,
    IServiceProvider Services,
    TInput Input);

public delegate Task<CommandResult> CommandHandler<TInput>(CommandContext<TInput> ctx, CancellationToken ct);
public delegate Task<CommandResult> CommandHandler(CommandContext ctx, CancellationToken ct);

/// <summary>Erased invoker: deserialize+validate the input json (if any), then call the typed handler.</summary>
public delegate Task<CommandResult> CommandInvoke(IServiceProvider services, CommandContext ctx, string? inputJson, CancellationToken ct);

/// <summary>A registered command. Id derives from the bound method name (like widget ids).</summary>
public sealed record CommandDefinition
{
    public required string Id { get; init; }
    public required string Label { get; init; }
    public required ConsoleRole MinRole { get; init; }
    public string? Confirm { get; init; }
    public bool RowScoped { get; init; }
    public required Type ProviderType { get; init; }
    public required IReadOnlyList<FieldSchema> Fields { get; init; }
    public required CommandInvoke Invoke { get; init; }

    public static CommandDefinition Create<TProvider, TInput>(
        Func<TProvider, CommandHandler<TInput>> selector, string label, ConsoleRole minRole, string? confirm)
        where TProvider : class
    {
        var id = MethodName(selector);
        return new CommandDefinition
        {
            Id = id, Label = label, MinRole = minRole, Confirm = confirm,
            RowScoped = false,
            ProviderType = typeof(TProvider),
            Fields = FieldSchema.For(typeof(TInput)),
            Invoke = async (sp, ctx, json, ct) =>
            {
                if (!TryBind<TInput>(json, out var input, out var errors))
                    return CommandResult.Invalid(errors);
                var handler = selector((TProvider)sp.GetRequiredService(typeof(TProvider)));
                var typed = new CommandContext<TInput>(ctx.User, ctx.Inputs, ctx.RowKey, sp, input!);
                return await handler(typed, ct);
            },
        };
    }

    public static CommandDefinition Create<TProvider>(
        Func<TProvider, CommandHandler> selector, string label, ConsoleRole minRole, string? confirm)
        where TProvider : class
    {
        var id = MethodNameNonGeneric(selector);
        return new CommandDefinition
        {
            Id = id, Label = label, MinRole = minRole, Confirm = confirm,
            RowScoped = true,
            ProviderType = typeof(TProvider),
            Fields = Array.Empty<FieldSchema>(),
            Invoke = async (sp, ctx, _, ct) =>
            {
                var handler = selector((TProvider)sp.GetRequiredService(typeof(TProvider)));
                return await handler(ctx, ct);
            },
        };
    }

    private static bool TryBind<TInput>(string? json, out TInput? input, out (string, string)[] errors)
    {
        input = default;
        if (string.IsNullOrWhiteSpace(json))
        {
            errors = new[] { ("", "Missing input.") };
            return false;
        }
        try { input = JsonSerializer.Deserialize<TInput>(json, TabManifest.JsonOptions); }
        catch (JsonException) { errors = new[] { ("", "Malformed input.") }; return false; }

        var ctxV = new ValidationContext(input!);
        var results = new List<ValidationResult>();
        if (Validator.TryValidateObject(input!, ctxV, results, validateAllProperties: true))
        {
            errors = Array.Empty<(string, string)>();
            return true;
        }
        errors = results.SelectMany(r => r.MemberNames.DefaultIfEmpty(""),
            (r, m) => (m.ToLowerInvariant(), r.ErrorMessage ?? "Invalid.")).ToArray();
        input = default;
        return false;
    }

    private static string MethodName<TProvider, TInput>(Func<TProvider, CommandHandler<TInput>> selector)
        where TProvider : class
    {
        var probe = (TProvider)RuntimeHelpers.GetUninitializedObject(typeof(TProvider));
        return HandlerId.Normalize(selector(probe).Method.Name);
    }

    private static string MethodNameNonGeneric<TProvider>(Func<TProvider, CommandHandler> selector)
        where TProvider : class
    {
        var probe = (TProvider)RuntimeHelpers.GetUninitializedObject(typeof(TProvider));
        return HandlerId.Normalize(selector(probe).Method.Name);
    }
}

/// <summary>Typed handle returned by tab.Command(...); referenced by Button/RowAction.</summary>
public sealed record CommandRef(string Id, string Label, ConsoleRole MinRole, bool RowScoped);

/// <summary>A command reference placed as a table row action, with optional row->field prefill.</summary>
public sealed record RowActionRef(CommandRef Command, IReadOnlyDictionary<string, string>? Prefill = null);
