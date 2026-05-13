'use client';

import { useState, useEffect } from 'react';
import ResultsTable from '@/components/ResultsTable';
import {
  fetchLogGroups,
  generateCloudWatchQuery,
  runCloudWatchQuery,
  generateChronicle,
} from '@/services/cloudWatchService';
import type { CloudWatchQuery } from '@/services/cloudWatchService';

interface Props {
  selectedProfile: string;
}

const DEFAULT_LOOKBACK = 120;

const LOOKBACK_OPTIONS = [
  { label: 'Last 1 hour', value: 1 },
  { label: 'Last 6 hours', value: 6 },
  { label: 'Last 24 hours', value: 24 },
  { label: 'Last 3 days', value: 72 },
  { label: 'Last 5 days', value: 120 },
  { label: 'Last 7 days', value: 168 },
];

export default function CloudWatchExplorer({ selectedProfile }: Props) {
  const [logGroups, setLogGroups] = useState<string[]>([]);
  const [logGroupsLoading, setLogGroupsLoading] = useState(false);
  const [logGroupsError, setLogGroupsError] = useState<string | null>(null);

  const [nlText, setNlText] = useState('');
  const [query, setQuery] = useState<CloudWatchQuery | null>(null);
  const [queryJson, setQueryJson] = useState('');

  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [resultStatus, setResultStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [chronicle, setChronicle] = useState<string | null>(null);
  const [chronicleLoading, setChronicleLoading] = useState(false);
  const [chronicleError, setChronicleError] = useState<string | null>(null);

  useEffect(() => {
    loadLogGroups();
  }, [selectedProfile]);

  function loadLogGroups() {
    setLogGroups([]);
    setLogGroupsError(null);
    setLogGroupsLoading(true);
    fetchLogGroups(selectedProfile || undefined)
      .then(setLogGroups)
      .catch(e => setLogGroupsError(String(e)))
      .finally(() => setLogGroupsLoading(false));
  }

  function applyQuery(q: CloudWatchQuery) {
    setQuery(q);
    setQueryJson(JSON.stringify(q, null, 2));
  }

  async function handleGenerate() {
    if (!nlText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const q = await generateCloudWatchQuery(nlText, query?.logGroupName);
      applyQuery(q);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleExecute() {
    let q: CloudWatchQuery;
    try {
      q = JSON.parse(queryJson);
    } catch {
      setError('Query JSON is invalid. Fix it before executing.');
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);
    setChronicle(null);
    setChronicleError(null);
    try {
      const result = await runCloudWatchQuery({ ...q, profile: selectedProfile || null });
      setResults(result.items as Record<string, unknown>[]);
      setResultStatus(result.status);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleChronicle() {
    if (!results?.length || !query?.logGroupName) return;
    setChronicleLoading(true);
    setChronicleError(null);
    setChronicle(null);
    try {
      const resp = await generateChronicle(query.logGroupName, results, selectedProfile || null);
      setChronicle(resp.narrative);
    } catch (e) {
      setChronicleError(String(e));
    } finally {
      setChronicleLoading(false);
    }
  }

  return (
    <div>
      {/* Log group + time controls */}
      <section style={{ marginBottom: '1.5rem' }}>
        <h2>Log Groups</h2>
        {logGroupsLoading && <span style={{ color: '#888' }}>Loading log groups…</span>}
        {logGroupsError && (
          <span style={{ color: '#c0392b' }}>
            {logGroupsError}{' '}
            <button onClick={loadLogGroups} style={{ fontSize: '0.8rem' }}>Retry</button>
          </span>
        )}
        {!logGroupsLoading && !logGroupsError && (
          <select
            value={query?.logGroupName ?? ''}
            onChange={e => applyQuery({ logGroupName: e.target.value, queryString: query?.queryString ?? '', lookbackHours: query?.lookbackHours ?? DEFAULT_LOOKBACK })}
            style={{ minWidth: '320px', marginRight: '0.75rem' }}
          >
            <option value="">Select log group</option>
            {logGroups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        )}
        <select
          value={query?.lookbackHours ?? DEFAULT_LOOKBACK}
          onChange={e => applyQuery({ ...query!, lookbackHours: Number(e.target.value) })}
          disabled={!query}
        >
          {LOOKBACK_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </section>

      {/* AI query generation */}
      <section style={{ marginBottom: '1.5rem' }}>
        <h2>1. AI Query Generator</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '640px' }}>
          <textarea
            value={nlText}
            onChange={e => setNlText(e.target.value)}
            placeholder='e.g. "find all errors for case-123456 in the last 6 hours"'
            rows={3}
            style={{ width: '100%', fontFamily: 'inherit' }}
          />
          <button onClick={handleGenerate} disabled={loading || !nlText.trim()}>
            Generate Insights Query
          </button>
        </div>
      </section>

      {/* Editable query preview */}
      {queryJson && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h2>2. Query Preview (editable JSON)</h2>
          <textarea
            value={queryJson}
            onChange={e => setQueryJson(e.target.value)}
            rows={8}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.9rem' }}
          />
          <button
            onClick={handleExecute}
            disabled={loading}
            style={{ marginTop: '0.5rem' }}
          >
            {loading ? 'Running…' : `Execute on ${selectedProfile || 'default'}`}
          </button>
        </section>
      )}

      {/* Manual entry when no AI query generated yet */}
      {!queryJson && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h2>2. Manual Insights Query</h2>
          <textarea
            placeholder={`fields @timestamp, @message\n| filter @message like /your-pattern/\n| sort @timestamp desc\n| limit 100`}
            rows={6}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.9rem' }}
            onChange={e => {
              if (query?.logGroupName) {
                setQueryJson(JSON.stringify({ ...query, queryString: e.target.value }, null, 2));
              }
            }}
          />
          <button
            onClick={handleExecute}
            disabled={loading || !query?.logGroupName}
            style={{ marginTop: '0.5rem' }}
          >
            {loading ? 'Running…' : 'Execute'}
          </button>
        </section>
      )}

      {error && (
        <p style={{ color: '#c0392b', border: '1px solid #c0392b', padding: '0.5rem' }}>{error}</p>
      )}

      {results && (
        <section>
          <h2>
            3. Results ({results.length} items
            {resultStatus && resultStatus !== 'Complete' && ` · status: ${resultStatus}`})
          </h2>
          <ResultsTable items={results} />

          <div style={{ marginTop: '1rem' }}>
            <button
              onClick={handleChronicle}
              disabled={chronicleLoading || results.length === 0}
              style={{ fontWeight: 600 }}
            >
              {chronicleLoading ? 'Building chronicle…' : 'Build Chronicle'}
            </button>
            {chronicleError && (
              <p style={{ color: '#c0392b', marginTop: '0.5rem' }}>{chronicleError}</p>
            )}
          </div>
        </section>
      )}

      {chronicle && (
        <section style={{ marginTop: '1.5rem' }}>
          <h2>Chronicle</h2>
          <div style={{
            background: '#f8f9fa',
            border: '1px solid #dee2e6',
            borderRadius: '4px',
            padding: '1rem 1.25rem',
            lineHeight: '1.7',
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
          }}>
            {chronicle}
          </div>
        </section>
      )}
    </div>
  );
}
