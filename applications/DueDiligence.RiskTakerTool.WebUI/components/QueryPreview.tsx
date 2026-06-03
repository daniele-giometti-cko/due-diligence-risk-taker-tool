'use client';

import type { DynamoQuery } from '@/services/queryService';

interface Props {
  query: DynamoQuery;
  onChange: (q: DynamoQuery) => void;
}

export default function QueryPreview({ query, onChange }: Props) {
  const serialized = JSON.stringify(query, null, 2);

  function handleChange(raw: string) {
    try {
      onChange(JSON.parse(raw));
    } catch {
      // Let the user keep typing without resetting the field
    }
  }

  return (
    <textarea
      // key forces a re-render when the query is replaced from outside (AI or builder),
      // so the textarea reflects the new value rather than staying in the user's edited state.
      key={serialized}
      defaultValue={serialized}
      onChange={e => handleChange(e.target.value)}
      rows={14}
      style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.9rem' }}
    />
  );
}
