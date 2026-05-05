'use strict';

const { parseSheetNumber } = require('../_sheets.js');

/**
 * Reads a simple key/value block: column A = label, column B = value (formulas OK).
 * Ops bake Combined / Targeted / Automated hours here (IMPORTRANGE, QUERY, etc.).
 */
function normalizeLabel(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function labelMatches(norm, patterns) {
  return patterns.some((re) => re.test(norm));
}

const LABEL_COMBINED = [
  /^combined approved hours$/,
  /^total approved vto hours$/,
  /^approved vto hours total$/,
];
const LABEL_TARGETED = [/^targeted committed hours$/, /^targeted vto approved hours$/];
const LABEL_AUTOMATED = [/^automated approved hours$/, /^automated vto approved hours$/];

/**
 * @param {(string|number)[][]} values
 */
function parseVtoSummaryFromGrid(values) {
  const out = {
    combined_approved_hours: null,
    targeted_committed_hours: null,
    automated_approved_hours: null,
  };

  if (!values || !values.length) return out;

  for (const row of values) {
    const norm = normalizeLabel(row[0]);
    if (!norm) continue;
    const num = parseSheetNumber(row[1]);
    if (num == null || !Number.isFinite(num) || num < 0) continue;

    if (labelMatches(norm, LABEL_COMBINED)) out.combined_approved_hours = Math.round(num * 100) / 100;
    else if (labelMatches(norm, LABEL_TARGETED)) out.targeted_committed_hours = Math.round(num * 100) / 100;
    else if (labelMatches(norm, LABEL_AUTOMATED)) out.automated_approved_hours = Math.round(num * 100) / 100;
  }

  return out;
}

module.exports = { parseVtoSummaryFromGrid };
