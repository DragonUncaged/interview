'use client';

import { use } from 'react';
import { Studio } from '@/components/studio/Studio';

export default function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Studio sessionId={id} />;
}
