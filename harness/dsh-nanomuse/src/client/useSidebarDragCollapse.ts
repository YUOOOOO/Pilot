/** Extend DSH's own resize handle with a presentation-only collapse gesture. */
import { useEffect, useRef } from 'react'

// Matches the interaction boundary of the referenced PI-Desktop sidebar.
const COLLAPSE_THRESHOLD = 160

export function useSidebarDragCollapse(collapsed: boolean, toggle: () => void): void {
  const live = useRef({ collapsed, toggle })
  live.current = { collapsed, toggle }
  useEffect(() => {
    let drag: { pointerId: number; startX: number; startWidth: number } | null = null
    let pending: number | null = null
    const clear = () => { drag = null }
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || live.current.collapsed || drag) return
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-side="sidebar"]') : null
      if (!target) return
      const frame = target.parentElement
      const frameLeft = frame?.getBoundingClientRect().left ?? 0
      drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2 - frameLeft }
    }
    const up = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return
      const width = drag.startWidth + event.clientX - drag.startX
      clear()
      if (width >= COLLAPSE_THRESHOLD) return
      // Let DSH flush the resize and release pointer capture before toggling its layout.
      pending = requestAnimationFrame(() => {
        pending = null
        if (!live.current.collapsed) live.current.toggle()
      })
    }
    const cancel = (event: PointerEvent) => { if (drag?.pointerId === event.pointerId) clear() }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('pointerup', up, true)
    document.addEventListener('pointercancel', cancel, true)
    document.addEventListener('lostpointercapture', cancel, true)
    window.addEventListener('blur', clear)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('pointerup', up, true)
      document.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('blur', clear)
      document.removeEventListener('lostpointercapture', cancel, true)
      if (pending !== null) cancelAnimationFrame(pending)
    }
  }, [])
}
