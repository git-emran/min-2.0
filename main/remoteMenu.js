const activeMenus = new Map()

ipc.on('open-context-menu', function (e, data) {
  var menu = new Menu()

  data.template.forEach(function (section) {
    section.forEach(function (item) {
      const id = typeof item.click === 'number' ? item.click : null
      if (id !== null) {
        item.click = function () {
          e.sender.send('context-menu-item-selected', { menuId: data.id, itemId: id })
        }
      }
      if (item.submenu) {
        for (var i = 0; i < item.submenu.length; i++) {
          const subItem = item.submenu[i]
          const subId = typeof subItem.click === 'number' ? subItem.click : null
          if (subId !== null) {
            (function (id) {
              subItem.click = function () {
                e.sender.send('context-menu-item-selected', { menuId: data.id, itemId: id })
              }
            })(subId)
          }
        }
      }
      menu.append(new MenuItem(item))
    })
    menu.append(new MenuItem({ type: 'separator' }))
  })
  menu.on('menu-will-close', function () {
    e.sender.send('context-menu-will-close', { menuId: data.id })
    activeMenus.delete(data.id)
  })
  activeMenus.set(data.id, menu)
  const win = windows.windowFromContents(e.sender)?.win || windows.getCurrent()
  menu.popup({ window: win, x: data.x, y: data.y })
})
