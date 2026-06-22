using Winche.Storage.Interfaces;
using Winche.Storage.Models;

namespace SampleHost;

/// <summary>
/// Test object archive: metadata lives in PostgreSQL; presigned upload/download URLs are canned (no real
/// object store), and objects are treated as always-present so ConfirmUpload succeeds. Lets the console's
/// storage endpoints (upload-url / confirm / download-url) be exercised without standing up MinIO/S3.
/// </summary>
public sealed class NoOpArchive : IArchive
{
    private static NotSupportedException NoMultipart() => new("Multipart upload is not configured for tests.");

    public Task DeleteAsync(string path, CancellationToken ct = default) => Task.CompletedTask;
    public Task DeleteObjectsAsync(IEnumerable<string> paths, CancellationToken ct = default) => Task.CompletedTask;
    public Task<bool> ObjectExistsAsync(string path, CancellationToken ct = default) => Task.FromResult(true);

    public Task<UploadSession> GenerateUploadUrlAsync(string path, string mimeType, long sizeBytes, CancellationToken ct = default) =>
        Task.FromResult(new UploadSession { Url = $"https://fake-archive.test/upload/{path}", ExpiresAt = DateTime.UtcNow.AddMinutes(15) });
    public Task<DownloadSession> GenerateDownloadUrlAsync(string path, CancellationToken ct = default) =>
        Task.FromResult(new DownloadSession { Url = $"https://fake-archive.test/download/{path}", ExpiresAt = DateTime.UtcNow.AddMinutes(15) });

    public Task<string> CreateMultipartUploadAsync(string path, string mimeType, CancellationToken ct = default) => throw NoMultipart();
    public Task<UploadSession> SignPartAsync(string path, string uploadId, int partNumber, CancellationToken ct = default) => throw NoMultipart();
    public Task CompleteMultipartUploadAsync(string path, string uploadId, CancellationToken ct = default) => throw NoMultipart();
    public Task<IEnumerable<FilePart>> ListPartsAsync(string path, string uploadId, CancellationToken ct = default) => throw NoMultipart();
    public Task AbortMultipartUploadAsync(string path, string uploadId, CancellationToken ct = default) => throw NoMultipart();
}
