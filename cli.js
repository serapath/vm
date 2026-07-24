#!/usr/bin/env node
// TODO migrate from nodejs to bare runtime
//const spawn = require('bare-runtime/spawn')
//spawn(__filename, { args: [require.resolve('./cli.js'), ...process.argv.slice(2)] })
/*****************************************************************************/
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const net = require('node:net')
/*****************************************************************************/
const goodbye = require('graceful-goodbye')
const crypto = require('hypercore-crypto')
const hyperdrive = require('hyperdrive')
const corestore = require('corestore')
const hyperbee = require('hyperbee')
/******************************************************************************
  CLI
/*****************************************************************************/
module.exports = (async function cli () {
  const api = { run, see, end }
  if (require.main !== module) return api
  goodbye(onshutdown)
  const { env } = process
  const is_daemon = ('OPTS' in env) && (Object.keys(env).length === 1)


// TODO
  console.log('MODE', Object.keys(process.env).length)
  const config = await new Promise(ok => setTimeout(ok, 1000, 'CONFIG'))

  if (is_daemon) {
    const { type, data } = JSON.parse(env.OPTS)
    console.log('[DAEMON]', process.ppid, process.pid)
//  const cmd = api[type] || function help () { console.log(docs()) }
//  await cmd(data)
    return
  } else {
//  const args = process.argv.slice(2)
//  const { type, data } = await parse_opts(args)

    const opts = 'STOP'
    const dir = path.join(__dirname, '.vm')

    const pid = await daemonify(dir, opts)
    console.log('[CLI]', process.pid, { pid })
  }
})().catch(onerror)
/******************************************************************************
  DAEMONIFY
/*****************************************************************************/
async function daemonify (dir, OPTS) {
  await fs.mkdir(dir, { recursive: true })
  const stdout = await fs.open(path.join(dir, 'stdout.log'), 'a')
  const stderr = await fs.open(path.join(dir, 'stderr.log'), 'a')
  const stdio = ['ignore', stdout.fd, stderr.fd]
  const sopts = { env: { OPTS }, cwd: dir, detached: true, stdio }
  const child = spawn(process.execPath, [__filename], sopts)
  child.unref()
  await stdout.close()
  await stderr.close()
  return child.pid
}
/******************************************************************************
  DAEMON
/*****************************************************************************/
function daemon () {
  console.log('[DAEMON]', 'TODO: implement')
//  // -------------------------
//  // CROSS CLIENT IPC
//  // -------------------------
//  const id = `ds-${crypto.randomUUID()}`
//  const iswin = process.platform === 'win32'
//  const socket = iswin ? `\\\\.\\pipe\\${id}` : path.join(dir, `.${id}.sock`)
//  await fs.writeFile('pid.json', JSON.stringify({ pid: process.pid, socket }))
//  const server = net.createServer() // detached process
//  server.on('connection', handler)
//  server.listen(socket)
//  function handler (socket) { socket.on('data', ondata) }
//  // Let the root client process close its own children via graceful-goodbye
//  // Triggers the cleanup logic (similar effect to receiving a process signal)
//  function ondata (data) {
//    if (goodbye.exiting) return // Boolean if the exit code is running.
//    if (data.toString() === 'shutdown') goodbye.exit()
//  }
//
}
/******************************************************************************
  DOCS
/*****************************************************************************/
function docs (name = 'ds') {
  return `[HELP]


${name} # shows this help


${name} run [<dirpath>] [--attach]
    # start service at <dirpath>
    # (default: dirpath=".") for current directory

    --

    # IMPORTANT: On first \`run <dirpath>\`, provide config via stdin, e.g.:

    ${name} run ./foo < config.json # locally

    # or

    ssh user@server '${name} /path/to/app' < config.json # remotely via ssh

    # config must contain: { "feedkey": "...", "secret": "..." }

    # IMPORTANT: after initialization, the persisted config is used
    # and new stdin configuration is no longer accepted


${name} see [<dirpath>] [--log[=<n>]]
    # Show whether service at <dirpath> is running and display its status
    # (default: dirpath=".") for current directory
    # status is json like: { pid }

    --log       # skip status display and show all logs instead
    --log=<n>   # same, but only show latest <n> logs (default: n=0 for all)


${name} end [<dirpath>] [--purge] [--yes]
    # Stop the service at <dirpath>
    # (default: dirpath=".") for current directory

    --purge       # additionaly remove service and all its persisted data
    --purge --yes # same, but skips purge confirmation


`
}
/******************************************************************************
  PARSE ARGS
/*****************************************************************************/
async function parse_opts (args) {
  if (!args.length) return { type: 'help' }
  const type = args.shift()
  switch (type) {
    case 'run': return { type, data: await run_opts(args) }
    case 'see': return { type, data: await see_opts(args) }
    case 'end': return { type, data: await end_opts(args) }
    default: fail(`Unknown command: ${type}`)
  }
  // --------------------------------------------------------------------------
  async function run_opts (args) {
    if (args.length > 1) fail(`Unexpected argument: ${args[1]}`)
    const dirpath = await validate_dirpath(args[0] || '.')
    return { dirpath }
  }
  // --------------------------------------------------------------------------
  async function see_opts (args) {
    const opts = { dirpath: '.', log: null }
    for (const opt of args) {
      if (opt.startsWith('--log')) {
        const n = Number(opt.slice(6))
        if (!Number.isInteger(n)) fail(`Invalid ${opt}: ${n}`)
        opts.log = n
        continue
      }
      if (opts.dirpath !== '.') fail(`Unexpected argument: ${opt}`)
      opts.dirpath = opt
    }
    opts.dirpath = await validate_dirpath(opts.dirpath)
    return opts
  }
  // --------------------------------------------------------------------------
  async function end_opts (args) {
    const opts = { dirpath: '.', purge: false, yes: false }
    for (const opt of args) switch (opt) {
      case '--purge': { opts.purge = true; continue }
      case '--yes': { opts.yes = true; continue }
      default: {
        if (opts.dirpath !== '.') fail(`Unexpected argument: ${opt}`)
        opts.dirpath = opt
      }
    }
    if (opts.yes && !opts.purge) fail(`--yes requires --purge`)
    opts.dirpath = await validate_dirpath(opts.dirpath)
    return opts
  }
  // --------------------------------------------------------------------------
  async function validate_dirpath (pathname) {
    if (typeof pathname !== 'string' || !pathname.length) {
      fail(`invalid directory path "${pathname}"`)
    }
    const dir = path.resolve(pathname)
    try {
      const stat = await fs.stat(dir)
      if (!stat.isDirectory()) fail(`invalid directory path "${dir}"`)
      return dir
    } catch (error) {
      if (error.code === 'ENOENT') return dir
      fail(error.message || '', { cause: error })
    }
  }
}
/******************************************************************************
  ONSHUTDOWN
/*****************************************************************************/
async function onshutdown () {
  console.log('TODO: shutdown')

//  goodbye(async function () {
//    console.log('i am run before exit')
//  })
//
//  // The position value allows you to group handlers, they're executed and awaited by ascending order.
//  goodbye(async () => console.log('last'), 2)
//  goodbye(async () => console.log('first'), 0)
//  goodbye(async () => console.log('middle'), 1)
//
}
/******************************************************************************
  ONERROR
/*****************************************************************************/
function onerror (error) {
  console.error(error)
  process.exit(1)
}
/******************************************************************************
  FAIL
/*****************************************************************************/
function fail (msg, ...args) {
  msg += `\n\n${docs()}\n\n`
  const error = Error(msg, ...args)
  Error.captureStackTrace(error, fail)
  throw error
}
/******************************************************************************
  API RUN
/*****************************************************************************/
async function run (opts) {
  console.log('[RUN]', opts)
  const { dirpath } = opts
  const storage = path.join(dirpath, '.vm')
  // requires JSON on stdin, validates it + saves/persists it as 0600 config.json 
  /*
  await fs.mkdir(pathname, { recursive: true })
  process.chdir(pathname)

  const config = await exists(file) ? await read(file) : await init(file)
  console.log('hello world', config)
  */
  async function exists (file) {
    try { return (await fs.access(file), true) } catch { return false }
  }
  // --------------------------------------------------------------------------
  async function read (file) {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  }
  // --------------------------------------------------------------------------
  async function init (file) {
    const input = await receive({ timeout: 2000, limit: 64 * 1024 })
    const config = JSON.parse(input)
    const opts = { flag: 'wx', mode: 0o600 }
    await fs.writeFile(file, JSON.stringify(config, null, 2) + '\n', opts)
    return config
  }
  // --------------------------------------------------------------------------
  function receive ({ timeout, limit }) {
    const { promise, resolve, reject } = Promise.withResolvers()
    let input = ''
    const timer = setTimeout(stop, timeout, 'No config received')
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', ondata)
    process.stdin.once('end', onend)
    process.stdin.once('error', stop)
    process.stdin.resume()
    return promise
    function ondata (chunk) {
      input += chunk
      if (Buffer.byteLength(input) > limit) stop('Config is too large')
    }
    function onend () {
      if (!input.trim()) return stop('No config received')
      stop(null, input)
    }
    function stop (error, value) {
      clearTimeout(timer)
      process.stdin.pause()
      process.stdin.removeListener('data', ondata)
      process.stdin.removeListener('end', onend)
      process.stdin.removeListener('error', stop)
      if (error) fail(error).catch(reject)
      else resolve(value)
    }
  }
}

