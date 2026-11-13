import { pdf } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import type { DocumentProps } from '@react-pdf/renderer';

/** Render a react-pdf document in the browser and download it. */
export async function downloadPdf(doc: ReactElement<DocumentProps>, filename: string): Promise<void> {
  const blob = await pdf(doc).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Open the PDF in a new tab (for printing). */
export async function openPdf(doc: ReactElement<DocumentProps>): Promise<void> {
  const win = window.open('', '_blank');
  const blob = await pdf(doc).toBlob();
  const url = URL.createObjectURL(blob);
  if (win) win.location.href = url; else window.location.href = url;
}
