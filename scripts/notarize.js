// afterSign hook — runs after electron-builder has signed every
// helper + binary inside the .app, before the DMG is built.
//
// Why we do this manually instead of letting electron-builder's
// built-in notarize handle it:
//   1. electron-builder 24.13's YAML schema doesn't accept the
//      `keychainProfile` key on mac.notarize (only `appBundleId` /
//      `ascProvider` / `teamId`), so the only path through
//      electron-builder is APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD
//      env vars.
//   2. That env-var path triggers a long-standing bug in
//      @electron/notarize 2.x where any non-JSON output from
//      notarytool (e.g. a transient HTTP error) crashes the build
//      with "Unexpected token 'E'".
//
// Going through @electron/notarize directly with keychainProfile
// avoids both: credentials live in the macOS keychain (set up via
// `xcrun notarytool store-credentials "GatherOS-Notarize" ...`),
// and we get cleaner error reporting.

const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') return;
  // Escape hatch for fast local builds where you don't want the
  // ~2-3 minute round-trip to Apple's notary service. Set
  // SKIP_NOTARIZE=1 to ship an unsigned-by-Apple build.
  if (process.env.SKIP_NOTARIZE === '1') {
    console.log('[notarize] SKIP_NOTARIZE=1 — skipping');
    return;
  }
  const appName = context.packager.appInfo.productFilename;
  const appPath = `${context.appOutDir}/${appName}.app`;
  console.log(`[notarize] sending ${appPath} to Apple…`);
  await notarize({
    tool: 'notarytool',
    appPath,
    keychainProfile: 'GatherOS-Notarize',
  });
  console.log('[notarize] complete');
};
