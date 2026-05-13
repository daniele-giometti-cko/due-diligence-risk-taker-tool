'use client';

import { useState } from 'react';

interface Props {
  tables: string[];
  tablesLoading: boolean;
  onGenerate: (text: string, tableName?: string) => void;
  disabled: boolean;
}

export default function QueryInput({ tables, tablesLoading, onGenerate, disabled }: Props) {
  const [text, setText] = useState('');
  const [table, setTable] = useState('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '600px' }}>
      {(tablesLoading || tables.length > 0) && (
        <select value={table} onChange={e => setTable(e.target.value)} disabled={tablesLoading}>
          <option value="">{tablesLoading ? 'Loading tables…' : 'All tables (AI decides)'}</option>
          {tables.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      )}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder='e.g. "Get all items where PK is USER#123 and SK starts with ORDER"'
        rows={3}
        style={{ width: '100%', fontFamily: 'inherit' }}
      />
      <button
        onClick={() => onGenerate(text, table || undefined)}
        disabled={disabled || !text.trim()}
      >
        Generate Query
      </button>
    </div>
  );
}
