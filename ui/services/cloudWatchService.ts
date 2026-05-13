const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';

export interface CloudWatchQuery {
  logGroupName: string;
  queryString: string;
  lookbackHours: number;
  profile?: string | null;
}

export interface CloudWatchQueryResult {
  items: Record<string, string | null>[];
  count: number;
  status: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

export async function fetchLogGroups(profile?: string): Promise<string[]> {
  const url = profile
    ? `${API_BASE}/cloudwatch/log-groups?profile=${encodeURIComponent(profile)}`
    : `${API_BASE}/cloudwatch/log-groups`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch log groups');
  return res.json();
}

export async function generateCloudWatchQuery(
  naturalLanguage: string,
  logGroupName?: string
): Promise<CloudWatchQuery> {
  return post<CloudWatchQuery>('/cloudwatch/generate-query', { naturalLanguage, logGroupName });
}

export async function runCloudWatchQuery(query: CloudWatchQuery): Promise<CloudWatchQueryResult> {
  return post<CloudWatchQueryResult>('/cloudwatch/query', query);
}

export interface ChronicleResponse {
  narrative: string;
  itemCount: number;
}

export async function generateChronicle(
  logGroupName: string,
  items: Record<string, unknown>[],
  profile?: string | null
): Promise<ChronicleResponse> {
  return post<ChronicleResponse>('/cloudwatch/chronicle', { logGroupName, items, profile });
}
