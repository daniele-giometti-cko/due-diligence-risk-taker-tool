const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';

export interface DynamoQuery {
  operation: 'Query' | 'Scan';
  table: string;
  keyCondition: string;
  filterExpression: string | null;
  expressionValues: Record<string, unknown> | null;
  indexName: string | null;
  limit: number | null;
  profile?: string | null;
}

export interface ExecuteQueryResponse {
  items: Record<string, unknown>[];
  count: number;
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

export async function fetchProfiles(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/query/profiles`);
  if (!res.ok) throw new Error('Failed to fetch profiles');
  return res.json();
}

export async function fetchEnvLabels(): Promise<Record<string, string>> {
  const res = await fetch(`${API_BASE}/query/env-labels`);
  if (!res.ok) return {};
  return res.json();
}

export async function fetchTables(profile?: string): Promise<string[]> {
  const url = profile
    ? `${API_BASE}/query/tables?profile=${encodeURIComponent(profile)}`
    : `${API_BASE}/query/tables`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch tables');
  return res.json();
}

export async function generateQuery(naturalLanguage: string, tableName?: string): Promise<DynamoQuery> {
  return post<DynamoQuery>('/query/generate-query', { naturalLanguage, tableName });
}

export async function executeQuery(query: DynamoQuery): Promise<ExecuteQueryResponse> {
  return post<ExecuteQueryResponse>('/query/execute-query', query);
}