/******************************************************************************
  API SEE
/*****************************************************************************/
async function see (opts) {
  console.log('[SEE]', opts)
}
/******************************************************************************
  API END
/*****************************************************************************/
async function end (opts) {
  console.log('[END]', opts)
  // -------------------------
  // CROSS SERVER IPC PID
  // -------------------------
//  const { socket } = JSON.parse(await fs.readFile('pid.json'))
//  const client = net.connect(socket, onopen)

  async function onopen () { // cli later
    // send shutdown over your persisted socket/pipe
    client.end('shutdown')
    // then wait until PID disappears, with no timeout
    while (isRunning(pid)) await delay(100) // https://www.npmjs.com/package/tree-kill
  //  //There is no built-in timeout. A handler can wait indefinitely unless:
  //  //a second SIGINT arrives
  //  //an external supervisor sends SIGKILL
  //  //you implement your own timeout
  //  // It does not run for process.exit() or unhandled errors.
  //  // FORCED SHUTDOWN!
  //  if (process.platform === 'win32') {
  //    spawn('taskkill', ['/PID', String(pid), '/T', '/F'])
  //  } else {
  //    process.kill(-pid, 'SIGKILL') // detached process group
  //  }
  //  // PID alone cannot provide reliable graceful shutdown on Windows; use the stored IPC endpoint.
  //  // -------------------------
  //  // CROSS KILL TREE
  //  // -------------------------
  //  const { execFile } = require('node:child_process')
  //  function kill (pid) { process.kill(pid, 'SIGTERM') }
  //  function exists (pid) {
  //    try { return (process.kill(pid, 0), true) } catch { return false }
  //  }
  //  function killTree (pid) {
  //    if (process.platform !== 'win32') return process.kill(-pid, 'SIGTERM')
  //    execFile('taskkill', ['/pid', String(pid), '/t', '/f'])
  //  }
  //
  }

}
/*****************************************************************************/
