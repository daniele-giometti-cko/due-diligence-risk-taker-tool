'use client';

import { useState } from 'react';
import DatadogChronicle from '@/components/DatadogChronicle';
import DynamoDbExplorer from '@/components/DynamoDbExplorer';

type Tab = 'datadog' | 'dynamodb';

const TABS: { id: Tab; label: string }[] = [
  { id: 'datadog', label: 'Datadog Chronicle' },
  { id: 'dynamodb', label: 'DynamoDB (QA)' },
];

export default function Page() {
  const [tab, setTab] = useState<Tab>('datadog');

  return (
    <div>
      <h1>Agentic - Logs Teller</h1>

      <nav style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid #ccc', marginBottom: '1.25rem' }}>
        {TABS.map(t => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '0.5rem 1rem',
                background: active ? '#fff' : '#f3f3f3',
                border: '1px solid #ccc',
                borderBottom: active ? '1px solid #fff' : '1px solid #ccc',
                marginBottom: '-1px',
                borderRadius: '4px 4px 0 0',
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'datadog' && <DatadogChronicle />}
      {tab === 'dynamodb' && <DynamoDbExplorer />}
    </div>
  );
}
