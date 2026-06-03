'use client';

import { useState, useEffect } from 'react';
import { fetchProfiles, fetchEnvLabels } from '@/services/queryService';
import {
  fetchQueues,
  sendMessage,
  purgeQueue,
  type SqsQueue,
  type SqsMessageAttribute,
} from '@/services/sqsService';

const EXAMPLE_BODY = `{
  "eventType": "example.event",
  "id": "123",
  "data": {}
}`;

export default function SqsExplorer() {
  const [profiles, setProfiles] = useState<string[]>([]);
  const [envLabels, setEnvLabels] = useState<Record<string, string>>({});
  const [selectedProfile, setSelectedProfile] = useState<string>('');

  const [queues, setQueues] = useState<SqsQueue[]>([]);
  const [queuesLoading, setQueuesLoading] = useState(false);
  const [queueUrl, setQueueUrl] = useState<string>('');
  const [queueQuery, setQueueQuery] = useState('');   // autocomplete filter text
  const [showQueues, setShowQueues] = useState(false);

  const [body, setBody] = useState<string>(EXAMPLE_BODY);
  const [attributes, setAttributes] = useState<SqsMessageAttribute[]>([]);
  const [groupId, setGroupId] = useState('');
  const [dedupId, setDedupId] = useState('');

  const [pendingSend, setPendingSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // purge danger zone
  const [purgeConfirm, setPurgeConfirm] = useState('');
  const [purging, setPurging] = useState(false);

  useEffect(() => {
    fetchProfiles().then(setProfiles).catch(() => setProfiles([]));
    fetchEnvLabels().then(setEnvLabels).catch(() => setEnvLabels({}));
  }, []);

  useEffect(() => {
    setQueuesLoading(true);
    setQueues([]);
    setQueueUrl('');
    setQueueQuery('');
    setShowQueues(false);
    fetchQueues(selectedProfile || undefined)
      .then(setQueues)
      .catch(e => setError(String(e)))
      .finally(() => setQueuesLoading(false));
  }, [selectedProfile]);

  const selectedQueue = queues.find(q => q.url === queueUrl);
  const isFifo = selectedQueue?.fifo ?? false;
  const queueName = selectedQueue?.name ?? '';

  const q = queueQuery.trim().toLowerCase();
  const filteredQueues = q ? queues.filter(x => x.name.toLowerCase().includes(q)) : queues;
  const QUEUE_LIMIT = 100;

  let bodyJsonError: string | null = null;
  if (body.trim()) {
    try { JSON.parse(body); } catch { bodyJsonError = 'Body is not valid JSON (you can still send it as a raw string).'; }
  }

  function updateAttr(i: number, patch: Partial<SqsMessageAttribute>) {
    setAttributes(prev => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }
  function addAttr() {
    setAttributes(prev => [...prev, { name: '', dataType: 'String', value: '' }]);
  }
  function removeAttr(i: number) {
    setAttributes(prev => prev.filter((_, idx) => idx !== i));
  }

  async function confirmSend() {
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const resp = await sendMessage({
        queueUrl,
        body,
        messageAttributes: attributes.filter(a => a.name.trim()),
        messageGroupId: isFifo ? groupId || null : null,
        messageDeduplicationId: isFifo ? dedupId || null : null,
        profile: selectedProfile || null,
      });
      setResult(`Sent ✓  messageId=${resp.messageId}${resp.sequenceNumber ? `  seq=${resp.sequenceNumber}` : ''}`);
      setPendingSend(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  async function handlePurge() {
    setPurging(true);
    setError(null);
    setResult(null);
    try {
      const resp = await purgeQueue(queueUrl, purgeConfirm.trim(), selectedProfile || null);
      setResult(`Purged ✓  ${resp.purged}`);
      setPurgeConfirm('');
    } catch (e) {
      setError(String(e));
    } finally {
      setPurging(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: 'monospace', padding: '0.3rem', border: '1px solid #ccc', borderRadius: 3,
  };

  return (
    <div>
      <p style={{ color: '#555', marginTop: 0 }}>
        Craft and <strong>send</strong> an SQS message, or <strong>purge</strong> a queue. These are
        mutating actions and run against whatever account your selected AWS profile points to —
        including production. Review before sending.
      </p>

      {/* profile + queue */}
      <section style={{ marginBottom: '1.25rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>AWS profile</label>
          <select value={selectedProfile} onChange={e => setSelectedProfile(e.target.value)} style={inputStyle}>
            <option value="">(default credentials)</option>
            {profiles.map(p => (
              <option key={p} value={p}>{envLabels[p] ? `${envLabels[p]} — ${p}` : p}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 320, position: 'relative' }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>
            Queue {queuesLoading ? '(loading…)' : `(${queues.length})`}
          </label>
          <input
            type="text"
            placeholder={queues.length ? 'Type to filter queues…' : '— no queues —'}
            value={queueQuery}
            disabled={queuesLoading || queues.length === 0}
            onChange={e => { setQueueQuery(e.target.value); setQueueUrl(''); setShowQueues(true); }}
            onFocus={() => setShowQueues(true)}
            onBlur={() => setTimeout(() => setShowQueues(false), 150)}
            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
          />
          {queueUrl && !showQueues && <span style={{ color: '#1e7e34', marginLeft: '0.4rem' }}>✓</span>}
          {showQueues && !queuesLoading && (
            <ul style={{
              listStyle: 'none', margin: 0, padding: 0, position: 'absolute', zIndex: 10, left: 0, right: 0,
              background: '#fff', border: '1px solid #ccc', borderTop: 'none',
              maxHeight: 260, overflowY: 'auto', boxSizing: 'border-box', boxShadow: '0 4px 8px rgba(0,0,0,0.08)',
            }}>
              {filteredQueues.slice(0, QUEUE_LIMIT).map(qq => (
                <li
                  key={qq.url}
                  onMouseDown={() => { setQueueUrl(qq.url); setQueueQuery(qq.name); setShowQueues(false); }}
                  style={{
                    padding: '0.35rem 0.5rem', cursor: 'pointer', fontSize: '0.9rem',
                    borderBottom: '1px solid #f0f0f0',
                    background: qq.url === queueUrl ? '#eef5fc' : '#fff',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f4f9fd')}
                  onMouseLeave={e => (e.currentTarget.style.background = qq.url === queueUrl ? '#eef5fc' : '#fff')}
                >
                  {qq.name}{qq.fifo ? '  (FIFO)' : ''}
                </li>
              ))}
              {filteredQueues.length > QUEUE_LIMIT && (
                <li style={{ padding: '0.35rem 0.5rem', color: '#888', fontSize: '0.85rem' }}>
                  …{filteredQueues.length - QUEUE_LIMIT} more — keep typing to narrow
                </li>
              )}
              {filteredQueues.length === 0 && (
                <li style={{ padding: '0.35rem 0.5rem', color: '#888', fontSize: '0.85rem' }}>No match</li>
              )}
            </ul>
          )}
        </div>
      </section>

      {queueUrl && (
        <>
          {/* body */}
          <section style={{ marginBottom: '1.25rem' }}>
            <h2 style={{ marginBottom: '0.25rem' }}>Message body</h2>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={10}
              spellCheck={false}
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
            />
            {bodyJsonError && <p style={{ color: '#b8860b', margin: '0.25rem 0 0' }}>⚠ {bodyJsonError}</p>}
          </section>

          {/* attributes */}
          <section style={{ marginBottom: '1.25rem' }}>
            <h2 style={{ marginBottom: '0.25rem' }}>Message attributes</h2>
            {attributes.length === 0 && <p style={{ color: '#888', margin: '0.25rem 0' }}>None.</p>}
            {attributes.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', alignItems: 'center' }}>
                <input placeholder="Name" value={a.name} onChange={e => updateAttr(i, { name: e.target.value })} style={{ ...inputStyle, width: 200 }} />
                <select value={a.dataType} onChange={e => updateAttr(i, { dataType: e.target.value as 'String' | 'Number' })} style={inputStyle}>
                  <option value="String">String</option>
                  <option value="Number">Number</option>
                </select>
                <input placeholder="Value" value={a.value} onChange={e => updateAttr(i, { value: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
                <button onClick={() => removeAttr(i)} style={{ cursor: 'pointer' }}>✕</button>
              </div>
            ))}
            <button onClick={addAttr} style={{ cursor: 'pointer', marginTop: '0.25rem' }}>+ Add attribute</button>
          </section>

          {/* FIFO fields */}
          {isFifo && (
            <section style={{ marginBottom: '1.25rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>MessageGroupId (FIFO, required)</label>
                <input value={groupId} onChange={e => setGroupId(e.target.value)} style={{ ...inputStyle, width: 260 }} />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.25rem' }}>MessageDeduplicationId (optional)</label>
                <input value={dedupId} onChange={e => setDedupId(e.target.value)} style={{ ...inputStyle, width: 260 }} />
              </div>
            </section>
          )}

          {/* send */}
          <section style={{ marginBottom: '1.5rem' }}>
            {!pendingSend ? (
              <button
                onClick={() => { setPendingSend(true); setError(null); setResult(null); }}
                disabled={!body.trim()}
                style={{ fontWeight: 600, padding: '0.4rem 1rem', cursor: 'pointer' }}
              >
                Send to {queueName} →
              </button>
            ) : (
              <div style={{ border: '1px solid #2980b9', borderRadius: 4, padding: '0.75rem', background: '#f4f9fd' }}>
                <strong>Confirm send to <code>{queueName}</code></strong>
                <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto', background: '#fff', padding: '0.5rem', border: '1px solid #ddd', marginTop: '0.5rem' }}>{body}</pre>
                {attributes.filter(a => a.name.trim()).length > 0 && (
                  <p style={{ margin: '0.25rem 0' }}>
                    Attributes: {attributes.filter(a => a.name.trim()).map(a => `${a.name}(${a.dataType})`).join(', ')}
                  </p>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button onClick={confirmSend} disabled={sending} style={{ fontWeight: 600, cursor: 'pointer' }}>
                    {sending ? 'Sending…' : 'Confirm send'}
                  </button>
                  <button onClick={() => setPendingSend(false)} disabled={sending} style={{ cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            )}
          </section>

          {/* purge danger zone */}
          <section style={{ marginBottom: '1.5rem', border: '1px solid #c0392b', borderRadius: 4, padding: '0.75rem' }}>
            <strong style={{ color: '#c0392b' }}>Danger zone — purge queue</strong>
            <p style={{ margin: '0.25rem 0', color: '#555' }}>
              Permanently deletes all messages in <code>{queueName}</code> (irreversible). Type the exact
              queue name to enable.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                placeholder={queueName}
                value={purgeConfirm}
                onChange={e => setPurgeConfirm(e.target.value)}
                style={{ ...inputStyle, width: 320 }}
              />
              <button
                onClick={handlePurge}
                disabled={purging || purgeConfirm.trim() !== queueName}
                style={{
                  fontWeight: 600, cursor: purgeConfirm.trim() === queueName ? 'pointer' : 'not-allowed',
                  color: '#fff', background: purgeConfirm.trim() === queueName ? '#c0392b' : '#e0a0a0',
                  border: 'none', borderRadius: 3, padding: '0.4rem 1rem',
                }}
              >
                {purging ? 'Purging…' : 'Purge queue'}
              </button>
            </div>
          </section>
        </>
      )}

      {result && <p style={{ color: '#1e7e34', border: '1px solid #1e7e34', padding: '0.5rem' }}>{result}</p>}
      {error && <p style={{ color: '#c0392b', border: '1px solid #c0392b', padding: '0.5rem' }}>{error}</p>}
    </div>
  );
}
