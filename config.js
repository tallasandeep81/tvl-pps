/* TVL PPS — edit this file once after deploying the Apps Script web app. */
window.PPS_CONFIG = {
  // Deploy > Manage deployments > copy the /exec URL and paste it here.
  API: 'https://script.google.com/macros/s/AKfycbwKd-W48SVJzcElayP8PVnifO5eocrmRXpKvPE4426lM4uWFPffGzrLuGR0grrhXTeT/exec',

  // Planning horizon shown on the board (5 = Mon-Fri, 6 = Mon-Sat).
  DAYS: 6,

  // Week starts on Monday (1). Sunday = 0.
  WEEK_START: 1,

  // Non-working days. Every Sunday is a holiday automatically and is NOT
  // listed here. Below is TVL/ID/438 REV04 for FY 2026 — same list the
  // production report script uses.
  // When FY 2027 is issued, add the new dates in the same yyyy-mm-dd form.
  HOLIDAYS: {
    '2026-01-15': 'Makara Sankranthi',
    '2026-01-26': 'Republic Day',
    '2026-03-04': 'Holi',
    '2026-03-19': 'Ugadi',
    '2026-05-01': 'May Day',
    '2026-08-15': 'Independence Day',
    '2026-09-14': 'Vinayaka Chavithi',
    '2026-09-15': 'Maha Panchami',
    '2026-10-02': 'Gandhi Jayanthi',
    '2026-10-19': 'Vijayadashami',
    '2026-10-20': 'Vijayadashami',
    '2026-11-09': 'Deepavali'
  },

  // Reasons offered on the Shift entry screen when output falls short of plan.
  // Edit this list freely — add, remove or reword. "Other" always asks for typed text.
  REASONS: [
    'Machine breakdown',
    'Tool / insert change',
    'Setting or trial time',
    'Material not available',
    'Power failure',
    'Operator absent',
    'Quality problem / rework',
    'Maintenance work',
    'Plan changed by planning',
    'Shift started late / ended early',
    'Other'
  ]
};
