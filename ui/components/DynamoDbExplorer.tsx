'use client';

import { useState, useEffect } from 'react';
import QueryInput from '@/components/QueryInput';
import ManualQueryBuilder from '@/components/ManualQueryBuilder';
import QueryPreview from '@/components/QueryPreview';
import ResultsTable from '@/components/ResultsTable';
import {
  fetchProfiles,
  fetchEnvLabels,
  fetchTables,
  generateQuery,
  executeQuery,
  type DynamoQuery,
} from '@/services/queryService';

const EMPTY_QUERY: DynamoQuery = {
  operation: 'Query',
  table: '',
  keyCondition: '',
  filterExpression: null,
  expressionValues: null,
  indexName: null,
  limit: null,
  profile: null,
};

export default function DynamoDbExplorer() {
  const [profiles, setProfiles] = useState<string[]>([]);
  const [envLabels, setEnvLabels] = useState<Record<string, string>>({});
  const [selectedProfile, setSelectedProfile] = useState<string>('');

  const [tables, setTables] = useState<string[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);

  const [query, setQuery] = useState<DynamoQuery | null>(null);
  const [items, setItems] = useState<Record<string, unknown>[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProfiles().then(setProfiles).catch(() => setProfiles([]));
    fetchEnvLabels().then(setEnvLabels).catch(() => setEnvLabels({}));
  }, []);

  useEffect(() => {
    setTablesLoading(true);
    setTables([]);
    fetchTables(selectedProfile || undefined)
      .then(setTables)
      .catch(() => setTables([]))
      .finally(() => setTablesLoading(false));
  }, [selectedProfile]);

  async function handleGenerate(text: string, tableName?: string) {
    setLoading(true);
    setError(null);
    try {
      const q = await generateQuery(text, tableName);
      setQuery({ ...q, profile: selectedProfile || null });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleExecute() {
    if (!query) return;
    setLoading(true);
    setError(null);
    setItems(null);
    try {
      const resp = await executeQuery({ ...query, profile: selectedProfile || null });
      setItems(resp.items);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p style={{ color: '#555', marginTop: 0 }}>
        Ad-hoc DynamoDB queries for lower environments (QA). Pick a profile, generate or build a query,
        review the JSON, then execute.
      </p>

      <section style={{ marginBottom: '1.25rem' }}>
        <label style={{ marginRight: '0.5rem', fontWeight: 600 }}>AWS profile:</label>
        <select value={selectedProfile} onChange={e => setSelectedProfile(e.target.value)}>
          <option value="">(default credentials)</option>
          {profiles.map(p => (
            <option key={p} value={p}>
              {envLabels[p] ? `${envLabels[p]} — ${p}` : p}
            </option>
          ))}
        </select>
      </section>

      <section style={{ marginBottom: '1.5rem' }}>
        <h2>1. AI Query Generator</h2>
        <QueryInput
          tables={tables}
          tablesLoading={tablesLoading}
          onGenerate={handleGenerate}
          disabled={loading}
        />
      </section>

      <section style={{ marginBottom: '1.5rem' }}>
        <h2>2. Manual Query Builder</h2>
        <ManualQueryBuilder
          tables={tables}
          tablesLoading={tablesLoading}
          onQueryChange={q => setQuery({ ...q, profile: selectedProfile || null })}
        />
      </section>

      {query && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h2>3. Query Preview (editable JSON)</h2>
          <QueryPreview query={query} onChange={setQuery} />
          <button
            onClick={handleExecute}
            disabled={loading || !query.table}
            style={{ marginTop: '0.5rem', fontWeight: 600 }}
          >
            {loading ? 'Running…' : `Execute on ${selectedProfile || 'default'}`}
          </button>
        </section>
      )}

      {error && (
        <p style={{ color: '#c0392b', border: '1px solid #c0392b', padding: '0.5rem' }}>{error}</p>
      )}

      {items && (
        <section>
          <h2>4. Results ({items.length} items)</h2>
          <ResultsTable items={items} />
        </section>
      )}
    </div>
  );
}
