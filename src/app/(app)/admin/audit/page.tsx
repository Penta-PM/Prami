import type { Metadata } from 'next';

import { PlaceholderPage } from '@/components/placeholder-page';
import { PAGE_SPECS } from '@/features/shell/pages';

const spec = PAGE_SPECS.adminAudit;

export const metadata: Metadata = { title: spec.title };

export default function AdminAuditPage() {
  return <PlaceholderPage {...spec} />;
}
