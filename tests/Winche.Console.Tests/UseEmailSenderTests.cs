using Microsoft.Extensions.DependencyInjection;
using Winche.Console;
using Winche.Console.Email;
using Xunit;

namespace Winche.Console.Tests;

/// <summary>
/// Verifies the ConsoleOptions.UseEmailSender helpers buffer a registration that AddWincheConsole
/// applies to the host's service collection. Pure DI — no database required.
/// </summary>
public class UseEmailSenderTests
{
    private sealed class FakeSender : IConsoleEmailSender
    {
        public Task SendPasswordResetAsync(ConsoleEmailRecipient u, string link, CancellationToken ct = default) => Task.CompletedTask;
        public Task SendInviteAsync(ConsoleEmailRecipient u, string link, CancellationToken ct = default) => Task.CompletedTask;
    }

    private static ServiceDescriptor? EmailDescriptor(IServiceCollection services) =>
        services.LastOrDefault(d => d.ServiceType == typeof(IConsoleEmailSender));

    [Fact]
    public void UseEmailSender_type_registers_with_chosen_lifetime()
    {
        var services = new ServiceCollection();
        services.AddWincheConsole(o =>
        {
            o.ConnectionString = "Host=localhost;Database=x";
            o.UseEmailSender<FakeSender>(ServiceLifetime.Scoped);
        });

        var descriptor = EmailDescriptor(services);
        Assert.NotNull(descriptor);
        Assert.Equal(ServiceLifetime.Scoped, descriptor!.Lifetime);
        Assert.Equal(typeof(FakeSender), descriptor.ImplementationType);
    }

    [Fact]
    public void UseEmailSender_factory_registers()
    {
        var services = new ServiceCollection();
        services.AddWincheConsole(o =>
        {
            o.ConnectionString = "Host=localhost;Database=x";
            o.UseEmailSender(_ => new FakeSender());
        });

        var descriptor = EmailDescriptor(services);
        Assert.NotNull(descriptor);
        Assert.Equal(ServiceLifetime.Singleton, descriptor!.Lifetime);
        Assert.NotNull(descriptor.ImplementationFactory);
    }

    [Fact]
    public void UseEmailSender_instance_registers_singleton()
    {
        var instance = new FakeSender();
        var services = new ServiceCollection();
        services.AddWincheConsole(o =>
        {
            o.ConnectionString = "Host=localhost;Database=x";
            o.UseEmailSender(instance);
        });

        var descriptor = EmailDescriptor(services);
        Assert.NotNull(descriptor);
        Assert.Equal(ServiceLifetime.Singleton, descriptor!.Lifetime);
        Assert.Same(instance, descriptor.ImplementationInstance);
    }

    [Fact]
    public void UseEmailSender_called_twice_last_write_wins()
    {
        var first = new FakeSender();
        var second = new FakeSender();
        var services = new ServiceCollection();
        services.AddWincheConsole(o =>
        {
            o.ConnectionString = "Host=localhost;Database=x";
            o.UseEmailSender(first);
            o.UseEmailSender(second);
        });

        var descriptor = EmailDescriptor(services);
        Assert.NotNull(descriptor);
        Assert.Same(second, descriptor!.ImplementationInstance);
    }

    [Fact]
    public void No_UseEmailSender_registers_nothing()
    {
        var services = new ServiceCollection();
        services.AddWincheConsole(o => o.ConnectionString = "Host=localhost;Database=x");

        Assert.Null(EmailDescriptor(services));
    }
}
