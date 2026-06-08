/**
 * Apple iTunes Search API wrapper - used to find alt-media political podcast
 * candidates for the panel. The "legacy" iTunes RSS top-charts endpoints are
 * effectively dead (return junk regardless of genre ID), so we use the still-
 * working Search API which is documented, free, no key required.
 *
 * Docs: https://developer.apple.com/documentation/itunes_store/searching_the_itunes_store
 */
export interface AppleSearchResult {
  collectionId: number;          // iTunes podcast id
  collectionName: string;        // show name
  artistName: string;            // network/host
  feedUrl?: string;
  primaryGenreName?: string;
  trackCount?: number;           // episode count
  releaseDate?: string;          // latest episode date
  artworkUrl100?: string;
}

export async function searchITunesPodcasts(
  term: string,
  limit = 50,
): Promise<AppleSearchResult[]> {
  const url =
    `https://itunes.apple.com/search?media=podcast` +
    `&term=${encodeURIComponent(term)}` +
    `&country=us&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes Search ${term}: ${res.status}`);
  const data = (await res.json()) as { results?: AppleSearchResult[] };
  return data.results || [];
}
