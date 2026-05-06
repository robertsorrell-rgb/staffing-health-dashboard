'use strict';

const { runNightlyCaptureIfDue } = require('./lib/dashboard-snapshot-nightly.js');

exports.handler = async () => {
  try {
    const out = await runNightlyCaptureIfDue();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(out),
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[snapshot-nightly]', e);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message || String(e) }),
    };
  }
};
