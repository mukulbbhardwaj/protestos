import type { ProtestStage } from '@app/shared';
import { Badge } from '@/components/ui/badge';
import { STAGE_LABELS, STAGE_TONE } from '@/lib/labels';

export function StageBadge({ stage }: { stage: ProtestStage }) {
  return <Badge variant={STAGE_TONE[stage]}>{STAGE_LABELS[stage]}</Badge>;
}
