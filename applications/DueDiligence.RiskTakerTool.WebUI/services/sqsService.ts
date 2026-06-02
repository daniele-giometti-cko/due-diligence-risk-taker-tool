const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';

export interface SqsQueue {
  url: string;
  name: string;
  fifo: boolean;
}

export interface SqsMessageAttribute {
  name: string;
  dataType: 'String' | 'Number';
  value: string;
}

export interface SqsSendRequest {
  queueUrl: string;
  body: string;
  messageAttributes?: SqsMessageAttribute[];
  messageGroupId?: string | null;
  messageDeduplicationId?: string | null;
  profile?: string | null;
}

export interface SqsSendResponse {
  messageId: string;
  sequenceNumber?: string | null;
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

export async function fetchQueues(profile?: string): Promise<SqsQueue[]> {
  const url = profile
    ? `${API_BASE}/sqs/queues?profile=${encodeURIComponent(profile)}`
    : `${API_BASE}/sqs/queues`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch queues (API ${res.status})`);
  return res.json();
}

export async function sendMessage(req: SqsSendRequest): Promise<SqsSendResponse> {
  return post<SqsSendResponse>('/sqs/send', req);
}

export async function purgeQueue(
  queueUrl: string,
  confirmation: string,
  profile?: string | null,
): Promise<{ purged: string }> {
  return post<{ purged: string }>('/sqs/purge', { queueUrl, confirmation, profile });
}
