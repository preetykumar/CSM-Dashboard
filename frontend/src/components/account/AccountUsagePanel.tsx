// Reusable per-account Amplitude usage panel. Used by the Home portfolio
// CustomerCard and the Deployments detail panel.
//
// Fetches Enterprise_Subscription__c records for the SF account, derives
// the Enterprise UUID + Monitor domain from them, then renders
// UnifiedUsageSection (per-product metrics + per-user drill-down).

import { useEffect, useState } from "react";
import {
  fetchEnterpriseSubscriptionsById,
  type EnterpriseSubscription,
} from "../../services/api";
import { UnifiedUsageSection } from "../UnifiedUsageSection";
import { LoadingRow } from "../ui";

interface Props {
  accountId: string;
  accountName: string;
}

export function AccountUsagePanel({ accountId, accountName }: Props) {
  const [subs, setSubs] = useState<EnterpriseSubscription[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchEnterpriseSubscriptionsById(accountId)
      .then((res) => {
        if (cancelled) return;
        setSubs(res.subscriptions);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSubs([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (loading) return <LoadingRow>Loading subscription data…</LoadingRow>;

  // Derive Amplitude lookup keys the same way the Deployments detail panel does.
  // Different products store different identifiers in gp:organization or
  // gp:enterpriseId — UnifiedUsageSection ORs them.
  const enterpriseUuid = subs?.find((s) => s.enterpriseUuid)?.enterpriseUuid;
  const monitorDomain = subs?.find((s) => s.enterpriseDomain)?.enterpriseDomain?.split(".")[0];

  return (
    <UnifiedUsageSection
      enterpriseUuid={enterpriseUuid}
      accountName={accountName}
      salesforceAccountId={accountId}
      monitorDomain={monitorDomain}
      subscriptions={subs || []}
    />
  );
}
