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
