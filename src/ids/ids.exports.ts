import type { DetailRow } from './ids.types';

const escapeCsvValue = (value: string | undefined): string => {
  if (value == null) return '';
  const needsQuotes = /[",\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
};

export const toJson = (rows: DetailRow[]): Blob => {
  return new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
};

export const toCsv = (
  rows: DetailRow[],
  options?: { includePassed?: boolean; includeNA?: boolean }
): Blob => {
  const { includePassed = true, includeNA = true } = options ?? {};
  const filtered = rows.filter((row) => {
    if (row.status === 'FAILED') return true;
    if (row.status === 'PASSED') return includePassed;
    if (row.status === 'NA') return includeNA;
    return true;
  });
  const header = 'RuleId,RuleTitle,Status,GlobalId,IfcClass,Property,Expected,Actual,Reason';
  const lines = filtered.map((row) =>
    [
      escapeCsvValue(row.ruleId),
      escapeCsvValue(row.ruleTitle),
      escapeCsvValue(row.status),
      escapeCsvValue(row.globalId),
      escapeCsvValue(row.ifcClass),
      escapeCsvValue(row.propertyPath),
      escapeCsvValue(row.expected),
      escapeCsvValue(row.actual),
      escapeCsvValue(row.reason),
    ].join(',')
  );
  const csv = [header, ...lines].join('\r\n');
  return new Blob([csv], {
    type: 'text/csv;charset=utf-8;',
  });
};
