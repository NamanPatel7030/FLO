// Extends app.json. On EAS, google-services.json comes from the file env var
// GOOGLE_SERVICES_JSON (it is git-ignored, so it isn't uploaded with the source).
// Without it the app still builds and works (pairing, inbox, presence); only push
// notifications need Firebase.
const fs = require("fs");
const path = require("path");

module.exports = ({ config }) => {
  const local = path.join(__dirname, config.android.googleServicesFile || "google-services.json");
  const file = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? config.android.googleServicesFile : undefined);
  const android = { ...config.android };
  if (file) android.googleServicesFile = file;
  else delete android.googleServicesFile;
  return { ...config, android };
};
