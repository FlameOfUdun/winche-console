using Winche.Console.Tabs;

namespace Winche.Console.Sample;

/// <summary>In-memory note list so the sample island's mutation has visible, refetchable state.</summary>
public static class NoteStore
{
    private static readonly object Gate = new();
    private static readonly List<string> Notes = new();

    public static int Add(string text)
    {
        lock (Gate) { Notes.Add(text); return Notes.Count; }
    }

    public static int Count
    {
        get { lock (Gate) { return Notes.Count; } }
    }
}

/// <summary>Sibling declarative widget: a KPI that reflects the store, so the island's refetch signal is visible.</summary>
public sealed class NotesTabProvider : ITabData
{
    public Task<StatRowData> Summary(WidgetContext ctx, CancellationToken ct) =>
        Task.FromResult(new StatRowData(new Stat("Notes", NoteStore.Count)));
}

/// <summary>Request/response shapes for the sample plugin endpoints (no anonymous objects).</summary>
public sealed record NoteRequest(string Text);
public sealed record NoteCountResponse(int Count);

/// <summary>The escape-hatch island: a text field + button that POSTs a note, then fires notify/refetch/resize.</summary>
public static class NotesIsland
{
    public const string Html = """
    <!doctype html>
    <html>
    <head><meta charset="utf-8"><style>
      body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; }
      .row { display: flex; gap: 8px; }
      input { flex: 1; padding: 8px; }
      button { padding: 8px 16px; cursor: pointer; }
      .hint { color: #666; font-size: 13px; margin-top: 8px; }
    </style></head>
    <body>
      <div class="row">
        <input id="text" placeholder="Write a note…" />
        <button id="add">Add note</button>
      </div>
      <div class="hint" id="hint">Adds a note and refreshes the KPI above.</div>
      <script>
        var parentOrigin = window.location.origin;
        var bearer = null;
        function post(msg) { window.parent.postMessage(msg, parentOrigin); }
        function reportHeight() { post({ type: "winche:resize", height: document.body.scrollHeight }); }

        window.addEventListener("message", function (e) {
          if (e.source !== window.parent) return;
          if (e.origin !== parentOrigin) return;
          if (!e.data) return;
          if (e.data.type === "winche:init") {
            bearer = e.data.token || null;   // Keycloak mode; null in Identity mode (cookie authenticates)
            document.getElementById("hint").textContent =
              "Signed in as " + (e.data.user ? e.data.user.email : "guest") + " · theme " + e.data.theme;
          } else if (e.data.type === "winche:token") {
            bearer = e.data.token || null;   // silent-renewal refresh
          }
        });

        document.getElementById("add").addEventListener("click", function () {
          var text = document.getElementById("text").value.trim();
          if (!text) return;
          var headers = { "Content-Type": "application/json" };
          if (bearer) headers["Authorization"] = "Bearer " + bearer;   // Keycloak; cookie covers Identity mode
          fetch("/plugins/api/notes", {
            method: "POST",
            headers: headers,
            credentials: "same-origin",
            body: JSON.stringify({ text: text })
          }).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
            .then(function (res) {
              document.getElementById("text").value = "";
              post({ type: "winche:notify", level: "success", message: "Note added (" + res.count + " total)" });
              post({ type: "winche:refetch" });
              reportHeight();
            })
            .catch(function () {
              post({ type: "winche:notify", level: "error", message: "Could not add note" });
            });
        });

        post({ type: "winche:ready" });
        reportHeight();
      </script>
    </body>
    </html>
    """;
}
