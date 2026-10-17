'use strict';

const { liveOccurrenceId } = require('./live-occurrence-choice');
const { eventOccurrenceForDate, eventReachesEvening, isEligibleEveningAnchor } = require('../candidates/evening-event-weave');

// An offer is a reference to accepted source facts, never permission to bypass
// the selected-day/venue-clock/route gates. The compose handler checks it again.
function withLiveDiscoveryChoices(live) {
  const selectedDate = live?.selected_date;
  function row(input) {
    if (!input || typeof input !== 'object') return input;
    const { live_occurrence_id, live_choice_eligible, ...event } = input;
    if (Array.isArray(event.occurrences) && event.occurrences.length) {
      return { ...event, occurrences: event.occurrences.map(row) };
    }
    const occurrence = eventOccurrenceForDate(event, selectedDate);
    const id = occurrence && liveOccurrenceId(occurrence);
    if (!id || occurrence.route_eligible !== true || !isEligibleEveningAnchor(occurrence) ||
        eventReachesEvening(occurrence, selectedDate) !== true) return event;
    return { ...event, live_occurrence_id: id, live_choice_eligible: true, occurrence_date: selectedDate };
  }
  const bucket = value => (Array.isArray(value) ? value.map(row) : []);
  return { ...live, tonight: bucket(live.tonight), this_week: bucket(live.this_week),
    ...(live.browse ? { browse: { ...live.browse,
      tonight: { ...live.browse.tonight, more: bucket(live.browse.tonight?.more) },
      this_week: { ...live.browse.this_week, more: bucket(live.browse.this_week?.more) },
    } } : {}),
  };
}

module.exports = { withLiveDiscoveryChoices };
