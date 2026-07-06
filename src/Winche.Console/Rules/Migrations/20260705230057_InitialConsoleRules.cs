using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Winche.Console.Rules.Migrations
{
    /// <inheritdoc />
    public partial class InitialConsoleRules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "console_rule_versions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Subsystem = table.Column<string>(type: "text", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    RulesJson = table.Column<string>(type: "text", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    Note = table.Column<string>(type: "text", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: true),
                    RevertedFromVersion = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_console_rule_versions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_console_rule_versions_Subsystem_IsActive",
                table: "console_rule_versions",
                columns: new[] { "Subsystem", "IsActive" });

            migrationBuilder.CreateIndex(
                name: "IX_console_rule_versions_Subsystem_Version",
                table: "console_rule_versions",
                columns: new[] { "Subsystem", "Version" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "console_rule_versions");
        }
    }
}
