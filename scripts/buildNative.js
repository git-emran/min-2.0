const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')

const rootDir = path.resolve(__dirname, '..')
const nativeDir = path.join(rootDir, 'native')
const buildDir = path.join(nativeDir, 'build', 'Release')
const targets = [
  {
    sourceFile: path.join(nativeDir, 'history_score.cc'),
    outFile: path.join(buildDir, 'history_score.node')
  },
  {
    sourceFile: path.join(nativeDir, 'places_tokenizer.cc'),
    outFile: path.join(buildDir, 'places_tokenizer.node')
  },
  {
    sourceFile: path.join(nativeDir, 'tag_ranker.cc'),
    outFile: path.join(buildDir, 'tag_ranker.node')
  },
  {
    sourceFile: path.join(nativeDir, 'quick_score.cc'),
    outFile: path.join(buildDir, 'quick_score.node')
  }
]

function getNodeIncludeDir () {
  const execDir = path.dirname(process.execPath)
  const includeDir = path.join(execDir, '..', 'include', 'node')

  if (!fs.existsSync(includeDir)) {
    throw new Error('Unable to locate Node headers at ' + includeDir)
  }

  return includeDir
}

function getCompileCommand (sourceFile, outFile) {
  const includeDir = getNodeIncludeDir()

  if (process.platform === 'darwin') {
    return {
      command: 'c++',
      args: [
        '-std=c++17',
        '-shared',
        '-fPIC',
        '-undefined',
        'dynamic_lookup',
        '-I' + includeDir,
        sourceFile,
        '-o',
        outFile
      ]
    }
  }

  if (process.platform === 'linux') {
    return {
      command: 'c++',
      args: [
        '-std=c++17',
        '-shared',
        '-fPIC',
        '-I' + includeDir,
        sourceFile,
        '-o',
        outFile
      ]
    }
  }

  throw new Error('Native build is not configured for platform ' + process.platform)
}

function buildNative () {
  fs.mkdirSync(buildDir, { recursive: true })

  targets.forEach(function (target) {
    const compile = getCompileCommand(target.sourceFile, target.outFile)

    childProcess.execFileSync(compile.command, compile.args, {
      cwd: rootDir,
      stdio: 'inherit'
    })

    console.log('Built native addon:', target.outFile)
  })
}

if (module.parent) {
  module.exports = buildNative
} else {
  buildNative()
}
