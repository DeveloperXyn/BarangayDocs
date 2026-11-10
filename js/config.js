/* Single place to configure the front end. Loaded first by index.html and app.html. */
window.BD_CONFIG = {
  // false -> talk to the real backend at API_BASE (server.js + MySQL). true -> browser-only demo data (no backend needed)
  USE_MOCK: false,
  API_BASE: '/api/v1',
  // notification bell polling interval (ms)
  POLL_MS: 30000,
  // how long a browser session lasts before the user must sign in again
  SESSION_HOURS: 8,
  // mock mode only: the OTP code that is accepted
  MOCK_OTP: '123456'
};
