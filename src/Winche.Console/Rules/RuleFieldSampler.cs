using System.Text;
using System.Text.RegularExpressions;
using Winche.Database.Documents;
using Winche.Database.Querying.Ast;
using Winche.Database.Runtime;
using Winche.Database.Values;

namespace Winche.Console.Rules;

/// <summary>A field seen in sampled documents: its dotted path and the rule types it held.</summary>
public sealed record SampledField(string Path, IReadOnlyList<string> Types);

/// <summary>
/// Finds the fields of the documents a rules <c>match</c> pattern covers, for the editor's suggestions:
/// walks the pattern (literal segments directly, <c>{capture}</c> by listing a few collections / documents,
/// <c>{rest=**}</c> by descending a little — or, for <c>{path=**}/notes/{id}</c>, one collection group query on
/// <c>notes</c>), keeps only documents the pattern covers, reading at most <see cref="MaxDocuments"/> documents with at most
/// <see cref="MaxCalls"/> database calls. A hint, not a schema: only fields present in the sample show up.
/// </summary>
public sealed class RuleFieldSampler(DocumentDatabase db)
{
    public const int MaxDocuments = 50;
    public const int MaxCalls = 30;
    private const int PerWildcard = 10;
    private const int RecursiveDepth = 3;
    private const int FieldDepth = 4;
    private const int GroupSample = 200;

    // The paths a rules pattern covers, as Winche.Rules matches them: {x} one segment; {x=**} at the end one
    // or more, elsewhere zero or more.
    internal static Regex PatternRegex(string[] segments)
    {
        var sb = new StringBuilder("^");
        for (var i = 0; i < segments.Length; i++)
        {
            var s = segments[i];
            if (i > 0 && !(IsRecursive(segments[i - 1]) && i - 1 < segments.Length - 1)) sb.Append('/');
            if (IsRecursive(s)) sb.Append(i == segments.Length - 1 ? ".+" : "(?:[^/]+/)*");
            else if (IsCapture(s)) sb.Append("[^/]+");
            else sb.Append(Regex.Escape(s));
        }
        return new Regex(sb.Append('$').ToString(), RegexOptions.CultureInvariant);
    }

    public async Task<IReadOnlyList<SampledField>> SampleAsync(string pattern, CancellationToken ct = default)
    {
        var segments = pattern.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var state = new Walk();
        var recursive = Array.FindIndex(segments, IsRecursive);
        if (recursive >= 0 && recursive < segments.Length - 1 && segments.Length >= 2 && !IsCapture(segments[^2]) && !IsRecursive(segments[^2]))
        {
            // {path=**}/notes/{id}, users/{uid}/{p=**}/likes/{id}: one collection group query on the last
            // collection's id finds them under any parent; the pattern check below keeps the ones it covers.
            state.Calls++;
            var group = await db.QueryAsync(new Query(segments[^2], Limit: GroupSample, CollectionGroup: true), ct);
            foreach (var d in group.Documents) state.Documents.TryAdd(d.Path, d);
        }
        else
        {
            await DocumentLevelAsync("", segments, 0, state, ct);
        }

        var covers = PatternRegex(segments);
        var fields = new SortedDictionary<string, SortedSet<string>>(StringComparer.Ordinal);
        foreach (var doc in state.Documents.Values.Where(d => covers.IsMatch(d.Path)).Take(MaxDocuments))
            Collect(doc.Fields, "", fields, 0);
        return [.. fields.Select(f => new SampledField(f.Key, [.. f.Value]))];
    }

    private sealed class Walk
    {
        /// <summary>The documents the pattern covers: the sample.</summary>
        public Dictionary<string, Document> Documents { get; } = new(StringComparer.Ordinal);
        /// <summary>Every document read on the way, so one reached again isn't read twice.</summary>
        public Dictionary<string, Document> Read { get; } = new(StringComparer.Ordinal);
        public int Calls;
        public bool Full => Documents.Count >= MaxDocuments || Calls >= MaxCalls;
    }

    private static bool IsCapture(string s) => s.StartsWith('{') && s.EndsWith('}') && !s.Contains('=');
    private static bool IsRecursive(string s) => s.StartsWith('{') && s.EndsWith("=**}");

