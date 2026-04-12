const { pathToFileURL } = require('url')

const defaultResponseHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'accelerometer=(), ambient-light-sensor=(), autoplay=(), bluetooth=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), hid=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), serial=(), usb=()'
}

const htmlResponseHeaders = Object.assign({}, defaultResponseHeaders, {
  'content-security-policy': [
    "default-src 'self' data: blob: http: https:",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: file: http: https:",
    "font-src 'self' data:",
    "connect-src 'self' data: blob: http: https:",
    "media-src 'self' data: blob: file: http: https:",
    "frame-src 'self' http: https:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ')
})

function getResponseHeaders (pathname) {
  if (pathname.endsWith('.html')) {
    return htmlResponseHeaders
  }

  return defaultResponseHeaders
}

async function createInternalResponse (pathToServe, pathname) {
  const upstream = await net.fetch(pathToFileURL(pathToServe).toString())
  const headers = new Headers(upstream.headers)

  const extraHeaders = getResponseHeaders(pathname)
  Object.keys(extraHeaders).forEach(function (key) {
    headers.set(key, extraHeaders[key])
  })

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  })
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'min',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    }
  }
])

function registerBundleProtocol (ses) {
  ses.protocol.handle('min', (req) => {
    let { host, pathname } = new URL(req.url)

    if (pathname.charAt(0) === '/') {
      pathname = pathname.substring(1)
    }

    if (host !== 'app') {
      return new Response('bad', {
        status: 400,
        headers: { 'content-type': 'text/html' }
      })
    }

    // NB, this checks for paths that escape the bundle, e.g.
    // app://bundle/../../secret_file.txt
    const pathToServe = path.resolve(__dirname, pathname)
    const relativePath = path.relative(__dirname, pathToServe)
    const isSafe = relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)

    if (!isSafe) {
      return new Response('bad', {
        status: 400,
        headers: { 'content-type': 'text/html' }
      })
    }

    return createInternalResponse(pathToServe, pathname)
  })
}

app.on('session-created', (ses) => {
  if (ses !== session.defaultSession) {
    registerBundleProtocol(ses)
  }
})
