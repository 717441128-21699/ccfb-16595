import type { RunReport } from './Scoring';

const KEY = 'lineup-surf-reports-v1';

export function loadReports(): RunReport[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RunReport[];
    return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
  } catch {
    return [];
  }
}

export function saveReport(report: RunReport): RunReport[] {
  const reports = [report, ...loadReports()].slice(0, 30);
  try {
    localStorage.setItem(KEY, JSON.stringify(reports));
  } catch {
    // Storage may be unavailable in private contexts; the current report still works.
  }
  return reports;
}

export function clearReports() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
