import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PDFDocument = require('pdfkit');

interface WorkspaceConfig {
  clientName?: string;
  agencyName?: string;
}

interface AuditEntry {
  timestamp: string;
  tool: string;
  decision: string;
  reason?: string;
}

interface WeeklyMetrics {
  totalToolCalls: number;
  totalBlocked: number;
  totalAllowed: number;
  topBlockedTools: Array<{ tool: string; count: number }>;
}

export async function generateWeeklyReport(
  workspaceId: string,
  clientName?: string,
  agencyName?: string,
): Promise<string> {
  const workspacePath = join(process.cwd(), 'workspaces', workspaceId);
  const config = await readJsonFile<WorkspaceConfig>(join(workspacePath, 'config.json'), {});
  const auditEntries = await readJsonFile<AuditEntry[]>(join(workspacePath, 'audit.json'), []);
  const resolvedClientName = clientName ?? config.clientName ?? workspaceId;
  const resolvedAgencyName = agencyName ?? config.agencyName ?? 'Grimdall Technologies';
  const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weeklyEntries = auditEntries.filter((entry) => {
    const timestamp = Date.parse(entry.timestamp);
    return Number.isFinite(timestamp) && timestamp >= weekStart;
  });
  const metrics = calculateMetrics(weeklyEntries);
  const reportDir = join(workspacePath, 'reports');
  await mkdir(reportDir, { recursive: true });

  const dateStamp = new Date().toISOString().slice(0, 10);
  const reportPath = join(reportDir, `weekly-report-${dateStamp}.pdf`);

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const stream = createWriteStream(reportPath);

    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    renderHeader(doc, resolvedAgencyName, resolvedClientName, dateStamp);
    renderSummary(doc, metrics, weeklyEntries.length, resolvedClientName);
    renderMetrics(doc, metrics);
    renderBlockedLog(doc, weeklyEntries);
    renderFooter(doc, resolvedAgencyName);

    doc.end();
  });

  return reportPath;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function calculateMetrics(entries: AuditEntry[]): WeeklyMetrics {
  const totalBlocked = entries.filter((entry) => entry.decision === 'blocked').length;
  const totalAllowed = entries.filter((entry) => entry.decision === 'allowed').length;
  const topBlockedTools = Object.entries(
    entries
      .filter((entry) => entry.decision === 'blocked')
      .reduce<Record<string, number>>((acc, entry) => {
        acc[entry.tool] = (acc[entry.tool] ?? 0) + 1;
        return acc;
      }, {}),
  )
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalToolCalls: entries.length,
    totalBlocked,
    totalAllowed,
    topBlockedTools,
  };
}

function renderHeader(
  doc: typeof PDFDocument.prototype,
  agencyName: string,
  clientName: string,
  dateStamp: string,
): void {
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#111111').text(agencyName);
  doc.fontSize(16).text('Weekly AI Security Report');
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(11).fillColor('#444444');
  doc.text(`Client: ${clientName}`);
  doc.text(`Date range: ${formatDateRange()}`);
  doc.text(`Report date: ${dateStamp}`);
  doc.moveDown(1);
}

function renderSummary(
  doc: typeof PDFDocument.prototype,
  metrics: WeeklyMetrics,
  activityCount: number,
  clientName: string,
): void {
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#111111').text('Executive Summary');
  doc.moveDown(0.35);
  doc.font('Helvetica').fontSize(11).fillColor('#333333');

  if (activityCount === 0) {
    doc.text('No agent activity recorded this week.');
    doc.moveDown(0.75);
    return;
  }

  doc.text(
    `Your AI agents executed ${metrics.totalToolCalls} actions this week. Grimdall blocked ${metrics.totalBlocked} dangerous actions, keeping ${clientName}'s infrastructure secure.`,
  );
  doc.moveDown(0.75);
}

function renderMetrics(doc: typeof PDFDocument.prototype, metrics: WeeklyMetrics): void {
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#111111').text('Metrics');
  doc.moveDown(0.35);

  const rows = [
    ['Total tool calls', String(metrics.totalToolCalls)],
    ['Total blocked', String(metrics.totalBlocked)],
    ['Total allowed', String(metrics.totalAllowed)],
  ];

  let rowY = doc.y;
  rows.forEach(([label, value]) => {
    doc.font('Helvetica').fontSize(11).fillColor('#333333');
    doc.text(label, 48, rowY, { width: 180 });
    doc.font('Helvetica-Bold').text(value, 280, rowY, { width: 50, align: 'right' });
    rowY += 14;
  });

  doc.y = rowY + 6;
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111').text('Top blocked tools');
  doc.font('Helvetica').fontSize(11).fillColor('#333333');

  if (metrics.topBlockedTools.length === 0) {
    doc.text('None');
  } else {
    metrics.topBlockedTools.forEach((item) => {
      doc.text(`${item.tool} (${item.count})`);
    });
  }

  doc.moveDown(0.75);
}

function renderBlockedLog(doc: typeof PDFDocument.prototype, entries: AuditEntry[]): void {
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#111111').text('Blocked Actions Log');
  doc.moveDown(0.35);

  const blockedEntries = entries.filter((entry) => entry.decision === 'blocked').slice(0, 10);
  if (blockedEntries.length === 0) {
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#333333')
      .text('No blocked actions recorded this week.');
    return;
  }

  blockedEntries.forEach((entry, index) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#111111')
      .text(`${index + 1}. ${entry.tool} - ${entry.timestamp}`);
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#444444')
      .text(entry.reason ?? 'No reason provided');
    doc.moveDown(0.25);
  });
}

function renderFooter(doc: typeof PDFDocument.prototype, agencyName: string): void {
  const footerY = doc.page.height - doc.page.margins.bottom - 18;
  doc.font('Helvetica').fontSize(9).fillColor('#666666');
  doc.y = footerY;
  doc.text(`Generated by Grimdall Technologies | ${agencyName}`, {
    align: 'center',
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
  });
}

function formatDateRange(): string {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`;
}
