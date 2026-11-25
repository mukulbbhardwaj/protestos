import { Check, Construction } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { ModuleDef } from '@/modules';

/** Placeholder for modules that later milestones build. Describes what's coming. */
export function ModulePage({ module: m }: { module: ModuleDef }) {
  return (
    <>
      <PageHeader title={m.label} description={m.summary} />
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10">
            <m.icon className="size-5 text-primary" />
          </span>
          <h2 className="mt-4 text-lg font-semibold">Coming soon</h2>
          {m.comingIn && (
            <Badge variant="secondary" className="mt-2">
              <Construction className="size-3" /> Planned for milestone {m.comingIn}
            </Badge>
          )}
          {m.features && (
            <ul className="mt-6 grid max-w-lg gap-2 text-left text-sm">
              {m.features.map((f) => (
                <li key={f} className="flex gap-2 text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" />
                  {f}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
