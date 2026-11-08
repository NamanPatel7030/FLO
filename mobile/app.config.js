// Extends app.json. On EAS, google-services.json comes from the file env var
// GOOGLE_SERVICES_JSON (it is git-ignored, so it isn't uploaded with the source).
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? config.android.googleServicesFile,
  },
});
