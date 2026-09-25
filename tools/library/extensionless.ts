/* ====================================================================
   EXTENSIONLESS — lets Node load the app's own modules unchanged.

   The app is written for Vite, which resolves `import "../core"` to
   core.ts; Node's native TypeScript does not. The library tools use the
   app's parsers to verify conversions (so the check is what the app will
   actually play), so they run with this resolve hook:

     node --import ./tools/library/extensionless.ts tools/library/convert.ts

   It only retries a relative specifier that failed to resolve with
   ".ts" appended; everything else resolves exactly as Node would.
   ==================================================================== */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      if (!relative || /\.[cm]?[jt]s$/.test(specifier)) throw err;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
