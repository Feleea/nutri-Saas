'use client';

type BodyComposition = {
  method: 'BIOIMPEDANCE' | 'JACKSON_POLLOCK_3_SITE';
  formula: string;
  rawInputs: Record<string, string | number>;
  derivedValues: { bodyFatPercent: number; fatMassKg: number; fatFreeMassKg: number };
};
export type Measurement = {
  id: string;
  measuredAt: string;
  weightKg: number | string;
  heightCm: number | string;
  bmi: number | string;
  waistCm?: number | string | null;
  hipCm?: number | string | null;
  neckCm?: number | string | null;
  armCm?: number | string | null;
  thighCm?: number | string | null;
  bodyComposition?: BodyComposition | null;
};

function TrendChart({ rows, field, label, unit }: {
  rows: Measurement[]; field: 'weightKg' | 'bmi'; label: string; unit: string;
}) {
  const width = 640;
  const height = 220;
  const left = 44;
  const right = 18;
  const top = 20;
  const bottom = 36;
  const values = rows.map((row) => Number(row[field]));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = rawMin === rawMax ? Math.max(rawMin * 0.05, 1) : (rawMax - rawMin) * 0.15;
  const min = rawMin - padding;
  const max = rawMax + padding;
  const points = rows.map((row, index) => ({
    x: rows.length === 1 ? (left + width - right) / 2 : left + index * (width - left - right) / (rows.length - 1),
    y: top + (max - Number(row[field])) * (height - top - bottom) / (max - min),
    value: Number(row[field]),
    date: new Date(row.measuredAt).toLocaleDateString('pt-BR'),
  }));
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');

  return (
    <div>
      <h3>{label} ({unit})</h3>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Gráfico de ${label.toLowerCase()} ao longo do tempo`} style={{ width: '100%', height: 'auto' }}>
        <line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} stroke="currentColor" opacity=".3" />
        <line x1={left} y1={top} x2={left} y2={height - bottom} stroke="currentColor" opacity=".3" />
        {points.length > 1 && <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />}
        {points.map((point, index) => (
          <circle key={rows[index].id} cx={point.x} cy={point.y} r="5" fill="currentColor">
            <title>{point.date}: {point.value.toFixed(1)} {unit}</title>
          </circle>
        ))}
        <text x={left} y={height - 10} fontSize="12">{points[0].date}</text>
        {points.length > 1 && <text x={width - right} y={height - 10} fontSize="12" textAnchor="end">{points[points.length - 1].date}</text>}
        <text x={left - 6} y={top + 4} fontSize="11" textAnchor="end">{rawMax.toFixed(1)}</text>
        <text x={left - 6} y={height - bottom} fontSize="11" textAnchor="end">{rawMin.toFixed(1)}</text>
      </svg>
    </div>
  );
}

export default function AnthropometryHistory({ measurements }: { measurements: Measurement[] }) {
  const rows = [...measurements].sort((a, b) =>
    new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime() || a.id.localeCompare(b.id));
  if (!rows.length) return <p>Nenhuma medida registrada.</p>;

  return (
    <div>
      {rows.length === 1 && <p className="muted">Há um registro; ainda não é possível visualizar uma tendência.</p>}
      <div className="card">
        <h3>Evolução ao longo do tempo</h3>
        <TrendChart rows={rows} field="weightKg" label="Peso" unit="kg" />
        <TrendChart rows={rows} field="bmi" label="IMC" unit="kg/m²" />
      </div>
      <h3>Histórico (ordem cronológica)</h3>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Data</th><th>Peso (kg)</th><th>Altura (cm)</th><th>IMC</th><th>Cintura (cm)</th><th>Quadril (cm)</th><th>Pescoço (cm)</th><th>Braço (cm)</th><th>Coxa (cm)</th><th>Composição corporal</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}>
            <td>{new Date(row.measuredAt).toLocaleDateString('pt-BR')}</td>
            <td>{Number(row.weightKg).toFixed(2)}</td>
            <td>{Number(row.heightCm).toFixed(2)}</td>
            <td>{Number(row.bmi).toFixed(1)}</td>
            <td>{row.waistCm == null ? '—' : Number(row.waistCm).toFixed(1)}</td>
            <td>{row.hipCm == null ? '—' : Number(row.hipCm).toFixed(1)}</td>
            <td>{row.neckCm == null ? '—' : Number(row.neckCm).toFixed(1)}</td>
            <td>{row.armCm == null ? '—' : Number(row.armCm).toFixed(1)}</td>
            <td>{row.thighCm == null ? '—' : Number(row.thighCm).toFixed(1)}</td>
            <td>{row.bodyComposition
              ? <>
                <strong>{row.bodyComposition.derivedValues.bodyFatPercent.toFixed(1)}% de gordura</strong>
                <div>{row.bodyComposition.derivedValues.fatMassKg.toFixed(2)} kg de gordura · {row.bodyComposition.derivedValues.fatFreeMassKg.toFixed(2)} kg de massa livre de gordura</div>
                <details>
                  <summary>{row.bodyComposition.method === 'BIOIMPEDANCE' ? 'Leitura de bioimpedância' : 'Estimativa por dobras cutâneas'}</summary>
                  <p>{row.bodyComposition.formula}</p>
                  <ul>{Object.entries(row.bodyComposition.rawInputs).map(([key, value]) => <li key={key}>{key}: {value}</li>)}</ul>
                </details>
              </>
              : 'Não informado'}
            </td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
