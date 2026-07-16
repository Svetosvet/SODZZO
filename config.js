// ---------------------------------------------------------------
// No API keys or tokens go in this file — YouTube and Vimeo credentials
// live server-side as Netlify environment variables (see README.md), so
// they're never in client-side code or committed to the git repo.
// This file only holds non-secret feature flags.
// ---------------------------------------------------------------
const CONFIG = {
  TWITCH_CLIENT_ID: "",       // optional, leave empty until you add Twitch
  TWITCH_ACCESS_TOKEN: "",    // optional
  DAILYMOTION_ENABLED: true    // Dailymotion's public search API needs no key
};
