import type { CalculatorCoverage, CalculatorEstimate } from '@app/shared';
import { Calculator } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrg } from '@/hooks/useOrg';
import { useOrgQuery } from '@/hooks/useOrgQuery';
import { qs } from '@/hooks/useUrlState';
import { ConfidenceBadge, DISCLAIMER, EstimateTiles } from './EstimateView';

/** The equity estimate for a firm's property, when its county-year roll is loaded. */
export function EstimateCard({
  countyId,
  accountNumber,
}: {
  countyId: number;
  accountNumber: string;
}) {
  const org = useOrg();
  const coverage = useOrgQuery<CalculatorCoverage>('/calculator/coverage');
  const taxYear = coverage.data?.find((c) => c.countyId === countyId)?.taxYears[0];
  const query = qs({ countyId, taxYear, account: accountNumber });
  const estimate = useOrgQuery<CalculatorEstimate>(`/calculator/estimate${query}`, {
    enabled: taxYear !== undefined,
  });
  // Not on a loaded roll (another county, or not a residential account): show nothing.
  if (taxYear === undefined || estimate.error) return null;

  return (
    <Card className="mb-6">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            Equity estimate, {taxYear}
            {estimate.data && <ConfidenceBadge e={estimate.data.estimate} />}
          </CardTitle>
          <CardDescription>{DISCLAIMER}</CardDescription>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link
            to={`/${org.orgSlug}/calculator${qs({ county: countyId, year: taxYear, account: accountNumber })}`}
          >
            <Calculator /> Open in calculator
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {estimate.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : estimate.data.estimate.status === 'ESTIMATE' ||
          estimate.data.estimate.status === 'NO_REDUCTION' ? (
          <EstimateTiles data={estimate.data} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {estimate.data.estimate.explanation.at(-1)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
