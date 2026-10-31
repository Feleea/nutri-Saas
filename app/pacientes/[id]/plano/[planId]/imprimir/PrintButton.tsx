'use client';

import { useState } from 'react';

export default function PrintButton() {
  const [preparing, setPreparing] = useState(false);

  async function print() {
    setPreparing(true);
    try {
      await Promise.race([
        Promise.all([
          document.fonts?.ready,
          ...Array.from(document.images, (image) => image.decode().catch(() => undefined)),
        ]),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.print();
    } finally {
      setPreparing(false);
    }
  }

  return <button type="button" className="btn print-hidden" onClick={() => void print()} disabled={preparing}>
    {preparing ? 'Preparando impressão…' : 'Imprimir ou salvar em PDF'}
  </button>;
}
