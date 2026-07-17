#!/usr/bin/env node
/**
 * Pull pending Paylocity PTO from Time-Off Report CSV:
 * 1. Overwrite Gmail_Import with pending rows
 * 2. Overwrite Sheet1 input rows (PTO sheet) from same data
 */
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

const OUT_DIR = path.dirname(new URL(import.meta.url).pathname);
const CSV_PATH = '/Users/robert.sorrell/Downloads/Time-Off Report _ Daily.csv';
const SPREADSHEET_ID = '1gndsQQZdIJ5sr0XPP6aafRnQ95ZT4KXPQk5882To4F0';
const IMPORT_TAB = 'Gmail_Import';
const PTO_TAB = 'Sheet1';

const GMAIL_IMPORT_HEADERS = [
  'Work Contact: Work Email',
  'Position Status',
  'Payroll Name',
  'Position ID',
  'Home Department Code',
  'Home Department Description',
  'Policy Name [Time Off Transaction Summary]',
  'Reason Code',
  'Submitted date',
  'Request Date',
  'Requested By',
  'Start Time',
  'Amount',
  'Request Detail Status',
  'Last Reviewed By',
  'Review By Date',
  'Reviewer Comments',
  'Reports To Name',
  'Balance',
  'Employee Comments',
  'Employment Profile - Effective Date',
  'Time Off Transaction Summary - Effective Date',
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && next === '\n') i++;
      row.push(field);
      if (row.some((c) => String(c).trim())) rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((c) => String(c).trim())) rows.push(row);
  }
  return rows;
}

function norm(s) {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function buildColMap(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const key = norm(h);
    if (key) map[key] = i;
  });
  return map;
}

function getByAliases(row, colMap, aliases) {
  for (const alias of aliases) {
    const idx = colMap[norm(alias)];
    if (idx !== undefined) return String(row[idx] ?? '').trim();
  }
  return '';
}

function mapCsvRowToImportHeaders(csvHeaders, csvRow, targetHeaders) {
  const colMap = buildColMap(csvHeaders);
  return targetHeaders.map((header) => {
    const n = norm(header);
    if (n === 'POLICY NAME [TIME OFF TRANSACTION SUMMARY]') {
      return getByAliases(csvRow, colMap, [header, 'Policy Name [Time Off Transaction Summary]']);
    }
    if (n.includes('EMPLOYMENT PROFILE')) {
      return getByAliases(csvRow, colMap, ['Employment Profile - Effective Date', header]);
    }
    if (n.includes('TIME OFF TRANSACTION SUMMARY - EFFECTIVE')) {
      return getByAliases(csvRow, colMap, [
        'Time Off Transaction Summary - Effective Date',
        'Time Off Transaction Details - Effective Date',
        header,
      ]);
    }
    if (n === 'BALANCE') return getByAliases(csvRow, colMap, ['Balance']);
    if (n === 'SUBMITTED DATE') return getByAliases(csvRow, colMap, ['Submitted date', header]);
    return getByAliases(csvRow, colMap, [header, n]);
  });
}

function mapImportHeaderToPtoColumn(importHeader, ptoColMap) {
  const n = norm(importHeader);
  if (ptoColMap[n] !== undefined) return ptoColMap[n];
  if (n === 'REQUEST DETAIL STATUS' && ptoColMap['REQUEST DETAIL'] !== undefined) {
    return ptoColMap['REQUEST DETAIL'];
  }
  if (n === 'EMPLOYEE COMMENTS' && ptoColMap['REP COMMENTS'] !== undefined) {
    return ptoColMap['REP COMMENTS'];
  }
  return undefined;
}

function buildPtoRow(importRow, importHeaders, ptoHeaders) {
  const ptoColMap = buildColMap(ptoHeaders);
  const row = new Array(ptoHeaders.length).fill('');
  importHeaders.forEach((header, idx) => {
    const ptoIdx = mapImportHeaderToPtoColumn(header, ptoColMap);
    if (ptoIdx !== undefined) row[ptoIdx] = importRow[idx];
  });
  return row;
}

function loadServiceAccount() {
  const credPath = '/Users/robert.sorrell/dev/nerdy/VCPU-Dashboard/sheet-credentials.json';
  if (fs.existsSync(credPath)) return JSON.parse(fs.readFileSync(credPath, 'utf8'));
  return null;
}

function pullPendingImportRows(csvPath, targetHeaders) {
  const text = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(text);
  const csvHeaders = rows[0].map((h) => String(h || '').trim());
  const colMap = buildColMap(csvHeaders);
  const importRows = [];
  const statusCounts = {};

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const status = getByAliases(row, colMap, ['Request Detail Status', 'REQUEST STATUS', 'STATUS']);
    const statusKey = status || '(blank)';
    statusCounts[statusKey] = (statusCounts[statusKey] || 0) + 1;
    if (status.toLowerCase() !== 'pending') continue;
    importRows.push(mapCsvRowToImportHeaders(csvHeaders, row, targetHeaders));
  }

  return {
    pulledAt: new Date().toISOString(),
    statusCounts,
    importRows,
  };
}

async function getSheetHeaders(sheets, tab) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tab}!A1:ZZ1`,
  });
  return (res.data.values?.[0] || []).map((h) => String(h || '').trim());
}

async function overwriteTab(sheets, tabName, headers, dataRows) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A2:ZZ`,
  });

  if (!dataRows.length) return 0;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A2`,
    valueInputOption: 'RAW',
    requestBody: { values: dataRows },
  });

  return dataRows.length;
}

async function main() {
  const sa = loadServiceAccount();
  if (!sa) throw new Error('Missing service account credentials');

  const auth = new google.auth.GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  let importHeaders = await getSheetHeaders(sheets, IMPORT_TAB);
  if (!importHeaders.length) importHeaders = GMAIL_IMPORT_HEADERS;

  const ptoHeaders = await getSheetHeaders(sheets, PTO_TAB);
  if (!ptoHeaders.length) throw new Error('Missing Sheet1 headers');

  const { pulledAt, statusCounts, importRows } = pullPendingImportRows(CSV_PATH, importHeaders);
  const ptoRows = importRows.map((importRow) => buildPtoRow(importRow, importHeaders, ptoHeaders));

  const gmailWritten = await overwriteTab(sheets, IMPORT_TAB, importHeaders, importRows);
  const ptoWritten = await overwriteTab(sheets, PTO_TAB, ptoHeaders, ptoRows);

  const output = {
    pulledAt,
    source: path.basename(CSV_PATH),
    statusCounts,
    pendingCount: importRows.length,
    gmailImportRows: gmailWritten,
    sheet1Rows: ptoWritten,
  };

  fs.writeFileSync(path.join(OUT_DIR, 'pulled-pending-pto.json'), JSON.stringify(output, null, 2));

  console.log('SOURCE:', CSV_PATH);
  console.log('STATUS COUNTS:', statusCounts);
  console.log('Gmail_Import overwritten:', gmailWritten, 'rows');
  console.log('Sheet1 overwritten:', ptoWritten, 'rows');
  console.log('\nSAMPLE (first 3):');
  importRows.slice(0, 3).forEach((row, i) => {
    const nameIdx = importHeaders.indexOf('Payroll Name');
    const dateIdx = importHeaders.indexOf('Request Date');
    const amtIdx = importHeaders.indexOf('Amount');
    const statusIdx = importHeaders.indexOf('Request Detail Status');
    console.log(
      `${i + 1}. ${row[nameIdx]} | ${row[dateIdx]} | ${row[amtIdx]} | ${row[statusIdx]}`
    );
  });
  console.log(`\nhttps://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
