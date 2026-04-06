const TabList = require('tabState/tab.js')
const TabStack = require('tabRestore.js')

class TaskList {
  constructor () {
    this.tasks = [] // each task is {id, name, tabs: [], tabHistory: TabStack}
    this.events = []
    this.taskMap = new Map()
    this.taskIndexMap = new Map()
    this.tabTaskMap = new Map()
    this.selectedTasks = new Map()
    this.pendingCallbacks = []
    this.pendingCallbackTimeout = null
  }

  on (name, fn) {
    this.events.push({ name, fn })
  }

  rebuildTaskCaches () {
    this.taskMap = new Map()
    this.taskIndexMap = new Map()
    this.selectedTasks = new Map()

    for (var i = 0; i < this.tasks.length; i++) {
      const task = this.tasks[i]
      this.taskMap.set(task.id, task)
      this.taskIndexMap.set(task.id, i)

      if (task.selectedInWindow !== null && task.selectedInWindow !== undefined) {
        this.selectedTasks.set(task.selectedInWindow, task.id)
      }
    }
  }

  registerTab (tabId, taskId) {
    this.tabTaskMap.set(tabId, taskId)
  }

  unregisterTab (tabId) {
    this.tabTaskMap.delete(tabId)
  }

  emit (name, ...data) {
    this.events.forEach(listener => {
      if (listener.name === name || listener.name === '*') {
        this.pendingCallbacks.push([listener.fn, (listener.name === '*' ? [name] : []).concat(data)])

        // run multiple events in one timeout, since calls to setTimeout() appear to be slow (at least based on timeline data)
        if (!this.pendingCallbackTimeout) {
          this.pendingCallbackTimeout = setTimeout(() => {
            this.pendingCallbacks.forEach(t => t[0].apply(this, t[1]))
            this.pendingCallbacks = []
            this.pendingCallbackTimeout = null
          }, 0)
        }
      }
    })
  }

  add (task = {}, index, emit = true) {
    const taskId = task.id || String(TaskList.getRandomId())
    const newTask = {
      name: task.name || null,
      tabs: new TabList(task.tabs, this, taskId),
      tabHistory: new TabStack(task.tabHistory),
      collapsed: task.collapsed, // this property must stay undefined if it is already (since there is a difference between "explicitly uncollapsed" and "never collapsed")
      id: taskId,
      selectedInWindow: task.selectedInWindow || null
    }

    if (index) {
      this.tasks.splice(index, 0, newTask)
    } else {
      this.tasks.push(newTask)
    }

    this.rebuildTaskCaches()

    if (emit) {
      this.emit('task-added', newTask.id, Object.assign({}, newTask, { tabHistory: task.tabHistory, tabs: task.tabs }), index)
    }

    return newTask.id
  }

  update (id, data, emit = true) {
    const task = this.get(id)

    if (!task) {
      throw new ReferenceError('Attempted to update a task that does not exist.')
    }

    for (var key in data) {
      if (data[key] === undefined) {
        throw new ReferenceError('Key ' + key + ' is undefined.')
      }
      task[key] = data[key]
      if (emit) {
        this.emit('task-updated', id, key, data[key])
      }
    }
  }

  getStringifyableState () {
    return {
      tasks: this.tasks.map(task => Object.assign({}, task, { tabs: task.tabs.getStringifyableState() })).map(function (task) {
        // remove temporary properties from task
        const result = {}
        Object.keys(task)
          .filter(key => !TaskList.temporaryProperties.includes(key))
          .forEach(key => {
            result[key] = task[key]
          })
        return result
      })
    }
  }

  getCopyableState () {
    return {
      tasks: this.tasks.map(task => Object.assign({}, task, { tabs: task.tabs.tabs }))
    }
  }

  get (id) {
    return this.taskMap.get(id) || null
  }

  getSelected () {
    return this.get(this.selectedTasks.get(windowId))
  }

  byIndex (index) {
    return this.tasks[index]
  }

  getTaskContainingTab (tabId) {
    return this.get(this.tabTaskMap.get(tabId))
  }

  getIndex (id) {
    return this.taskIndexMap.has(id) ? this.taskIndexMap.get(id) : -1
  }

  setSelected (id, emit = true, onWindow = windowId) {
    const previouslySelectedId = this.selectedTasks.get(onWindow)

    if (previouslySelectedId) {
      const previousTask = this.get(previouslySelectedId)
      if (previousTask) {
        previousTask.selectedInWindow = null
      }
    }

    const task = this.get(id)
    if (!task) {
      throw new ReferenceError('Attempted to select a task that does not exist.')
    }

    task.selectedInWindow = onWindow
    this.rebuildTaskCaches()

    if (onWindow === windowId) {
      window.tabs = task.tabs
      if (emit) {
        this.emit('task-selected', id)
        if (tabs.getSelected()) {
          this.emit('tab-selected', tabs.getSelected(), id)
        }
      }
    }
  }

  destroy (id, emit = true) {
    const index = this.getIndex(id)
    const task = this.get(id)

    if (index < 0 || !task) return false

    if (emit) {
    // emit the tab-destroyed event for all tabs in this task
      task.tabs.forEach(tab => this.emit('tab-destroyed', tab.id, id))

      this.emit('task-destroyed', id)
    }

    task.tabs.forEach(tab => this.unregisterTab(tab.id))
    this.tasks.splice(index, 1)
    this.rebuildTaskCaches()

    return index
  }

  getLastActivity (id) {
    var tabs = this.get(id).tabs
    var lastActivity = 0

    for (var i = 0; i < tabs.count(); i++) {
      if (tabs.getAtIndex(i).lastActivity > lastActivity) {
        lastActivity = tabs.getAtIndex(i).lastActivity
      }
    }

    return lastActivity
  }

  isCollapsed (id) {
    var task = this.get(id)
    return task.collapsed || (task.collapsed === undefined && Date.now() - tasks.getLastActivity(task.id) > (7 * 24 * 60 * 60 * 1000))
  }

  getLength () {
    return this.tasks.length
  }

  map (fun) { return this.tasks.map(fun) }

  forEach (fun) { return this.tasks.forEach(fun) }

  indexOf (task) { return this.tasks.indexOf(task) }

  slice (...args) { return this.tasks.slice.apply(this.tasks, args) }

  splice (...args) {
    const result = this.tasks.splice.apply(this.tasks, args)
    this.rebuildTaskCaches()
    return result
  }

  filter (...args) { return this.tasks.filter.apply(this.tasks, args) }

  find (filter) {
    for (var i = 0, len = this.tasks.length; i < len; i++) {
      if (filter(this.tasks[i], i, this.tasks)) {
        return this.tasks[i]
      }
    }
  }

  static getRandomId () {
    return Math.round(Math.random() * 100000000000000000)
  }
}

TaskList.temporaryProperties = ['selectedInWindow']

module.exports = TaskList
