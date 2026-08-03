#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'meeting-governor.gs'),
  'utf8'
);

new Function(source);
assert(source.includes("VERSION: 'v1.9.0'"));
assert(source.includes('thresholdCommit = mgCommitMeetingToAssembled_('));
assert(source.includes("sendUpdates: testMode ? 'none' : 'all'"));
assert(source.includes('conferenceDataVersion: 1'));
assert(source.includes('function mgMoveCalendarEvent_('));
assert(source.includes("Calendar.Events.remove(calendars[i], eventId, { sendUpdates: 'all' })"));

const audits = [];
const state = {
  testMode: false,
  inserted: [],
  patched: [],
  removed: [],
  events: {},
};

const context = {
  console,
  Date,
  JSON,
  Math,
  String,
  Number,
  Object,
  Array,
  Boolean,
  RegExp,
  Set,
  Map,
  Utilities: {
    formatDate(date) {
      return new Date(date).toISOString().slice(0, 19);
    },
    getUuid() {
      return 'test-uuid';
    },
    sleep() {},
  },
  Calendar: {
    Events: {
      insert(event, calendarId, options) {
        const created = {
          ...event,
          id: `event-${state.inserted.length + 1}`,
          htmlLink: 'https://calendar.google.com/event',
          hangoutLink: 'https://meet.google.com/unique-room',
        };
        state.events[`${calendarId}:${created.id}`] = created;
        state.inserted.push({ event, calendarId, options, created });
        return created;
      },
      get(calendarId, eventId) {
        const event = state.events[`${calendarId}:${eventId}`];
        if (!event) throw new Error('not found');
        return event;
      },
      patch(patch, calendarId, eventId, options) {
        const key = `${calendarId}:${eventId}`;
        if (!state.events[key]) throw new Error('not found');
        state.events[key] = { ...state.events[key], ...patch };
        state.patched.push({ patch, calendarId, eventId, options });
        return state.events[key];
      },
      remove(calendarId, eventId, options) {
        delete state.events[`${calendarId}:${eventId}`];
        state.removed.push({ calendarId, eventId, options });
      },
    },
  },
};

const sandbox = { ...context, __state: state, __audits: audits };
vm.runInNewContext(
  `${source}
mgLoadConfig_ = function() { return {}; };
mgConfigBool_ = function() { return true; };
mgIsTestMode_ = function() { return globalThis.__state.testMode; };
mgAudit_ = function() { globalThis.__audits.push(Array.prototype.slice.call(arguments)); };
mgResolveManagerGoogleEmail_ = function(name) {
  return mgNormManagerKey_(name) === 'shilo wheeler'
    ? 'shilo.wheeler@varsitytutors.com'
    : mgManagerNameToEmail_(name);
};
globalThis.__shiloEmails = mgManagerCalendarEmails_(
  'Shilo Gater',
  'shilo.gater@varsitytutors.com'
);
mgManagerCalendarEmails_ = function(managerName, managerEmail) {
  return mgNormManagerKey_(managerName).indexOf('shilo ') === 0
    ? globalThis.__shiloEmails.slice()
    : [managerEmail || 'manager@varsitytutors.com'];
};
mgGetManagerMeetLink_ = function() { return 'https://meet.google.com/static-fallback'; };
globalThis.__create = mgMaybeCreateManagerCalendarInvite_;
globalThis.__move = mgMoveCalendarEvent_;
globalThis.__delete = mgMaybeDeleteCalendarEvent_;`,
  sandbox
);

const liveCalendar = sandbox.__create(
  'shilo.gater@varsitytutors.com',
  'Lifecycle test',
  new Date('2026-07-20T15:00:00Z'),
  new Date('2026-07-20T15:30:00Z'),
  [{ name: 'Consultant', email: 'consultant@varsitytutors.com' }],
  ['Consultant'],
  'test-row',
  'Shilo Gater'
);
assert.equal(sandbox.__shiloEmails[0], 'shilo.wheeler@varsitytutors.com');
assert(sandbox.__shiloEmails.includes('shilo.gater@varsitytutors.com'));
assert(sandbox.__shiloEmails.includes('shilo.gator@varsitytutors.com'));
assert.equal(liveCalendar.calendarEmail, 'shilo.wheeler@varsitytutors.com');
assert.equal(state.inserted[0].calendarId, 'shilo.wheeler@varsitytutors.com');
assert.equal(liveCalendar.meetLink, 'https://meet.google.com/unique-room');
assert.equal(liveCalendar.uniqueMeet, true);
assert.equal(state.inserted[0].options.conferenceDataVersion, 1);
assert.equal(state.inserted[0].options.sendUpdates, 'all');
assert(
  state.inserted[0].event.attendees.some(
    (attendee) => attendee.email === 'consultant@varsitytutors.com'
  )
);

state.testMode = true;
const sandboxCalendar = sandbox.__create(
  'aaron.bunch@varsitytutors.com',
  'Sandbox lifecycle test',
  new Date('2026-07-20T16:00:00Z'),
  new Date('2026-07-20T16:30:00Z'),
  [{ name: 'Consultant', email: 'consultant@varsitytutors.com' }],
  ['Consultant'],
  'sandbox-row',
  'Aaron Bunch'
);
const sandboxInsert = state.inserted[1];
assert.equal(sandboxInsert.calendarId, 'primary');
assert.equal(sandboxInsert.options.sendUpdates, 'none');
assert(
  !sandboxInsert.event.attendees.some(
    (attendee) => attendee.email === 'consultant@varsitytutors.com'
  )
);

state.testMode = false;
const moveResult = sandbox.__move(
  'shilo.gater@varsitytutors.com',
  liveCalendar.eventId,
  new Date('2026-07-20T17:00:00Z'),
  new Date('2026-07-20T17:30:00Z'),
  'move-row',
  'Shilo Gater'
);
assert.equal(moveResult.ok, true);
assert.equal(moveResult.meetLink, 'https://meet.google.com/unique-room');
assert.equal(state.patched[0].options.sendUpdates, 'all');
assert.equal(state.patched[0].options.conferenceDataVersion, 1);

const deleted = sandbox.__delete(
  'shilo.gater@varsitytutors.com',
  liveCalendar.eventId,
  'delete-row',
  'Shilo Gater'
);
assert.equal(deleted, true);
assert.equal(state.removed[0].options.sendUpdates, 'all');

assert(sandboxCalendar.eventId);
console.log('Meeting Governor V1 Calendar lifecycle smoke passed');
