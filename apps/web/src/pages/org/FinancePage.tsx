import { Construction } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrgQuery } from '@/hooks/useOrgQuery';
import { formatMoney } from '@/lib/format';
import { MODULES } from '@/modules';
import { ModulePage } from './ModulePage';

interface FinanceSummary {
  billedYtd: string;
  collectedYtd: string;
  outstanding: string;
}

export function FinancePage() {
  const { data, isPending, error } = useOrgQuery<FinanceSummary>('/finance/summary');
  const tiles: [string, keyof FinanceSummary][] = [
    ['Billed year to date', 'billedYtd'],
    ['Collected year to date', 'collectedYtd'],
    ['Outstanding', 'outstanding'],
  ];
  return (
    <>
      <PageHeader
        title="Finance"
        description="Billed, collected and outstanding. Visible to owners and admins only."
      />
      {error && (
        <Alert variant="destructive" className="mb-6">
          {error.message}
        </Alert>
      )}
      <Alert variant="info" className="mb-6">
        <Construction />
        <p>
          These figures fill in once invoices (M4) and payments exist. The full dashboard arrives in
          M7.
        </p>
      </Alert>
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {tiles.map(([label, key]) => (
          <Card key={key}>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">{label}</p>
              {isPending ? (
                <Skeleton className="mt-2 h-8 w-28" />
              ) : (
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {formatMoney(data?.[key] ?? 0)}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="[&>div:first-child]:hidden">
        <ModulePage module={MODULES.find((m) => m.key === 'finance')!} />
      </div>
    </>
  );
}
