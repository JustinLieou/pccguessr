// All user-facing copy and the RPC error-code -> message map.

export const S = {
  appName: 'PCCguessr',
  disclaimer: 'Unofficial student project — not affiliated with or endorsed by PCC',
  privacy: 'Privacy',

  // config
  configTitle: 'Setup needed',
  configMissing: 'This site is not configured yet. Edit js/config.js and set SUPABASE_URL and SUPABASE_ANON_KEY (see docs/SETUP.md).',
  mapsKeyMissing: 'The Google Maps key is not configured. Edit js/config.js and set GOOGLE_MAPS_KEY (see docs/SETUP.md).',
  mapsLoadFailed: 'Google Maps could not load. Check your connection and that the Maps key allows this site.',
  libLoadFailed: 'A required library failed to load. Check your connection and reload.',

  // nav
  navPlay: 'Play', navLeaderboard: 'Leaderboard', navProfile: 'Profile', navAdmin: 'Admin', navSignOut: 'Sign out',

  // login
  loginTitle: 'Sign in',
  loginIntro: 'Enter your PCC email address and we will send you a 6-digit code.',
  domainHint: (domains) => 'Allowed email domains: ' + domains.join(', '),
  emailLabel: 'PCC email',
  sendCode: 'Send code',
  sending: 'Sending…',
  codeSent: (email) => 'We sent a 6-digit code to ' + email + '. It expires in 10 minutes.',
  codeLabel: '6-digit code',
  verify: 'Verify',
  verifying: 'Verifying…',
  resend: 'Resend code',
  resendIn: (s) => 'Resend in ' + s + 's',
  useDifferentEmail: 'Use a different email',
  badDomain: (domains) => 'Please use your PCC email address (' + domains.join(' or ') + ').',
  plusNotAllowed: 'Email addresses with a + are not accepted. Use your plain PCC address.',
  badEmail: 'Please enter a valid email address.',
  badCode: 'Enter the 6-digit code from the email.',
  codeWrong: 'That code is incorrect or has expired. Check the latest email or request a new code.',
  rateLimited: 'Too many attempts. Please wait a few minutes and try again.',
  signupDenied: 'Only PCC email addresses can sign up.',
  sendFailed: 'We could not send the code. Please try again in a moment.',

  // play
  playTitle: 'Play',
  playIntro: 'You will see a spot on campus in Street View. Click where you think it is on the map. 5 rounds, 2 minutes each.',
  startGame: 'Start game',
  starting: 'Starting…',
  gamesToday: (n, max) => 'Games started today: ' + n + ' of ' + max,
  hudRound: 'Round', hudScore: 'Score', hudTime: 'Time',
  guessBtn: 'Guess',
  forfeit: 'Forfeit',
  confirmForfeit: 'Forfeit this game? It still counts toward your daily limit and will not appear on the leaderboard.',
  resuming: 'You already have a game in progress. Resuming it now.',
  placeMarkerHint: 'Click the map to place your guess',
  mapHandleOpen: 'Guess map',
  mapHandleClose: 'Hide map',
  submitting: 'Submitting…',
  resultTitle: (n) => 'Round ' + n + ' result',
  timedOut: 'Time is up! No score this round.',
  distanceAway: (d) => 'Your guess was ' + d + ' away.',
  roundScore: (s) => 'Round score: ' + s.toLocaleString(),
  totalScore: (s) => 'Total: ' + s.toLocaleString(),
  nextRound: 'Next round',
  seeResults: 'See results',
  loading: 'Loading…',
  resumePrompt: (n) => 'Welcome back. Round ' + n + ' is ready when you are.',
  panoUnavailable: 'This Street View location could not be loaded. Your round is still counting; guess anyway or ask an admin to check the location.',
  answerLabel: 'Answer', guessLabel: 'Your guess',

  // results
  resultsTitle: 'Game results',
  colRound: 'Round', colPlace: 'Location', colDistance: 'Distance', colScore: 'Score', colTotal: 'Total',
  noGuess: 'No guess',
  playAgain: 'Play again',
  viewLeaderboard: 'Leaderboard',
  flaggedNote: 'This game was flagged for review: ',
  voidedNote: 'This game was voided by an admin and does not count on the leaderboard.',

  // leaderboard
  lbTitle: 'Leaderboard',
  lbAll: 'All-time', lbWeek: 'This week',
  lbWeekNote: 'Weeks reset Monday 12:00 AM Central.',
  colRank: 'Rank', colPlayer: 'Player', colBest: 'Best score', colDate: 'Date',
  lbEmpty: 'No scores yet. Be the first!',
  lbYou: 'You',
  lbYourRank: 'Your rank',

  // profile
  profileTitle: 'Profile',
  displayName: 'Display name',
  nameRules: '3–20 characters. Letters, numbers, spaces, dots, dashes and underscores. Must start and end with a letter or number.',
  nameSaved: 'Display name saved.',
  saveName: 'Save name',
  nameNeeded: 'Choose a display name before you play.',
  statGames: 'Games completed', statBest: 'Best score', statWeek: 'Best this week', statToday: 'Games left today',
  signOut: 'Sign out',
  none: '—',

  // admin
  adminTitle: 'Admin',
  adminLocations: 'Locations',
  adminPlayers: 'Players',
  adminGames: 'Flagged games',
  noStreetView: 'No Street View here',
  clickMapHint: 'Click the map to look for Street View coverage.',
  outdoorOnly: 'Outdoor (official) coverage only',
  locName: 'Location name',
  locSave: 'Save location',
  locSaveNew: 'Save as new',
  locSaved: 'Location saved.',
  locEditing: (name) => 'Editing: ' + name,
  locNew: 'New location',
  checkAll: 'Check all panoramas',
  checking: (i, n) => 'Checking ' + i + ' of ' + n + '…',
  checkDone: (bad) => bad === 0 ? 'All panoramas resolve.' : bad + ' panorama(s) no longer resolve:',
  deactivate: 'Deactivate',
  activate: 'Activate',
  active: 'Active', inactive: 'Inactive',
  preview: 'Preview',
  del: 'Delete',
  confirmDelete: 'Delete this location?',
  searchPlayers: 'Search by display name',
  search: 'Search',
  rename: 'Rename',
  hide: 'Hide', unhide: 'Unhide',
  hiddenBadge: 'Hidden',
  newName: 'New display name',
  noPlayers: 'No players found.',
  noFlagged: 'No flagged games.',
  voidReason: 'Reason',
  voidGame: 'Void game',
  voided: 'Game voided.',
  saved: 'Saved.',

  // generic
  tryAgain: 'Try again',
  back: 'Back',
  genericError: 'Something went wrong. Please try again.',
  networkError: 'Network problem. Check your connection and try again.',
};

