export interface AppSetupService { id: string; path: string; livePath: string | null }
export interface AppSetupProvider { name: string; kind: string; displayName: string; clientIds: string[] }

/** What an app needs to connect, as GET /.well-known/winche publishes it. */
export interface AppSetup {
  projectId: string; name: string | null; baseUrl: string;
  services: AppSetupService[]; providers: AppSetupProvider[];
}

export interface AppsPageData {
  setup: AppSetup;
  platforms: string[];
  /** lib/winche_options.dart for the platforms asked. */
  file: string;
  /** What to add to main(). */
  snippet: string;
}

export const PLATFORM_LABEL: Record<string, string> = {
  android: "Android", ios: "iOS", macos: "macOS", web: "Web", windows: "Windows", linux: "Linux",
};

/** Requests today and over the last 7 days, and when the last was. */
export interface Usage { today: number; last7Days: number; lastSeen: string | null }

/** Each product's mode: not checked, checked and counted (never refused), or refused without a valid token. */
export type IntegrityMode = "off" | "monitor" | "enforce";

/** An app of the project (Integrity → Apps): what identifies it on each platform, and its requests per product. */
export interface IntegrityApp {
  id: string; name: string; sdk: string; androidPackage: string | null; appleBundleId: string | null; appleTeamId: string | null;
  createdAt: string; usage: Record<string, Usage>;
}

export interface IntegrityDebugToken { id: string; app: string; name: string; createdAt: string; createdBy: string | null }

export interface IntegrityData {
  available: boolean;
  /** Whether tokens can be made here (the server has a master key). */
  canSign: boolean;
  editable: boolean;
  products: string[];
  enforcement: Record<string, IntegrityMode>;
  tokenMinutes: number;
  apps: IntegrityApp[];
  /** Requests without a valid Integrity token, per product. */
  unverified: Record<string, Usage>;
  debugTokens: IntegrityDebugToken[];
}

export interface AppFields {
  name: string; sdk: string; androidPackage: string | null; appleBundleId: string | null; appleTeamId: string | null;
  /** Chosen when adding (blank: one is made); fixed after. */
  id?: string;
}
