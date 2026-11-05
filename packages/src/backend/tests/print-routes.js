/*!************************************************************************
\file print-routes.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Test helper, run as a child process by openapi.test.js (with the isolated
settings from helpers.js): loads the real server.js without letting it
listen, then prints every route it registered as JSON ["GET /jobs/:id",
...] (the same set answers under /api/v1 and the legacy paths).
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import express from 'express'

// Catch the app when server.js starts listening, instead of opening a port.
let app = null
express.application.listen = function captureApp() {
    app = this
    return {}
}
console.log = () => {}
console.warn = () => {}
await import('../server.js')

const routes = new Set()
function walk(stack) {
    for (const layer of stack) {
        if (layer.route) {
            for (const method of Object.keys(layer.route.methods))
                for (const routePath of [].concat(layer.route.path)) routes.add(`${method.toUpperCase()} ${routePath}`)
        }
        else if (layer.handle?.stack) walk(layer.handle.stack)
    }
}
walk(app.router.stack)
process.stdout.write(JSON.stringify([...routes].sort()))
process.exit(0)
