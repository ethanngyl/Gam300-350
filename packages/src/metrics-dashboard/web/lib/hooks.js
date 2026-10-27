/*!************************************************************************
\file hooks.js
\author Ethan Ng
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 23-10-2026
\brief
React hooks shared by the dashboard.
- useMetrics(refreshMs)
Loads /api/metrics, re-polls every refreshMs (0 = off) while the tab is
visible, and exposes { data, error, loading, refresh }.
- useHashRoute(routes, fallback)
Current tab from location.hash (#/metrics), so tabs are linkable and
survive a reload.
- useElementWidth()
[ref, width] that follows the element's width, for responsive SVG charts.
**************************************************************************/

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fetchMetrics } from './metrics.js'

export function useMetrics(refreshMs) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const controller = useRef(null)

  const refresh = useCallback(() => {
    controller.current?.abort()
    const ctl = new AbortController()
    controller.current = ctl
    setState((s) => ({ ...s, loading: true }))
    fetchMetrics(ctl.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((err) => {
        if (err.name !== 'AbortError') setState((s) => ({ ...s, error: err.message, loading: false }))
      })
  }, [])

  useEffect(() => {
    // Initial load runs once the effect is committed, not during render.
    const first = setTimeout(refresh, 0)
    return () => {
      clearTimeout(first)
      controller.current?.abort()
    }
  }, [refresh])

  useEffect(() => {
    if (!refreshMs) return undefined
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, refreshMs)
    return () => clearInterval(id)
  }, [refresh, refreshMs])

  return { ...state, refresh }
}

export function useHashRoute(routes, fallback) {
  const read = useCallback(() => {
    const key = window.location.hash.replace(/^#\/?/, '')
    return routes.includes(key) ? key : fallback
  }, [routes, fallback])
  const [route, setRoute] = useState(read)

  useEffect(() => {
    const onHash = () => setRoute(read())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [read])

  const navigate = useCallback((key) => {
    window.location.hash = `/${key}`
  }, [])
  return [route, navigate]
}

export function useElementWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    // Measure before first paint, then follow resizes.
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}
