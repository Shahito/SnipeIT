/**
 * overlay-a11y.js - shared modal/overlay accessibility helpers
 * Handles: inert on .app-layout, focus management, Enter/Esc keys.
 * Works for both simple confirm modals and large form modals.
 * Supports stacked modals via an open counter.
 */
(function () {
    let _openCount = 0
    const TRANSITION_MS = 180

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
})()