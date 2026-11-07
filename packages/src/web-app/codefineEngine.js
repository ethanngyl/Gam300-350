/*!************************************************************************
\file codefineEngine.js
\author Ethan Ng Yong Le
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
The Codefine engine compiled to WebAssembly, from the
@codefine/splat-renderer package (engine/web/package). Kept so existing
imports keep working; new code can import the package directly
(createSplatRenderer, as EngineSplatViewer.jsx does).
- loadEngineFactory()
Resolves to the Emscripten module factory (createCodefineEngine).
- isEngineAvailable()
Resolves true if the compiled engine can be loaded, false otherwise.
**************************************************************************/

import { loadEngineFactory } from '@codefine/splat-renderer'

export { loadEngineFactory }

export async function isEngineAvailable() {
  try {
    await loadEngineFactory()
    return true
  } catch {
    return false
  }
}
