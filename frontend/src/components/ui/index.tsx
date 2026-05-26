// Shared UI primitives. Class names live in src/styles/ui.css.
// Keep this file flat and dependency-free — these primitives are imported
// across every tab to enforce a uniform visual language.

import { ReactNode, HTMLAttributes, ButtonHTMLAttributes, InputHTMLAttributes } from "react";
import { Search, Inbox } from "lucide-react";

/* ── Page shell ─────────────────────────────────────────────────────── */
export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ui-page ${className}`.trim()}>{children}</div>;
}

/* ── PageHeader ─────────────────────────────────────────────────────── */
interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}
export function PageHeader({ eyebrow, title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header__text">
        {eyebrow ? <span className="ui-page-header__eyebrow">{eyebrow}</span> : null}
        <h1 className="ui-page-header__title">{title}</h1>
        {subtitle ? <p className="ui-page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
    </header>
  );
}

/* ── Section header ─────────────────────────────────────────────────── */
export function SectionHeader({
  title,
  count,
  action,
}: {
  title: ReactNode;
  count?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ui-section-header">
      <h2 className="ui-section-header__title">
        {title}
        {count != null ? <span className="ui-section-header__count" style={{ marginLeft: "var(--space-2)" }}>{count}</span> : null}
      </h2>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

/* ── Card ───────────────────────────────────────────────────────────── */
type CardVariant = "default" | "ghost" | "muted";
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  hoverable?: boolean;
}
export function Card({ variant = "default", hoverable = false, className = "", children, ...rest }: CardProps) {
  const cls = [
    "ui-card",
    variant === "ghost" ? "ui-card--ghost" : "",
    variant === "muted" ? "ui-card--muted" : "",
    hoverable ? "ui-card--hoverable" : "",
    className,
  ].filter(Boolean).join(" ");
  return <div className={cls} {...rest}>{children}</div>;
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-card__header">
      <div>
        <div className="ui-card__title">{title}</div>
        {subtitle ? <div className="ui-card__subtitle">{subtitle}</div> : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ui-card__body ${className}`.trim()}>{children}</div>;
}

export function CardFooter({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ui-card__footer ${className}`.trim()}>{children}</div>;
}

/* ── StatCard ───────────────────────────────────────────────────────── */
type Trend = "up" | "down" | "flat";
interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  delta?: ReactNode;
  trend?: Trend;
}
export function StatCard({ label, value, icon, delta, trend }: StatCardProps) {
  return (
    <div className="ui-stat">
      <div className="ui-stat__label-row">
        <span className="ui-stat__label">{label}</span>
        {icon ? <span className="ui-stat__icon" aria-hidden>{icon}</span> : null}
      </div>
      <div className="ui-stat__value">{value}</div>
      {delta ? (
        <div className={`ui-stat__delta ${trend ? `ui-stat__delta--${trend}` : ""}`.trim()}>{delta}</div>
      ) : null}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="ui-stat-grid">{children}</div>;
}

/* ── Toolbar ────────────────────────────────────────────────────────── */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="ui-toolbar">{children}</div>;
}

export function ToolbarGroup({ children }: { children: ReactNode }) {
  return <div className="ui-toolbar__group">{children}</div>;
}

export function ToolbarSpacer() {
  return <span className="ui-toolbar__spacer" />;
}

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  placeholder?: string;
}
export function SearchInput({ placeholder = "Search…", className = "", ...rest }: SearchInputProps) {
  return (
    <div className={`ui-toolbar__search ${className}`.trim()}>
      <Search size={16} className="ui-toolbar__search-icon" aria-hidden />
      <input type="search" className="ui-toolbar__search-input" placeholder={placeholder} {...rest} />
    </div>
  );
}

/* ── Badge ──────────────────────────────────────────────────────────── */
type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";
export function Badge({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return <span className={`ui-badge ui-badge--${tone} ${className}`.trim()}>{children}</span>;
}

/* ── Button ─────────────────────────────────────────────────────────── */
type ButtonVariant = "primary" | "secondary" | "ghost";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}
export function Button({ variant = "secondary", size = "md", className = "", children, ...rest }: ButtonProps) {
  const cls = [
    "ui-button",
    `ui-button--${variant}`,
    size === "sm" ? "ui-button--sm" : "",
    className,
  ].filter(Boolean).join(" ");
  return <button className={cls} {...rest}>{children}</button>;
}

/* ── EmptyState ─────────────────────────────────────────────────────── */
export function EmptyState({
  title,
  detail,
  icon,
  action,
}: {
  title: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      <div className="ui-empty__icon" aria-hidden>{icon ?? <Inbox size={22} />}</div>
      <div className="ui-empty__title">{title}</div>
      {detail ? <div className="ui-empty__detail">{detail}</div> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}

/* ── Spinner / loading row ──────────────────────────────────────────── */
export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`ui-spinner ${className}`.trim()} aria-hidden />;
}

export function LoadingRow({ children }: { children: ReactNode }) {
  return (
    <div className="ui-loading-row" aria-live="polite">
      <Spinner />
      <span>{children}</span>
    </div>
  );
}

/* ── Banner ─────────────────────────────────────────────────────────── */
type BannerTone = "neutral" | "info" | "warning" | "success" | "danger";
export function Banner({ tone = "neutral", icon, children }: { tone?: BannerTone; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={`ui-banner ${tone !== "neutral" ? `ui-banner--${tone}` : ""}`.trim()}>
      {icon ? <span className="ui-banner__icon">{icon}</span> : null}
      <div>{children}</div>
    </div>
  );
}
