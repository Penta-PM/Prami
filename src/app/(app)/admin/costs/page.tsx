import type { Metadata } from 'next';

import { PlaceholderPage } from '@/components/placeholder-page';
import { PAGE_SPECS } from '@/features/shell/pages';

const spec = PAGE_SPECS.adminCosts;

export const metadata: Metadata = { title: spec.title };

export default function AdminCostsPage() {
  return <PlaceholderPage {...spec} />;
}
