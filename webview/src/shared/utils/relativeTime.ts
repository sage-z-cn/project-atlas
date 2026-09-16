import { t } from "../i18n";

/**
 * 相对时间：1h 内「刚刚」、24h 内「Nh ago」、7 天内「Nd ago」，
 * 超期回退 yyyy-MM-dd HH:mm（与 CommitRow / CommitInfo 同口径）。
 * 贮藏列表与新版本提交列表共用。
 */
export function formatRelativeTime(isoDate: string): string {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffHr / 24);

  if (diffHr < 1) return t("just now");
  if (diffHr < 24) return t("{0}h ago", diffHr);
  if (diffDay < 7) return t("{0}d ago", diffDay);

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}