// RPC error code -> friendly message.
export const ERRORS = {
  PCCG_NOT_AUTHENTICATED: 'Your session has expired. Please sign in again.',
  PCCG_FORBIDDEN: 'You do not have permission to do that.',
  PCCG_NO_DISPLAY_NAME: 'Choose a display name before you play.',
  PCCG_GAME_IN_PROGRESS: 'You already have a game in progress. Resuming it now.',
  PCCG_DAILY_LIMIT: 'You have reached the daily game limit. Come back tomorrow!',
  PCCG_NOT_ENOUGH_LOCATIONS: 'The game is not ready yet: not enough locations have been added.',
  PCCG_GAME_NOT_FOUND: 'That game could not be found.',
  PCCG_GAME_NOT_ACTIVE: 'That game is no longer active.',
  PCCG_WRONG_ROUND: 'That is not the current round.',
  PCCG_ROUND_NOT_REVEALED: 'That round has not started yet.',
  PCCG_ALREADY_GUESSED: 'You already guessed this round.',
  PCCG_BAD_COORDS: 'That location is not valid.',
  PCCG_BAD_NAME: 'That name is not allowed. Use 3–20 letters, numbers, spaces, dots, dashes or underscores, and avoid offensive or official-sounding words.',
  PCCG_NAME_TAKEN: 'That display name is already taken.',
  // extra codes used by admin RPCs / leaderboard
  PCCG_NOT_FOUND: 'Not found.',
  PCCG_BAD_INPUT: 'Some of the information entered is not valid.',
  PCCG_LOCATION_IN_USE: 'This location has been used in games and cannot be deleted. Deactivate it instead.',
};

export function errorMessage(err) {
  if (!err) return S.genericError;
  if (err.userMessage) return err.userMessage;
  if (err.code && ERRORS[err.code]) return ERRORS[err.code];
  const m = /PCCG_[A-Z_]+/.exec(String(err.message || ''));
  if (m && ERRORS[m[0]]) return ERRORS[m[0]];
  if (err.isNetwork) return S.networkError;
  return S.genericError;
}
