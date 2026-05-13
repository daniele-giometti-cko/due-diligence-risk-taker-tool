'use client';

import { useState, useEffect, useRef } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';
const HISTORY_KEY = 'dd-chronicle-prompt-history';
const MAX_HISTORY = 20;

const EXAMPLE_PROMPTS = [
  'What happened in due-diligence-pep-case-notifier in prod in the last 2 hours?',
  'Were there any errors in the QA environment for due-diligence-pep-case-notifier today?',
  'Summarise activity in due-diligence-pep-case-notifier across all environments in the last 6 hours.',
];

function loadHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveToHistory(prompt: string, history: string[]): string[] {
  const deduped = [prompt, ...history.filter(p => p !== prompt)].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(deduped));
  return deduped;
}

export default function DatadogChronicle() {
  const [prompt, setPrompt] = useState('');
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [inputTokens, setInputTokens] = useState<number | null>(null);
  const [outputTokens, setOutputTokens] = useState<number | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const suggestions = history.filter(p =>
    prompt.trim() === '' || p.toLowerCase().includes(prompt.toLowerCase().trim())
  );

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setShowSuggestions(false);
    setLoading(true);
    setNarrative(null);
    setError(null);
    setElapsed(null);
    setInputTokens(null);
    setOutputTokens(null);

    const start = Date.now();
    try {
      const res = await fetch(`${API_BASE}/agent-chronicle/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const event = JSON.parse(line.slice(6));

          if (event.text) {
            setNarrative(prev => (prev ?? '') + event.text);
          }
          if (event.inputTokens != null) {
            setInputTokens(event.inputTokens);
            setOutputTokens(event.outputTokens ?? null);
          }
          if (event.done) {
            setElapsed(Math.round((Date.now() - start) / 1000));
          }
        }
      }

      // Save to history only on successful completion
      setHistory(prev => saveToHistory(prompt.trim(), prev));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleGenerate();
    if (e.key === 'Escape') setShowSuggestions(false);
  }

  function handleBlur(e: React.FocusEvent) {
    // Delay so a click on a suggestion registers before hiding
    if (!suggestionsRef.current?.contains(e.relatedTarget as Node)) {
      setTimeout(() => setShowSuggestions(false), 150);
    }
  }

  return (
    <div>
      <p style={{ color: '#555', marginTop: 0 }}>
        Ask in plain English. The agent queries Datadog logs and returns a concise chronicle.
        Mention the service name, environment (<code>prod</code>, <code>qa</code>, <code>sbox</code>), and a time window.
      </p>

      {/* Example prompts */}
      <section style={{ marginBottom: '1.25rem' }}>
        <span style={{ fontSize: '0.85rem', color: '#888', marginRight: '0.5rem' }}>Examples:</span>
        {EXAMPLE_PROMPTS.map(p => (
          <button
            key={p}
            onClick={() => setPrompt(p)}
            style={{
              fontSize: '0.8rem',
              marginRight: '0.4rem',
              marginBottom: '0.4rem',
              padding: '0.2rem 0.6rem',
              background: '#f0f0f0',
              border: '1px solid #ccc',
              borderRadius: '3px',
              cursor: 'pointer',
            }}
          >
            {p.length > 60 ? p.slice(0, 58) + '…' : p}
          </button>
        ))}
      </section>

      {/* Prompt input */}
      <section style={{ marginBottom: '1rem' }}>
        <div style={{ position: 'relative' }}>
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowSuggestions(true)}
            onBlur={handleBlur}
            rows={3}
            placeholder="e.g. What happened in due-diligence-pep-case-notifier in prod in the last 2 hours?"
            style={{ width: '100%', fontFamily: 'inherit', fontSize: '1rem', boxSizing: 'border-box' }}
            disabled={loading}
          />

          {showSuggestions && suggestions.length > 0 && (
            <div
              ref={suggestionsRef}
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                background: '#fff',
                border: '1px solid #ccc',
                borderTop: 'none',
                borderRadius: '0 0 4px 4px',
                boxShadow: '0 4px 8px rgba(0,0,0,0.08)',
                zIndex: 10,
                maxHeight: '220px',
                overflowY: 'auto',
              }}
            >
              {suggestions.map((s, i) => (
                <div
                  key={i}
                  onMouseDown={() => {
                    setPrompt(s);
                    setShowSuggestions(false);
                    textareaRef.current?.focus();
                  }}
                  style={{
                    padding: '0.5rem 0.75rem',
                    cursor: 'pointer',
                    fontSize: '0.88rem',
                    borderBottom: i < suggestions.length - 1 ? '1px solid #f0f0f0' : 'none',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.4rem' }}>
          <button
            onClick={() => handleGenerate()}
            disabled={loading || !prompt.trim()}
            style={{ fontWeight: 600, padding: '0.4rem 1.2rem' }}
          >
            {loading ? 'Querying Datadog…' : 'Generate Chronicle'}
          </button>
          <span style={{ fontSize: '0.8rem', color: '#aaa' }}>⌘ + Enter</span>
          {loading && (
            <span style={{ fontSize: '0.85rem', color: '#888' }}>
              Querying Datadog — text will appear as it streams in.
            </span>
          )}
        </div>
      </section>

      {error && (
        <p style={{ color: '#c0392b', border: '1px solid #c0392b', padding: '0.5rem', borderRadius: '4px' }}>
          {error}
        </p>
      )}

      {narrative !== null && (
        <section style={{ marginTop: '1.5rem' }}>
          <h2 style={{ marginBottom: '0.4rem' }}>Chronicle</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', fontSize: '0.82rem', color: '#888', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {elapsed !== null && <span>Time: <strong style={{ color: '#555' }}>{elapsed}s</strong></span>}
            {inputTokens !== null && <span>In: <strong style={{ color: '#555' }}>{inputTokens.toLocaleString()}</strong> tokens</span>}
            {outputTokens !== null && <span>Out: <strong style={{ color: '#555' }}>{outputTokens.toLocaleString()}</strong> tokens</span>}
          </div>
          <div
            style={{
              background: '#f8f9fa',
              border: '1px solid #dee2e6',
              borderRadius: '4px',
              padding: '1rem 1.25rem',
              lineHeight: '1.75',
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
            }}
          >
            {narrative}
          </div>
          <button
            onClick={() => { setNarrative(null); setPrompt(''); }}
            style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Clear
          </button>
        </section>
      )}
    </div>
  );
}
