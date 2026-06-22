using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Winche.Console.Identity;

/// <summary>The console's own auth database: ASP.NET Core Identity users + roles.</summary>
public sealed class ConsoleIdentityDbContext(DbContextOptions<ConsoleIdentityDbContext> options)
    : IdentityDbContext<ConsoleUser, IdentityRole<Guid>, Guid>(options);
