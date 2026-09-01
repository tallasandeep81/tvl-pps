/* TVL PPS — edit this file once after deploying the Apps Script web app. */
window.PPS_CONFIG = {
  // Deploy > Manage deployments > copy the /exec URL and paste it here.
  API: 'https://script.google.com/macros/s/AKfycbwKd-W48SVJzcElayP8PVnifO5eocrmRXpKvPE4426lM4uWFPffGzrLuGR0grrhXTeT/exec',

  // Planning horizon shown on the board (5 = Mon-Fri, 6 = Mon-Sat).
  DAYS: 6,

  // Week starts on Monday (1). Sunday = 0.
  WEEK_START: 1,

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
