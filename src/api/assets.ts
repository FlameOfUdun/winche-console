/** A file of a release: its content's hash, size and type. */
/** A file of a release; `url` is set for one kept on a CDN (apps never see it: they get short-lived signed links). */
export interface AssetFileEntry { path: string; hash: string; size: number; mimeType: string; url?: string | null }

/** A CDN releases may name files on (CloudFront signed links); its private key is a project secret. */
export interface AssetCdn {
  id: string; kind: string; baseUrl: string; keyPairId: string; linkMinutes: number;
  key: { setAt: string; setBy: string | null; reference: string | null } | null;
}

/** GET assets/cdns. */
export interface AssetCdnsState { cdns: AssetCdn[]; editable: boolean; secretsAvailable: boolean }

export interface AssetCdnTest { ok: boolean; status: number; message: string }

export interface AssetReleaseSummary { number: number; note: string | null; by: string | null; at: string; files: number; size: number }

export interface AssetRelease { number: number; note: string | null; by: string | null; at: string; size: number; files: AssetFileEntry[] }

export interface AssetChannel { name: string; release: number; updatedAt: string; by: string | null }

/** GET assets/channels/{name}/files: what apps get on a channel now; `since` is the release each file's content arrived in. */
export interface AssetLiveFiles {
  channel: string; release: number; publishedAt: string; note: string | null; by: string | null; size: number;
  files: (AssetFileEntry & { since: number })[];
}

export interface AssetChannelMove { channel: string; from: number | null; to: number; at: string; by: string | null }

export interface AssetDiff { added: string[]; changed: string[]; removed: string[] }

/** GET api/assets: the page at a glance. */
export interface AssetsPageData {
  channels: AssetChannel[];
  releases: AssetReleaseSummary[];
  limits: { maxFilesPerRelease: number; maxFileBytes: number; keepReleases: number };
  location: string;
  moving: { to: string; copied: number; total: number; error: string | null; startedAt: string | null } | null;
}

/** GET assets/location: where contents are kept, and a move under way. */
export interface AssetLocationState {
  active: import("./dataSettings").ArchiveLocation | null;
  activeLabel: string;
  /** The app's own location, in words. */
  codeLabel: string;
  move: { to: import("./dataSettings").ArchiveLocation; copied: number; total: number; error: string | null; startedAt: string | null } | null;
  editable: boolean;
  secretsAvailable: boolean;
}

export const bytes = (n: number) =>
  n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