    // At a document (or the root, ""): the next segment names a collection under it.
    private async Task DocumentLevelAsync(string docPath, string[] segments, int i, Walk state, CancellationToken ct)
    {
        if (state.Full) return;
        if (i == segments.Length)
        {
            if (docPath.Length == 0 || state.Documents.ContainsKey(docPath)) return;
            if (state.Read.TryGetValue(docPath, out var known))
            {
                state.Documents[docPath] = known;
                return;
            }
            state.Calls++;
            if (await db.GetAsync(docPath, ct) is { } doc) state.Documents[docPath] = doc;
            return;
        }
        var segment = segments[i];
        if (IsRecursive(segment))
        {
            await DescendAsync(docPath, RecursiveDepth, state, ct);
            return;
        }
        var collections = IsCapture(segment) ? await CollectionsUnderAsync(docPath, state, ct) : [Join(docPath, segment)];
        foreach (var collection in collections)
        {
            if (state.Full) return;
            await CollectionLevelAsync(collection, segments, i + 1, state, ct);
        }
    }

    // At a collection: the next segment names a document in it.
    private async Task CollectionLevelAsync(string collection, string[] segments, int i, Walk state, CancellationToken ct)
    {
        if (state.Full || i == segments.Length) return;   // a pattern ending at a collection matches no documents
        var segment = segments[i];
        if (IsRecursive(segment))
        {
            foreach (var doc in await DocumentsInAsync(collection, state, ct))
            {
                state.Documents.TryAdd(doc.Path, doc);
                await DescendAsync(doc.Path, RecursiveDepth - 1, state, ct);
            }
            return;
        }
        var docs = IsCapture(segment) ? (await DocumentsInAsync(collection, state, ct)).Select(d => d.Path) : [Join(collection, segment)];
        foreach (var doc in docs)
        {
            if (state.Full) return;
            await DocumentLevelAsync(doc, segments, i + 1, state, ct);
        }
    }

    // {rest=**}: documents in the collections below docPath, a few levels down.
    private async Task DescendAsync(string docPath, int depth, Walk state, CancellationToken ct)
    {
        if (depth <= 0 || state.Full) return;
        foreach (var collection in await CollectionsUnderAsync(docPath, state, ct))
        {
            foreach (var doc in await DocumentsInAsync(collection, state, ct))
            {
                if (state.Full) return;
                state.Documents.TryAdd(doc.Path, doc);
                await DescendAsync(doc.Path, depth - 1, state, ct);
            }
        }
    }

    private async Task<List<string>> CollectionsUnderAsync(string docPath, Walk state, CancellationToken ct)
    {
        if (state.Full) return [];
        state.Calls++;
        var page = await db.ListCollectionIdsAsync(docPath, pageSize: PerWildcard, ct: ct);
        return [.. page.CollectionIds.Select(id => Join(docPath, id))];
    }

    private async Task<IReadOnlyList<Document>> DocumentsInAsync(string collection, Walk state, CancellationToken ct)
    {
        if (state.Full) return [];
        state.Calls++;
        var docs = (await db.QueryAsync(new Query(collection, Limit: PerWildcard), ct)).Documents;
        foreach (var d in docs) state.Read.TryAdd(d.Path, d);
        return docs;
    }

    private static string Join(string parent, string child) => parent.Length == 0 ? child : $"{parent}/{child}";

    private static void Collect(IReadOnlyDictionary<string, Value> fields, string prefix, SortedDictionary<string, SortedSet<string>> into, int depth)
    {
        foreach (var (name, value) in fields)
        {
            var path = prefix + name;
            if (!into.TryGetValue(path, out var types)) into[path] = types = new SortedSet<string>(StringComparer.Ordinal);
            types.Add(TypeOf(value));
            if (value is MapValue map && depth + 1 < FieldDepth) Collect(map.Fields, path + ".", into, depth + 1);
        }
    }

    // The type a rule sees (see Winche.Rules' `x is type`).
    private static string TypeOf(Value v) => v switch
    {
        NullValue => "null",
        BooleanValue => "bool",
        IntegerValue => "int",
        DoubleValue => "float",
        TimestampValue => "timestamp",
        StringValue => "string",
        BytesValue => "bytes",
        ReferenceValue => "path",
        ArrayValue => "list",
        _ => "map",   // map, geopoint
    };
}
