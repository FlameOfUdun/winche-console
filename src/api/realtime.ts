/** A list as the Realtime page shows it (GET realtime/lists). */
export interface RealtimeList {
  path: string;
  state: "open" | "closed";
  count: number;
  bytes: number;
  openedAt: string;
  closedAt: string | null;
}

/** GET realtime/lists: a page of lists, by path; `next` is the `after` of the page after it. */
export interface RealtimeListsPage { lists: RealtimeList[]; next: string | null }

/** An item of a list: its payload as text when it's UTF-8 (often JSON), else null. */
export interface RealtimeItem { key: string | null; position: number; at: string; by: string | null; size: number; text: string | null }

/** GET realtime/lists/items: the list and a page of its items (from `after`). */
export interface RealtimeItemsPage { list: RealtimeList; items: RealtimeItem[] }

/** GET realtime/presence: who's present at a path. */
export interface RealtimePresenceMember { uid: string; data: unknown; joinedAt: string }

/** Realtime → Settings (the settings area "realtime"). */
export interface RealtimeSettings {
  /** Hours without a new item before an open list is closed; null: never. */
  idleCloseHours: number | null;
  retainClosedDays: number;
  archiveClosedLists: boolean;
  maxItemKb: number;
  maxListItems: number;
  maxListMb: number;
}
