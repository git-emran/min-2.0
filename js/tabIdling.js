const settings = require('util/settings/settings.js')
const urlParser = require('util/urlParser.js')
const webviews = require('webviews.js')

const DEFAULT_ENABLED = true
const DEFAULT_TIMEOUT_MINUTES = 30

function minutesToMs (minutes) {
  const n = Number(minutes)
  if (!Number.isFinite(n) || n <= 0) {
    return 0
  }
  return Math.round(n * 60 * 1000)
}

function normalizeExceptionDomain (domain) {
  if (!domain || typeof domain !== 'string') {
    return null
  }

  const trimmed = domain.trim().toLowerCase()
  if (!trimmed) {
    return null
  }

  return trimmed.replace(/^www\./, '')
}

function getHost (url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch (e) {
    return ''
  }
}

function hostMatchesException (host, exception) {
  if (!host || !exception) {
    return false
  }

  if (host === exception) {
    return true
  }

  // Allow "example.com" to match "sub.example.com".
  return host.endsWith('.' + exception)
}

const tabIdling = {
  enabled: DEFAULT_ENABLED,
  timeoutMs: minutesToMs(DEFAULT_TIMEOUT_MINUTES),
  exceptionDomains: [],
  scheduledTimeoutId: null,
  lastDiscardTime: 0,
  minTimeBetweenDiscardsMs: 10000,

  clearSchedule () {
    clearTimeout(tabIdling.scheduledTimeoutId)
    tabIdling.scheduledTimeoutId = null
  },

  scheduleNextCheck () {
    tabIdling.clearSchedule()

    if (!tabIdling.enabled || tabIdling.timeoutMs <= 0) {
      return
    }

    // Avoid background work when the window is not visible/focused.
    if (document.hidden || !document.body.classList.contains('focused')) {
      return
    }

    const now = Date.now()
    let nextIn = Infinity

    tasks.forEach(function (task) {
      task.tabs.forEach(function (tab) {
        const delay = tabIdling.getMsUntilIdleDiscard(tab, now)
        if (delay !== null && delay < nextIn) {
          nextIn = delay
        }
      })
    })

    if (nextIn === Infinity) {
      return
    }

    // Clamp to avoid extremely long timeouts and to guard against clock changes.
    const delay = Math.max(5000, Math.min(nextIn, 6 * 60 * 60 * 1000))
    tabIdling.scheduledTimeoutId = setTimeout(function () {
      tabIdling.runDiscardPass()
    }, delay)
  },

  getMsUntilIdleDiscard (tab, now = Date.now()) {
    if (!tab || tab.id === tabs.getSelected()) {
      return null
    }

    if (!tab.hasWebContents) {
      return null
    }

    if (tab.private) {
      return null
    }

    if (!tab.url) {
      return null
    }

    if (urlParser.isInternalURL(tab.url)) {
      return null
    }

    if (tab.loaded === false) {
      return null
    }

    if (tab.hasAudio || tab.muted) {
      return null
    }

    const host = getHost(tab.url)
    if (host && tabIdling.exceptionDomains.some(ex => hostMatchesException(host, ex))) {
      return null
    }

    const lastActivity = tab.lastActivity || now
    const idleFor = now - lastActivity
    const remaining = tabIdling.timeoutMs - idleFor

    return remaining <= 0 ? 0 : remaining
  },

  shouldDiscardNow (tab, now = Date.now()) {
    const remaining = tabIdling.getMsUntilIdleDiscard(tab, now)
    if (remaining === null) {
      return false
    }
    return remaining === 0
  },

  discardTab (tabId) {
    const tab = tabs.getRaw(tabId)
    if (!tab || !tab.hasWebContents) {
      return false
    }

    webviews.destroy(tabId)

    if (tabs.getRaw(tabId)) {
      tabs.update(tabId, { discarded: true })
    }

    tabIdling.lastDiscardTime = Date.now()
    return true
  },

  runDiscardPass () {
    tabIdling.clearSchedule()

    if (!tabIdling.enabled || tabIdling.timeoutMs <= 0) {
      return
    }

    // Avoid doing any discard work while the UI is backgrounded.
    if (document.hidden || !document.body.classList.contains('focused')) {
      return
    }

    const now = Date.now()

    // Rate-limit discards to avoid thrashing and to keep UI responsive.
    if (now - tabIdling.lastDiscardTime < tabIdling.minTimeBetweenDiscardsMs) {
      tabIdling.scheduleNextCheck()
      return
    }

    const candidates = []
    tasks.forEach(function (task) {
      task.tabs.forEach(function (tab) {
        if (tabIdling.shouldDiscardNow(tab, now)) {
          candidates.push(tab)
        }
      })
    })

    // Discard least-recently-active tabs first.
    candidates.sort((a, b) => (a.lastActivity || 0) - (b.lastActivity || 0))

    if (candidates.length > 0) {
      tabIdling.discardTab(candidates[0].id)
    }

    tabIdling.scheduleNextCheck()
  },

  initialize () {
    settings.listen('tabIdlingEnabled', function (value) {
      tabIdling.enabled = (value === undefined) ? DEFAULT_ENABLED : Boolean(value)
      tabIdling.scheduleNextCheck()
    })

    settings.listen('tabIdlingTimeoutMinutes', function (value) {
      const minutes = (value === undefined) ? DEFAULT_TIMEOUT_MINUTES : value
      tabIdling.timeoutMs = minutesToMs(minutes)
      tabIdling.scheduleNextCheck()
    })

    settings.listen('tabIdlingExceptions', function (value) {
      const raw = Array.isArray(value) ? value : []
      tabIdling.exceptionDomains = raw.map(normalizeExceptionDomain).filter(Boolean)
      tabIdling.scheduleNextCheck()
    })

    tasks.on('tab-selected', function (id) {
      const tab = tabs.getRaw(id)
      if (tab?.discarded) {
        tabs.update(id, { discarded: false })
      }
      tabIdling.scheduleNextCheck()
    })

    tasks.on('tab-added', function () {
      tabIdling.scheduleNextCheck()
    })

    tasks.on('tab-destroyed', function () {
      tabIdling.scheduleNextCheck()
    })

    tasks.on('tab-updated', function (id, key) {
      if (key === 'lastActivity' || key === 'hasAudio' || key === 'muted' || key === 'loaded' || key === 'url' || key === 'private' || key === 'hasWebContents') {
        tabIdling.scheduleNextCheck()
      }
    })

    ipc.on('focus', function () {
      tabIdling.scheduleNextCheck()
    })

    ipc.on('blur', function () {
      tabIdling.clearSchedule()
    })

    document.addEventListener('visibilitychange', function () {
      tabIdling.scheduleNextCheck()
    })

    tabIdling.scheduleNextCheck()
  }
}

module.exports = tabIdling

