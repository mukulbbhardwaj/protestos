import {
  roleAtLeast,
  type ContactDetail,
  type DocumentDto,
  type PropertySummary,
} from '@app/shared';
import { FileSignature } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrg } from '@/hooks/useOrg';
import { useOrgQuery } from '@/hooks/useOrgQuery';
import { DocumentsTable } from '../documents/DocumentsTable';
import { SendDocumentsDialog } from '../documents/SendDocumentsDialog';

export function ContactDocumentsTab({
  contact,
  properties,
}: {
  contact: ContactDetail;
  properties: PropertySummary[];
}) {
  const org = useOrg();
  const [sending, setSending] = useState(false);
  const docs = useOrgQuery<{ items: DocumentDto[] }>(
    `/documents?contactId=${contact.id}&pageSize=200`,
  );
  const canEdit = roleAtLeast(org.role, 'STAFF') && !contact.archivedAt;
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Documents</CardTitle>
          <CardDescription>
            Engagement agreements and Form 50-162, with their signatures.
          </CardDescription>
        </div>
        {canEdit && (
          <Button onClick={() => setSending(true)} disabled={properties.length === 0}>
            <FileSignature /> Send documents
          </Button>
        )}
      </CardHeader>
      {docs.error && (
        <Alert variant="destructive" className="m-4">
          {docs.error.message}
        </Alert>
      )}
      {docs.isPending ? (
        <Skeleton className="m-4 h-24" />
      ) : (
        <DocumentsTable documents={docs.data?.items ?? []} />
      )}
      {sending && (
        <SendDocumentsDialog
          open={sending}
          onOpenChange={setSending}
          contact={{ id: contact.id, displayName: contact.displayName, email: contact.email }}
          properties={properties}
        />
      )}
    </Card>
  );
}
