const webviews = require('webviews.js')

var navigationButtons = {
  tabsList: document.getElementById('tabs-inner'),
  container: document.getElementById('toolbar-navigation-buttons'),
  backButton: document.getElementById('back-button'),
  forwardButton: document.getElementById('forward-button'),
  applyState: function (state) {
    navigationButtons.backButton.disabled = !state.canGoBack
    navigationButtons.forwardButton.disabled = !state.canGoForward

    if (state.canGoForward) {
      navigationButtons.container.classList.add('can-go-forward')
    } else {
      navigationButtons.container.classList.remove('can-go-forward')
    }
  },
  storeState: function (tabId, state) {
    const task = tasks.getTaskContainingTab(tabId)
    if (!task) {
      return
    }

    task.tabs.update(tabId, {
      canGoBack: !!state.canGoBack,
      canGoForward: !!state.canGoForward,
      navigationStateInitialized: true
    })

    if (tabId === tabs.getSelected()) {
      navigationButtons.applyState(state)
    }
  },
  refresh: function (tabId = tabs.getSelected()) {
    if (!tabId) {
      return Promise.resolve()
    }

    if (!webviews.hasViewForTab(tabId)) {
      navigationButtons.storeState(tabId, {
        canGoBack: false,
        canGoForward: false
      })
      return Promise.resolve()
    }

    return webviews.getNavigationState(tabId).then(function (state) {
      if (state) {
        navigationButtons.storeState(tabId, state)
      }
    }).catch(function () {})
  },
  update: function () {
    const selectedTabId = tabs.getSelected()
    const selectedTab = selectedTabId && tabs.getRaw(selectedTabId)

    if (!selectedTab || !selectedTab.url) {
      navigationButtons.applyState({
        canGoBack: false,
        canGoForward: false
      })
      return
    }

    navigationButtons.applyState(selectedTab)

    if (!selectedTab.navigationStateInitialized) {
      navigationButtons.refresh(selectedTabId)
    }
  },
  initialize: function () {
    navigationButtons.container.hidden = false

    navigationButtons.backButton.addEventListener('click', function (e) {
      webviews.goBackIgnoringRedirects(tabs.getSelected())
    })

    navigationButtons.forwardButton.addEventListener('click', function () {
      webviews.callAsync(tabs.getSelected(), 'goForward')
    })

    navigationButtons.container.addEventListener('mouseenter', function () {
      /*
      Prevent scrollbars from showing up when hovering the navigation buttons, if one isn't already shown
      This also works around a chromium bug where a flickering scrollbar is shown during the expanding animation:
      https://github.com/minbrowser/min/pull/1665#issuecomment-868551126
      */
      if (navigationButtons.tabsList.scrollWidth <= navigationButtons.tabsList.clientWidth) {
        navigationButtons.tabsList.classList.add('disable-scroll')
      }
    })

    navigationButtons.container.addEventListener('mouseleave', function () {
      navigationButtons.tabsList.classList.remove('disable-scroll')
    })

    tasks.on('tab-selected', this.update)
    webviews.bindEvent('did-navigate', tabId => navigationButtons.refresh(tabId))
    webviews.bindEvent('did-navigate-in-page', tabId => navigationButtons.refresh(tabId))
  }
}

module.exports = navigationButtons
