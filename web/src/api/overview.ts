/** GET api/overview: the console's home page. */
export interface Overview {
  project: { id: string; name: string };
  products: { id: string; name: string; path: string; on: boolean; about: string; stats: { label: string; value: string }[] }[];
  changes: { at: string; what: string; by: string | null }[];
}
