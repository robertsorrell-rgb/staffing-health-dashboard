#!/usr/bin/env node
'use strict';

const assert = require('assert');

var OT_REVIEW_OT_T1_VOLUNTARY_PARAM = 'ott1-1759507170';
var OT_REVIEW_OT_T1_V0_UUID = 'd2b11d4e-b2f5-4f37-bfe8-8d7401cceb1d';

function otReviewIsOtT1SkillName_(name) {
  return /^ot(\s+t1|\s+tier\s+1)$/i.test(String(name || '').trim().replace(/\s+/g, ' '));
}

function otReviewAssembledVoluntarySkillParam_(skillRow) {
  if (!skillRow) return '';
  const rawId = String(skillRow.id || skillRow.skill_id || '').trim();
  if (/^ott1-\d+$/.test(rawId)) return rawId;
  const name = String(skillRow.name || skillRow.skill_name || '').trim();
  const created = Number(skillRow.created_at || skillRow.createdAt || 0);
  if (created > 0 && otReviewIsOtT1SkillName_(name)) {
    return 'ott1-' + Math.floor(created);
  }
  if (otReviewIsOtT1SkillName_(name)) return OT_REVIEW_OT_T1_VOLUNTARY_PARAM;
  if (rawId.toLowerCase() === OT_REVIEW_OT_T1_V0_UUID) return OT_REVIEW_OT_T1_VOLUNTARY_PARAM;
  return '';
}

const otT1 = {
  id: 'd2b11d4e-b2f5-4f37-bfe8-8d7401cceb1d',
  name: 'OT T1',
  created_at: 1759507170,
};
assert.equal(otReviewAssembledVoluntarySkillParam_(otT1), 'ott1-1759507170');
assert.equal(otReviewAssembledVoluntarySkillParam_({ id: 'ott1-1759507170' }), 'ott1-1759507170');
assert.equal(otReviewAssembledVoluntarySkillParam_({ id: 'd2b11d4e-b2f5-4f37-bfe8-8d7401cceb1d' }), 'ott1-1759507170');
assert.equal(otReviewAssembledVoluntarySkillParam_({ id: 'd2b11d4e-b2f5-4f37-bfe8-8d7401cceb1d', name: 'OT T1' }), 'ott1-1759507170');
assert.equal(otReviewAssembledVoluntarySkillParam_({ name: 'OT T1' }), 'ott1-1759507170');

console.log('test-ot-peak-skill-param: OK');
