import type { PropertyType, ProspectStatus, ProtestStage } from '@app/shared';

export const STAGE_LABELS: Record<ProtestStage, string> = {
  NOT_STARTED: 'Not started',
  AOA_SIGNED: 'AOA signed',
  NOTICE_RECEIVED: 'Notice received',
  PROTEST_FILED: 'Protest filed',
  HEARING_SCHEDULED: 'Hearing scheduled',
  SETTLED: 'Settled',
  BOARD_ORDER: 'Board order',
  NO_CHANGE: 'No change',
  WITHDRAWN: 'Withdrawn',
  INVOICED: 'Invoiced',
  PAID: 'Paid',
};

export const STAGE_TONE: Record<
  ProtestStage,
  'secondary' | 'default' | 'warning' | 'success' | 'outline'
> = {
  NOT_STARTED: 'outline',
  AOA_SIGNED: 'secondary',
  NOTICE_RECEIVED: 'secondary',
  PROTEST_FILED: 'default',
  HEARING_SCHEDULED: 'warning',
  SETTLED: 'success',
  BOARD_ORDER: 'success',
  NO_CHANGE: 'outline',
  WITHDRAWN: 'outline',
  INVOICED: 'default',
  PAID: 'success',
};

export const PROSPECT_LABELS: Record<ProspectStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  DOCS_SENT: 'Docs sent',
  SIGNED: 'Signed',
  LOST: 'Lost',
};

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  RESIDENTIAL: 'Residential',
  COMMERCIAL: 'Commercial',
  BPP: 'Business personal property',
  LAND: 'Land',
  OTHER: 'Other',
};

export const PROPERTY_TYPE_SHORT: Record<PropertyType, string> = {
  RESIDENTIAL: 'Residential',
  COMMERCIAL: 'Commercial',
  BPP: 'BPP',
  LAND: 'Land',
  OTHER: 'Other',
};
