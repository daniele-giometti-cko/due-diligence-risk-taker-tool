interface Props {
  items: Record<string, unknown>[];
}

export default function ResultsTable({ items }: Props) {
  if (items.length === 0) return <p>Query returned no items.</p>;

  // Collect all unique keys across every item to build columns dynamically.
  const columns = Array.from(new Set(items.flatMap(item => Object.keys(item))));

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        border={1}
        cellPadding={6}
        style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}
      >
        <thead style={{ background: '#f0f0f0' }}>
          <tr>
            {columns.map(col => <th key={col}>{col}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i}>
              {columns.map(col => (
                <td key={col} style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item[col] !== undefined ? JSON.stringify(item[col]) : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
