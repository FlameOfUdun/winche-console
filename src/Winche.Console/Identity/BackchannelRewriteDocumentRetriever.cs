using Microsoft.IdentityModel.Protocols;

namespace Winche.Console.Identity;

/// <summary>
/// Backchannel document retriever that rewrites the public Keycloak base URL to the internal
/// <see cref="Winche.Console.Options.KeycloakOptions.BackchannelServer"/> base for every fetch — both the
/// discovery document and the JWKS. Keycloak advertises the JWKS (<c>jwks_uri</c>) using its configured
/// public frontend hostname, so fetching discovery internally is not enough on its own: without this rewrite
/// the follow-up JWKS request would still go to the public host and fail when that host is unreachable
/// server-to-server. Allows plain HTTP so the internal endpoint can be reached without TLS.
/// </summary>
internal sealed class BackchannelRewriteDocumentRetriever(string publicBase, string backchannelBase) : IDocumentRetriever
{
    private readonly HttpDocumentRetriever _inner = new() { RequireHttps = false };

    public Task<string> GetDocumentAsync(string address, CancellationToken cancel)
    {
        if (address.StartsWith(publicBase, StringComparison.OrdinalIgnoreCase))
            address = backchannelBase + address[publicBase.Length..];
        return _inner.GetDocumentAsync(address, cancel);
    }
}
