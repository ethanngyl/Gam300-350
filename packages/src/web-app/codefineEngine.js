/*!************************************************************************
\file codefineEngine.js
\author Ethan Ng Yong Le
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-10-2026
\brief
Loads the Codefine engine compiled to WebAssembly (engine/web, built by
engine/build-web.bat into public/engine).
- loadEngineFactory()
Resolves to the Emscripten module factory (createCodefineEngine).
- isEngineAvailable()
Resolves true if the compiled engine can be loaded, false otherwise.
**************************************************************************/

// Served from public/engine, so it is a runtime URL rather than a bundled import.
const ENGINE_URL = '/engine/codefine-engine.js'

let factoryPromise = null

/**
 * Import the Emscripten module factory once. A failed import is not cached, so
 * building the engine and retrying works without a full page reload.
 */
export function loadEngineFactory() {
  if (!factoryPromise) {
    const url = new URL(ENGINE_URL, window.location.origin).href
    factoryPromise = import(/* @vite-ignore */ url)
      .then((m) => m.default)
      .catch((err) => {
        factoryPromise = null
        throw err
      })
  }
  return factoryPromise
}

export async function isEngineAvailable() {
  try {
    await loadEngineFactory()
    return true
  } catch {
    return false
  }
}
