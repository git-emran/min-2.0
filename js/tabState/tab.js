class TabList {
  constructor (tabs, parentTaskList, taskId) {
    this.tabs = tabs || []
    this.parentTaskList = parentTaskList
    this.taskId = taskId
    this.tabMap = new Map()
    this.tabIndexMap = new Map()
    this.selectedTabId = null

    this.rebuildCaches()

    this.tabs.forEach(tab => {
      this.parentTaskList.registerTab(tab.id, this.taskId)
    })
  }

  // tab properties that shouldn't be saved to disk

  rebuildCaches () {
    this.tabMap = new Map()
    this.tabIndexMap = new Map()
    this.selectedTabId = null

    for (var i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i]
      this.tabMap.set(tab.id, tab)
      this.tabIndexMap.set(tab.id, i)

      if (tab.selected && this.selectedTabId === null) {
        this.selectedTabId = tab.id
      }
    }
  }

  add (tab = {}, options = {}, emit = true) {
    var tabId = String(tab.id || Math.round(Math.random() * 100000000000000000)) // you can pass an id that will be used, or a random one will be generated.

    var newTab = {
      url: tab.url || '',
      title: tab.title || '',
      id: tabId,
      lastActivity: tab.lastActivity || Date.now(),
      secure: tab.secure,
      private: tab.private || false,
      readerable: tab.readerable || false,
      themeColor: tab.themeColor,
      backgroundColor: tab.backgroundColor,
      scrollPosition: tab.scrollPosition || 0,
      selected: tab.selected || false,
      muted: tab.muted || false,
      loaded: tab.loaded || false,
      canGoBack: tab.canGoBack || false,
      canGoForward: tab.canGoForward || false,
      navigationStateInitialized: tab.navigationStateInitialized || false,
      hasAudio: false,
      previewImage: '',
      isFileView: false,
      hasWebContents: false
    }

    if (options.atEnd) {
      this.tabs.push(newTab)
    } else {
      this.tabs.splice(this.getSelectedIndex() + 1, 0, newTab)
    }

    this.parentTaskList.registerTab(tabId, this.taskId)
    this.rebuildCaches()

    if (emit) {
      this.parentTaskList.emit('tab-added', tabId, newTab, options, this.taskId)
    }

    return tabId
  }

  update (id, data, emit = true) {
    const tab = this.getRaw(id)

    if (!tab) {
      throw new ReferenceError('Attempted to update a tab that does not exist.')
    }

    for (var key in data) {
      if (data[key] === undefined) {
        throw new ReferenceError('Key ' + key + ' is undefined.')
      }
      tab[key] = data[key]
      if (emit) {
        this.parentTaskList.emit('tab-updated', id, key, data[key], this.taskId)
      }
      // changing URL erases scroll position
      if (key === 'url') {
        tab.scrollPosition = 0
        if (emit) {
          this.parentTaskList.emit('tab-updated', id, 'scrollPosition', 0, this.taskId)
        }
      }
    }
  }

  destroy (id, emit = true) {
    const index = this.getIndex(id)
    if (index < 0) return false

    this.parentTaskList.get(this.taskId).tabHistory.push(this.toPermanentState(this.tabs[index]))
    this.parentTaskList.unregisterTab(id)
    this.tabs.splice(index, 1)
    this.rebuildCaches()

    if (emit) {
      this.parentTaskList.emit('tab-destroyed', id, this.taskId)
    }

    return index
  }

  get (id) {
    if (!id) { // no id provided, return an array of all tabs
      // it is important to copy the tab objects when returning them. Otherwise, the original tab objects get modified when the returned tabs are modified (such as when processing a url).
      return this.tabs.map(tab => Object.assign({}, tab))
    }
    const tab = this.getRaw(id)
    if (tab) {
      return Object.assign({}, tab)
    }
    return undefined
  }

  getRaw (id) {
    return this.tabMap.get(id)
  }

  has (id) {
    return this.tabMap.has(id)
  }

  getIndex (id) {
    return this.tabIndexMap.has(id) ? this.tabIndexMap.get(id) : -1
  }

  getSelected () {
    return this.selectedTabId
  }

  getSelectedIndex () {
    if (this.selectedTabId === null) {
      return null
    }
    return this.getIndex(this.selectedTabId)
  }

  getAtIndex (index) {
    return this.tabs[index] || undefined
  }

  getLatestActivityTab () {
    let latestTab = null

    this.tabs.forEach(tab => {
      if (!latestTab || tab.lastActivity > latestTab.lastActivity) {
        latestTab = tab
      }
    })

    return latestTab
  }

  setSelected (id, emit = true) {
    if (!this.has(id)) {
      throw new ReferenceError('Attempted to select a tab that does not exist.')
    }

    const currentTime = Date.now()
    const previouslySelectedTab = this.getRaw(this.selectedTabId)
    if (previouslySelectedTab && previouslySelectedTab.id !== id) {
      previouslySelectedTab.selected = false
      previouslySelectedTab.lastActivity = currentTime
    }

    const nextSelectedTab = this.getRaw(id)
    nextSelectedTab.selected = true
    nextSelectedTab.lastActivity = currentTime
    this.selectedTabId = id

    if (emit) {
      this.parentTaskList.emit('tab-selected', id, this.taskId)
    }
  }

  moveBy (id, offset) {
    var currentIndex = this.getIndex(id)
    var newIndex = currentIndex + offset
    var newIndexTab = this.getAtIndex(newIndex)
    if (newIndexTab) {
      var currentTab = this.getAtIndex(currentIndex)
      this.splice(currentIndex, 1, newIndexTab)
      this.splice(newIndex, 1, currentTab)
    }
    // This doesn't need to dispatch an event because splice will dispatch already
  }

  count () {
    return this.tabs.length
  }

  isEmpty () {
    if (!this.tabs || this.tabs.length === 0) {
      return true
    }

    if (this.tabs.length === 1 && !this.tabs[0].url) {
      return true
    }

    return false
  }

  forEach (fun) {
    return this.tabs.forEach(fun)
  }

  find (fun) {
    return this.tabs.find(fun)
  }

  some (fun) {
    return this.tabs.some(fun)
  }

  splice (...args) {
    this.parentTaskList.emit('tab-splice', this.taskId, ...args)
    return this.spliceNoEmit.apply(this, args)
  }

  spliceNoEmit (...args) {
    const insertedTabs = args.slice(2)
    const insertedTabIds = new Set(insertedTabs.map(tab => tab.id))
    const removedTabs = this.tabs.splice.apply(this.tabs, args)

    removedTabs.forEach(tab => {
      if (!insertedTabIds.has(tab.id)) {
        this.parentTaskList.unregisterTab(tab.id)
      }
    })

    insertedTabs.forEach(tab => {
      this.parentTaskList.registerTab(tab.id, this.taskId)
    })

    this.rebuildCaches()

    return removedTabs
  }

  toPermanentState (tab) {
    // removes temporary properties of the tab that are lost on page reload

    const result = {}
    Object.keys(tab)
      .filter(key => !TabList.temporaryProperties.includes(key))
      .forEach(key => {
        result[key] = tab[key]
      })

    return result
  }

  getStringifyableState () {
    return this.tabs.map(tab => this.toPermanentState(tab))
  }
}

TabList.temporaryProperties = ['canGoBack', 'canGoForward', 'navigationStateInitialized', 'hasAudio', 'previewImage', 'loaded', 'hasWebContents', 'discarded']

module.exports = TabList
