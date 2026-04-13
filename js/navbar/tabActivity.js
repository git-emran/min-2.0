/* global ipc */

/* fades out tabs that are inactive */

var tabBar = require('navbar/tabBar.js')

var tabActivity = {
  minFadeAge: 330000,
  refreshTimeout: null,
  refresh: function () {
    // Avoid periodic DOM work when the window is backgrounded.
    if (document.hidden || !document.body.classList.contains('focused')) {
      tabActivity.clearRefreshTimeout()
      return
    }

    requestAnimationFrame(function () {
      var tabSet = tabs.get()
      var selected = tabs.getSelected()
      var time = Date.now()

      var nextRefreshIn = Infinity

      tabSet.forEach(function (tab) {
        var tabEl = tabBar.getTab(tab.id)
        if (!tabEl) {
          return
        }

        if (selected === tab.id) { // never fade the current tab
          tabEl.classList.remove('fade')
          return
        }

        var age = time - tab.lastActivity
        if (age > tabActivity.minFadeAge) {
          tabEl.classList.add('fade')
        } else {
          tabEl.classList.remove('fade')

          // schedule the next refresh for when this tab crosses minFadeAge
          var msUntilFade = (tab.lastActivity + tabActivity.minFadeAge) - time
          if (msUntilFade > 0 && msUntilFade < nextRefreshIn) {
            nextRefreshIn = msUntilFade
          }
        }
      })

      // If nothing is pending a fade transition, don't keep waking the app.
      // Otherwise, schedule around the next needed transition (clamped).
      if (nextRefreshIn !== Infinity) {
        tabActivity.scheduleRefresh(Math.max(5000, Math.min(nextRefreshIn + 50, tabActivity.minFadeAge)))
      } else {
        tabActivity.clearRefreshTimeout()
      }
    })
  },
  scheduleRefresh: function (delay) {
    tabActivity.clearRefreshTimeout()

    // window focus/blur and visibility changes will trigger refresh separately
    tabActivity.refreshTimeout = setTimeout(function () {
      tabActivity.refresh()
    }, delay)
  },
  clearRefreshTimeout: function () {
    clearTimeout(tabActivity.refreshTimeout)
    tabActivity.refreshTimeout = null
  },
  initialize: function () {
    // Run once on init and then schedule future refreshes only when needed.
    tabActivity.refresh()

    tasks.on('tab-selected', this.refresh)
    tasks.on('tab-added', this.refresh)
    tasks.on('tab-destroyed', this.refresh)

    // If the window becomes visible/focused again, refresh immediately.
    ipc.on('focus', this.refresh)
    document.addEventListener('visibilitychange', this.refresh)
  }
}

module.exports = tabActivity
