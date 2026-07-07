using System.Collections.Concurrent;
using System.ComponentModel.DataAnnotations;
using Winche.Console.Tabs;

namespace Winche.Console.Sample;

public enum UserRole { Viewer, Member, Admin }

/// <summary>Input for the "Create user" command. The record's constructor params + DataAnnotations ARE the form.</summary>
public sealed record CreateUserInput(
    [property: Display(Name = "Email"), Required, EmailAddress] string Email,
    [property: Required] UserRole Role,
    [property: Display(Name = "Active")] bool Active = true);

/// <summary>
/// Demo provider for the custom "Users" tab. Shows the full declarative-interactivity surface — buffered
/// search, pagination, a toolbar create-form command, and a row delete command — over a simple in-memory
/// store (static so edits persist for the app's lifetime; a real tab would hit a database).
/// </summary>
public sealed class UsersTab
{
    private sealed record Row(string Key, string Email, UserRole Role, bool Active);

    private static readonly ConcurrentDictionary<string, Row> Store = new();
    private static int _seq;

    static UsersTab()
    {
        Add("alice@winche.local", UserRole.Admin, true);
        Add("bob@winche.local", UserRole.Member, true);
        Add("carol@winche.local", UserRole.Viewer, false);
        for (var i = 1; i <= 20; i++)
            Add($"user{i:00}@winche.local", (UserRole)(i % 3), i % 4 != 0);
    }

    private static string Add(string email, UserRole role, bool active)
    {
        var key = $"u{Interlocked.Increment(ref _seq)}";
        Store[key] = new Row(key, email, role, active);
        return key;
    }

    public WidgetHandler<TableData> Rows => (ctx, ct) =>
    {
        var q = (ctx.Inputs.TryGetValue("q", out var s) ? s : null)?.Trim() ?? "";
        var (page, size) = ctx.Page("rows", 10);
        var filtered = Store.Values
            .Where(u => q.Length == 0 || u.Email.Contains(q, StringComparison.OrdinalIgnoreCase))
            .OrderBy(u => u.Email, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var pageRows = filtered.Skip((page - 1) * size).Take(size);
        TableData table = TableData.From(pageRows)
            .Key(u => u.Key)
            .Column("Email", u => u.Email)
            .Column("Role", u => u.Role.ToString())
            .Column("Active", u => u.Active ? "yes" : "no")
            .Total(filtered.Count);
        return Task.FromResult(table);
    };

    public CommandHandler<CreateUserInput> CreateUser => (ctx, ct) =>
    {
        var email = ctx.Input.Email.Trim();
        if (Store.Values.Any(u => string.Equals(u.Email, email, StringComparison.OrdinalIgnoreCase)))
            return Task.FromResult(CommandResult.Invalid(nameof(CreateUserInput.Email), "That email already exists."));
        Add(email, ctx.Input.Role, ctx.Input.Active);
        return Task.FromResult(CommandResult.Ok($"Created {email}"));
    };

    public CommandHandler DeleteUser => (ctx, ct) =>
        ctx.RowKey is { } key && Store.TryRemove(key, out var removed)
            ? Task.FromResult(CommandResult.Ok($"Deleted {removed.Email}"))
            : Task.FromResult(CommandResult.Fail("User not found."));
}
