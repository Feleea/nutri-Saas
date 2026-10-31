'use client';

export default function PrintButton() {
  return <button type="button" className="btn print-hidden" onClick={() => window.print()}>
    Imprimir ou salvar em PDF
  </button>;
}
