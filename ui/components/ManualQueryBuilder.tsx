'use client';

import { useState } from 'react';
import type { DynamoQuery } from '@/services/queryService';

interface Props {
  tables: string[];
  tablesLoading: boolean;
  onQueryChange: (q: DynamoQuery) => void;
}

const label: React.CSSProperties = { alignSelf: 'center', fontWeight: 'bold' };
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '140px 1fr',
  gap: '0.4rem 0.75rem',
  maxWidth: '500px',
  alignItems: 'start',
};

export default function ManualQueryBuilder({ tables, tablesLoading, onQueryChange }: Props) {
  const [table, setTable] = useState('');
  const [customTable, setCustomTable] = useState('');
  const [pk, setPk] = useState('');
  const [pkValue, setPkValue] = useState('');
  const [sk, setSk] = useState('');
  const [skValue, setSkValue] = useState('');
  const [operation, setOperation] = useState<'Query' | 'Scan'>('Query');

  const resolvedTable = table === '__custom__' ? customTable : table;

  function build() {
    const hasSk = sk && skValue;
    const keyCondition = hasSk ? `${pk} = :pk AND ${sk} = :sk` : `${pk} = :pk`;
    const expressionValues: Record<string, unknown> = { ':pk': pkValue };
    if (hasSk) expressionValues[':sk'] = skValue;

    onQueryChange({
      operation,
      table: resolvedTable,
      keyCondition: operation === 'Scan' ? '' : keyCondition,
      filterExpression: null,
      expressionValues: operation === 'Scan' ? null : expressionValues,
      indexName: null,
      limit: null,
    });
  }

  const canBuild = resolvedTable && (operation === 'Scan' || (pk && pkValue));

  return (
    <div style={grid}>
      <span style={label}>Operation</span>
      <select value={operation} onChange={e => setOperation(e.target.value as 'Query' | 'Scan')}>
        <option value="Query">Query</option>
        <option value="Scan">Scan</option>
      </select>

      <span style={label}>Table</span>
      <select value={table} onChange={e => setTable(e.target.value)} disabled={tablesLoading}>
        <option value="">{tablesLoading ? 'Loading tables…' : 'Select table'}</option>
        {tables.map(t => <option key={t} value={t}>{t}</option>)}
        <option value="__custom__">Custom...</option>
      </select>

      {table === '__custom__' && (
        <>
          <span style={label}>Table name</span>
          <input value={customTable} onChange={e => setCustomTable(e.target.value)} placeholder="my-table-name" />
        </>
      )}

      {operation === 'Query' && (
        <>
          <span style={label}>Partition Key</span>
          <input value={pk} onChange={e => setPk(e.target.value)} placeholder="e.g. PK" />

          <span style={label}>PK Value</span>
          <input value={pkValue} onChange={e => setPkValue(e.target.value)} placeholder="e.g. USER#123" />

          <span style={label}>Sort Key</span>
          <input value={sk} onChange={e => setSk(e.target.value)} placeholder="optional, e.g. SK" />

          <span style={label}>SK Value</span>
          <input value={skValue} onChange={e => setSkValue(e.target.value)} placeholder="optional, e.g. ORDER#456" />
        </>
      )}

      <div style={{ gridColumn: 'span 2', marginTop: '0.25rem' }}>
        <button onClick={build} disabled={!canBuild}>Build Query</button>
      </div>
    </div>
  );
}
