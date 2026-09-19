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
            && ((window.innerWidth > 0) ? window.innerWidth : screen.width) <= 640
    }

    function enableDrawerSwipe(overlayEl, panelEl, closeFn) {
        if (!overlayEl || !panelEl || panelEl.dataset.swipeBound) return
        panelEl.dataset.swipeBound = '1'

        const handle = document.createElement('div')
        handle.className = 'drawer-handle'
        handle.setAttribute('aria-hidden', 'true')
        panelEl.insertBefore(handle, panelEl.firstChild)

        const DISMISS_DISTANCE = 110
        const DISMISS_VELOCITY = 0.55
        let startY = 0
        let startT = 0
        let dragY = 0
        let dragging = false

        function onStart(e) {
            if (!isMobileDrawer()) return
            dragging = true
            startY = e.touches[0].clientY
            startT = performance.now()
            dragY = 0
            panelEl.style.transition = 'none'
        }

        function onMove(e) {
            if (!dragging) return
            const raw = e.touches[0].clientY - startY
            dragY = raw > 0 ? raw : raw * 0.3
            if (dragY < -50) dragY = -50
            panelEl.style.transform = `translateY(${dragY}px)`
            const fade = Math.max(1 - Math.max(dragY, 0) / (panelEl.offsetHeight || 400) * 1.3, 0.3)
            overlayEl.style.opacity = dragY > 0 ? String(fade) : ''
            e.preventDefault()
        }

        function onEnd() {
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

        handle.addEventListener('touchstart', onStart, { passive: true })
        handle.addEventListener('touchmove', onMove, { passive: false })
        handle.addEventListener('touchend', onEnd)
        handle.addEventListener('touchcancel', onEnd)
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