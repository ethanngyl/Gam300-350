/*!************************************************************************
\file plyHeader.js
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 26-10-2026
\brief
Reads metadata from the header of a Brush-exported Gaussian splat .ply
without downloading the whole file.
- readCameraUp(url)
Fetches only the first 4 KB of the .ply (HTTP Range) and reads the
"Vertical axis" line Brush writes into the header. Returns it as
[x, y, z], or [0, 1, 0] (+Y) if it can't be found.
**************************************************************************/

/**
 * Read the scene's "up" direction from a Brush-exported .ply header so arbitrary
 * scenes render upright. Only the first few KB are fetched (HTTP Range).
 * Falls back to +Y if not found.
 */
export async function readCameraUp(url) {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-4095' } })
    // Blob URLs (a .ply opened from disk) may ignore Range, so stop reading
    // after 4 KB instead of pulling in the whole file
    const reader = res.body.getReader()
    const chunks = []
    let received = 0
    while (received < 4096) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
    }
    reader.cancel().catch(() => {})
    const text = new TextDecoder().decode(await new Blob(chunks).arrayBuffer())
    const m = text.match(/Vertical axis:\s*([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)/)
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  } catch {
    /* ignore — use default */
  }
  return [0, 1, 0]
}
