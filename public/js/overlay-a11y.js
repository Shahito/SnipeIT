/**
 * overlay-a11y.js - shared modal/overlay accessibility helpers
 * Handles: inert on .app-layout, focus management, Enter/Esc keys.
 * Works for both simple confirm modals and large form modals.
 * Supports stacked modals via an open counter.
 * Also exposes enableDrawerSwipe() - drag-to-dismiss for bottom-sheet
 * overlays on mobile, bound to a small handle auto-injected in the panel.
 */
(function () {
    let _openCount = 0
    const TRANSITION_MS = 180

    function isMobileDrawer() {
        return window.matchMedia('(hover: none) and (pointer: coarse)').matches
            && ((window.innerWidth > 0) ? window.innerWidth : screen.width) <= 850
    }

    function getScrollParent(node, boundary) {
        if (!node) return null
        const style = getComputedStyle(node)
        const canScroll = (style.overflowY === 'auto' || style.overflowY === 'scroll')
            && node.scrollHeight > node.clientHeight
        if (canScroll) return node
        // Only stop climbing *after* testing the boundary itself — panelEl
        // is the scrollable element for a plain modal (overflow-y: auto on
        // panelEl directly), so it has to be eligible, not excluded.
        if (node === boundary || node === document.body) return null
        return getScrollParent(node.parentElement, boundary)
    }

    function enableDrawerSwipe(overlayEl, panelEl, closeFn) {
        if (!overlayEl || !panelEl || panelEl.dataset.swipeBound) return
        panelEl.dataset.swipeBound = '1'

        // Visual grip only now — the whole panel is draggable, this is just
        // the affordance users expect to see at the top of a sheet.
        const handle = document.createElement('div')
        handle.className = 'drawer-handle'
        handle.setAttribute('aria-hidden', 'true')
        panelEl.insertBefore(handle, panelEl.firstChild)

        const DISMISS_DISTANCE = 110
        const DISMISS_VELOCITY = 0.55
        let startY = 0
        let startT = 0
        let dragY = 0
        let dragging = false     // true once the sheet itself is being pulled
        let tracking = false     // true for the whole duration of a touch on the panel
        let startedAtTop = false // decided once, at touchstart — never re-checked mid-gesture

        function onStart(e) {
            if (!isMobileDrawer()) return
            tracking = true
            dragging = false
            // panelEl itself may be overflow:hidden with its own scrollable
            // children (e.g. .ip-results) — check whichever element under
            // the finger actually scrolls, not panelEl.
            const scrollTarget = getScrollParent(e.target, panelEl)
            startedAtTop = scrollTarget ? scrollTarget.scrollTop <= 0 : true
            startY = e.touches[0].clientY
            startT = performance.now()
            dragY = 0
        }

        function onMove(e) {
            // If this gesture didn't start at the top of the content, it's a
            // plain scroll for its whole duration — even once scrollTop
            // rebounds to 0 mid-gesture. Switching mid-flight is what causes
            // the "cancelable=false" warning and the visual jump.
            if (!tracking || !startedAtTop) return
            const raw = e.touches[0].clientY - startY

            if (!dragging) {
                if (raw <= 0) return
                dragging = true
                panelEl.style.transition = 'none'
            }

            dragY = raw > 0 ? raw : raw * 0.3
            if (dragY < -50) dragY = -50
            panelEl.style.transform = `translateY(${dragY}px)`
            const fade = Math.max(1 - Math.max(dragY, 0) / (panelEl.offsetHeight || 400) * 1.3, 0.3)
            overlayEl.style.opacity = dragY > 0 ? String(fade) : ''
            e.preventDefault()
        }

        function onEnd() {
            tracking = false
            if (!dragging) return
            dragging = false
            const dt = performance.now() - startT
            const velocity = dragY / Math.max(dt, 1)
            const shouldDismiss = dragY > DISMISS_DISTANCE || (dragY > 30 && velocity > DISMISS_VELOCITY)

            panelEl.style.transition = ''
            overlayEl.style.opacity = ''

            if (shouldDismiss) {
                const travel = Math.max(panelEl.offsetHeight, window.innerHeight) + 80
                panelEl.style.transform = `translateY(${travel}px)`
                closeFn()
                setTimeout(() => {
                    panelEl.style.transform = ''
                    panelEl.style.transition = ''
                }, 220)
            } else {
                panelEl.style.transform = ''
            }
        }

        panelEl.addEventListener('touchstart', onStart, { passive: true })
        panelEl.addEventListener('touchmove', onMove, { passive: false })
        panelEl.addEventListener('touchend', onEnd)
        panelEl.addEventListener('touchcancel', onEnd)
    }

    function openModal(modalId, focusId) {
        const modal = document.getElementById(modalId)
        if (!modal) return
        modal.classList.remove('hidden')
        _openCount++
        document.querySelector('.app-layout')?.setAttribute('inert', '')
        if (_openCount === 1) document.body.style.overflow = 'hidden'
        requestAnimationFrame(() => modal.classList.add('open'))
        if (focusId) {
            requestAnimationFrame(() => document.getElementById(focusId)?.focus())
        }
        enableDrawerSwipe(modal, modal.firstElementChild, () => closeModal(modalId))
    }

    function closeModal(modalId) {
        const modal = document.getElementById(modalId)
        if (!modal || !modal.classList.contains('open')) return
        modal.classList.remove('open')
        _openCount = Math.max(0, _openCount - 1)
        if (_openCount === 0) {
            document.querySelector('.app-layout')?.removeAttribute('inert')
            document.body.style.overflow = ''
        }
        setTimeout(() => modal.classList.add('hidden'), TRANSITION_MS)
    }

    function bindModalKeys(modalId, { onConfirm, onCancel } = {}) {
        document.addEventListener('keydown', e => {
            if (e.key === 'Enter' && onConfirm) {
                // If focus is on a button (Cancel, close, etc.), let the browser
                // trigger that button's own click natively instead of hijacking
                // Enter for onConfirm.
                if (document.activeElement?.tagName === 'BUTTON') return
                e.preventDefault()
                onConfirm()
            }
            if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel() }
        })
        if (onCancel) {
            document.getElementById(modalId)?.addEventListener('mousedown', e => {
                if (e.target.id === modalId) onCancel()
            })
        }
    }

    window.openModal = openModal
    window.closeModal = closeModal
    window.bindModalKeys = bindModalKeys
    window.enableDrawerSwipe = enableDrawerSwipe
})()