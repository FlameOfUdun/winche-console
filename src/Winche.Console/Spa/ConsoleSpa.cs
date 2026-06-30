using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.FileProviders;
using System.Text.RegularExpressions;

namespace Winche.Console.Spa;

/// <summary>
/// Serves the embedded React SPA under the console prefix. Built assets are embedded resources
/// (see the csproj). <c>index.html</c> is served for the prefix root and for any unmatched client
/// route, with a <c>&lt;base href&gt;</c> injected so the SPA's relative asset + API URLs resolve
/// under the consumer-chosen prefix.
/// </summary>
internal static class ConsoleSpa
{
    private static readonly IFileProvider Files =
        new ManifestEmbeddedFileProvider(typeof(ConsoleSpa).Assembly, "wwwroot");

    public static void Map(IEndpointRouteBuilder group, string prefix)
    {
        var baseHref = prefix.EndsWith('/') ? prefix : prefix + "/";
        // Catch-all under the group: specific API routes win; everything else is an asset or index.
        group.MapGet("/{**path}", async (HttpContext ctx, string? path) =>
        {
            var rel = string.IsNullOrEmpty(path) ? "index.html" : path;
            var file = Files.GetFileInfo(rel);
            if (rel == "index.html" || !file.Exists)
            {
                await ServeIndexAsync(ctx, baseHref);
                return;
            }
            ctx.Response.ContentType = ContentType(rel);
            ctx.Response.ContentLength = file.Length;
            await using var stream = file.CreateReadStream();
            await stream.CopyToAsync(ctx.Response.Body, ctx.RequestAborted);
        });
    }

    private static async Task ServeIndexAsync(HttpContext ctx, string baseHref)
    {
        var file = Files.GetFileInfo("index.html");
        using var reader = new StreamReader(file.CreateReadStream());
        var html = await reader.ReadToEndAsync(ctx.RequestAborted);
        var baseTag = $"<base href=\"{System.Net.WebUtility.HtmlEncode(baseHref)}\">";
        html = Regex.Replace(html, "<head[^>]*>", m => m.Value + baseTag, RegexOptions.IgnoreCase);
        // Cloudflare Rocket Loader rewrites <script type="module"> tags into a deferral placeholder and
        // then fails to load them as ES modules, which takes the whole SPA down ("Expected a JavaScript
        // module but the server responded with text/html"). data-cfasync="false" opts the bootstrap out
        // of Rocket Loader, so the console keeps working when the host app sits behind Cloudflare with
        // Rocket Loader enabled. https://developers.cloudflare.com/speed/optimization/content/rocket-loader/
        html = Regex.Replace(
            html,
            "<script(?![^>]*\\bdata-cfasync\\b)(?=[^>]*\\btype=\"module\")",
            "<script data-cfasync=\"false\"",
            RegexOptions.IgnoreCase);
        ctx.Response.ContentType = "text/html";
        await ctx.Response.WriteAsync(html, ctx.RequestAborted);
    }

    private static string ContentType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".js" => "text/javascript",
        ".css" => "text/css",
        ".html" => "text/html",
        ".json" => "application/json",
        ".map" => "application/json",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".ico" => "image/x-icon",
        ".woff2" => "font/woff2",
        ".woff" => "font/woff",
        _ => "application/octet-stream",
    };
}
