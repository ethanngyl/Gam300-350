/*!************************************************************************
\file index.js
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 08-11-2026
\brief
@codefine/splat-renderer: the Codefine engine's splat renderer, compiled to
WebAssembly (engine/web, built by engine/build-web.bat into dist/), behind a
small JavaScript API. The caller owns the canvas, input events and render
loop; this module owns the WebAssembly instance and its memory. See
README.md for setup and an example.
- RenderMode
PointCloud (0) and Gaussian (1), as cf_set_render_mode takes them.
- DEFAULT_ENGINE_URL
Where dist/codefine-engine.js is expected to be served: /engine/.
- EngineUnavailableError
Thrown by createSplatRenderer when the engine can't run here (not built,
or no WebGL2), so the caller can fall back to another viewer.
- loadEngineFactory(engineUrl)
Imports the Emscripten module factory once per URL.
- createSplatRenderer(canvas, options)
Starts an engine instance drawing into canvas; resolves to a SplatRenderer.
**************************************************************************/

export const RenderMode = Object.freeze({ PointCloud: 0, Gaussian: 1 })

export const DEFAULT_ENGINE_URL = '/engine/codefine-engine.js'

export class EngineUnavailableError extends Error
{
  constructor(message)
  {
    super(message)
    this.name = 'EngineUnavailableError'
  }
}

// One import per engine URL. A failed import isn't kept, so building the
// engine and trying again works without reloading the page.
const factories = new Map()

let canvasCounter = 0

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Imports the Emscripten module factory (createCodefineEngine) from
    engineUrl. It is a runtime import, not a bundled one, because the .js
    loads its .wasm next to itself.
  \param engineUrl
    URL of dist/codefine-engine.js as the page serves it
  \return
    Promise of the factory
*/
/************************************************************************/
export function loadEngineFactory(engineUrl = DEFAULT_ENGINE_URL)
{
  const url = new URL(engineUrl, globalThis.location?.href).href
  if (!factories.has(url))
  {
    const promise = import(/* @vite-ignore */ url)
      .then((module) => module.default)
      .catch((error) =>
      {
        factories.delete(url)
        throw error
      })
    factories.set(url, promise)
  }
  return factories.get(url)
}

/************************************************************************/
/*!
  \brief
    Copies .ply bytes into the engine's memory and parses them. HEAPU8 is
    read after malloc, because growing the heap replaces its buffer.
  \param engine
    The Emscripten module instance
  \param data
    ArrayBuffer | Uint8Array | Uint8Array[] (chunks, e.g. from a stream)
  \param name
    string, shown in the engine's log
  \return
    number, the splat count (throws if the file couldn't be read)
*/
/************************************************************************/
function loadPlyInto(engine, data, name)
{
  const chunks = Array.isArray(data) ? data : [data instanceof Uint8Array ? data : new Uint8Array(data)]
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0)
  if (size === 0) throw new Error('The .ply is empty.')

  const ptr = engine._malloc(size) >>> 0
  if (!ptr) throw new Error('Not enough memory to load this model in the browser.')
  try
  {
    let offset = ptr
    for (const chunk of chunks)
    {
      engine.HEAPU8.set(chunk, offset)
      offset += chunk.length
    }
    const count = engine.ccall('cf_load_ply', 'number', ['number', 'number', 'string'], [ptr, size, name])
    if (count === -1) throw new Error('The engine is not ready, or already holds as many models as it can.')
    if (count <= 0) throw new Error('The engine could not read this .ply (see the browser console).')
    return count
  }
  finally
  {
    engine._free(ptr)
  }
}

/************************************************************************/
/*!
  \brief
    Starts an engine instance that draws into canvas (WebGL2). Each call
    gets its own instance and memory, so several canvases can each have one.
  \param canvas
    HTMLCanvasElement (given an id if it has none; the engine finds it by id)
  \param options
    { engineUrl?: string, printErr?: (message) => void }
  \return
    Promise of a SplatRenderer (see index.d.ts); rejects with
    EngineUnavailableError if the engine isn't built or WebGL2 is missing
*/
/************************************************************************/
export async function createSplatRenderer(canvas, { engineUrl = DEFAULT_ENGINE_URL, printErr } = {})
{
  if (!canvas.id) canvas.id = `codefine-splat-${++canvasCounter}`

  let factory
  try
  {
    factory = await loadEngineFactory(engineUrl)
  }
  catch
  {
    throw new EngineUnavailableError(`The engine has not been built for the web (no ${engineUrl}; run engine/build-web.bat).`)
  }

  const engine = await factory({ printErr: printErr ?? ((message) => console.warn('[Engine]', message)) })
  if (!engine.ccall('cf_init', 'number', ['string'], [`#${canvas.id}`]))
  {
    throw new EngineUnavailableError('This browser does not support WebGL2.')
  }

  let disposed = false
  // Every call after dispose() does nothing, so late input events are harmless.
  const live = (fn) => (...args) => (disposed ? undefined : fn(...args))

  return {
    loadPly: live((data, name = 'model.ply') => loadPlyInto(engine, data, name)),
    clear: live(() => engine._cf_clear()),
    setRenderMode: live((mode) => engine._cf_set_render_mode(mode === RenderMode.Gaussian ? 1 : 0)),
    get splatCount() { return disposed ? 0 : engine._cf_splat_count() },
    orbit: live((dx, dy) => engine._cf_orbit(dx, dy)),
    pan: live((dx, dy) => engine._cf_pan(dx, dy)),
    zoom: live((notches) => engine._cf_zoom(notches)),
    resetCamera: live(() => engine._cf_reset_camera()),
    render: live((width, height) => engine._cf_render(width, height)),
    dispose: () =>
    {
      if (disposed) return
      disposed = true
      try
      {
        engine._cf_shutdown()
      }
      catch (error)
      {
        // The instance has already stopped (e.g. it ran out of memory).
        console.warn('[Engine] shutdown failed:', error)
      }
    },
  }
}
// ----- End of Functions ----------------------------------------------------- //
