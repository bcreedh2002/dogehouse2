# Embedded Doghouse Studio

Ported from https://github.com/bcreedh2002/dogehouse1 at commit
`395756d39d5c489f8271d2ac7a6934a1809a707a`. Both upstream HTML uploads at that commit contain the same viewer.

Embedded 3D doghouse studio used by the DogeHouse site. Adapted for local iframe
embedding, safe saved-state loading, and integration with the parent site. Studio
state normalization and pricing are shared with the parent through state.js and
pricing.js. Optional modules can be framed and highlighted from the option list;
their colors can be customized and persist with saved designs. Older designs receive
the original default colors. Module prices are estimates pending confirmation by
the maker.
Three.js 0.128.0 and OrbitControls are vendored from the integrity-checked npm
package. See THREE-LICENSE. No external CDN requests are required.

The latest port includes single/gable roofs, undo/redo, editing and duplicating neon
graphics, roof-aware graphic placement, a dog fit estimator, dependent controls,
render recovery, and a keyboard/touch resizable mobile panel. Rendering stays on
demand, with sRGB color conversion, exposure 0.82 and resource disposal.

Save to account and Review my build use dogehouse2’s existing parent flows.
Optional Browser backups retain the upstream IndexedDB library, automatic draft
recovery, JSON import/export, and cross-tab conflict handling; these do not sync
to Supabase or become customer orders. Nameplates and existing full design states
remain supported. Local assets replace upstream CDN dependencies. Two bounded
960×720 order previews remain independent of the small browser-library thumbnail.

Shared state.js and pricing.js also run in the authenticated order function.
Redeploy submit-order when these files change. Older designs without roofShape
use single-slope roofs; older order snapshots may omit newly defaulted fields.
