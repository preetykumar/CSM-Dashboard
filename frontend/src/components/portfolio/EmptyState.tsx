// Reusable empty-state component. Used wherever a downstream join has no data,
// so users see EXPLICIT "we looked, there's nothing here" instead of silent gaps.
//
// Three reasons for emptiness, each gets a distinct visual:
//   - "no-match"    : we have no link between SF and this data source at all
//   - "no-records"  : we have a link but it returned zero records
//   - "no-tracking" : the product/data source doesn't support tracking this dimension

import { AlertCircle, Inbox, EyeOff } from "lucide-react";

type Reason = "no-match" | "no-records" | "no-tracking";

interface Props {
  reason: Reason;
  // Short label for the data type (e.g. "Zendesk org", "usage data", "Kantata project").
  dataType: string;
  // Optional next-step suggestion shown below the main message.
  hint?: string;
}

const COPY: Record<Reason, { icon: typeof AlertCircle; title: (d: string) => string }> = {
  "no-match": {
    icon: AlertCircle,
    title: (d) => `No ${d} found for this account in Salesforce → ${d.includes("Zendesk") ? "Zendesk" : "the source system"}.`,
  },
  "no-records": {
    icon: Inbox,
    title: (d) => `No ${d} records in the last 90 days.`,
  },
  "no-tracking": {
    icon: EyeOff,
    title: (d) => `${d} tracking is not available for this account.`,
  },
};

export function EmptyState({ reason, dataType, hint }: Props) {
  const { icon: Icon, title } = COPY[reason];
  return (
    <div className={`portfolio-empty-state portfolio-empty-${reason}`}>
      <Icon size={20} className="portfolio-empty-icon" aria-hidden />
      <div>
        <p className="portfolio-empty-title">{title(dataType)}</p>
        {hint && <p className="portfolio-empty-hint">{hint}</p>}
      </div>
    </div>
  );
}
