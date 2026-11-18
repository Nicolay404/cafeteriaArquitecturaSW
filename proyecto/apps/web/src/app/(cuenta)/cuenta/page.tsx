import type { Metadata } from 'next';
import { Panel } from './panel.tsx';

export const metadata: Metadata = { title: 'Mi cuenta · Cafetería', robots: { index: false } };

export default function Cuenta() {
  return <Panel />;
}
