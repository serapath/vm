#!/usr/bin/env node
// TODO:01(future) migrate from nodejs to bare runtime
//const spawn = require('bare-runtime/spawn')
//spawn(__filename, { args: [require.resolve('./cli.js'), ...process.argv.slice(2)] })
/*****************************************************************************/
const { spawn } = require('node:child_process')
const filesystem = require('node:fs')
const path = require('node:path')
const net = require('node:net')
/*****************************************************************************/
const goodbye = require('graceful-goodbye')
const crypto = require('hypercore-crypto')
const hyperdrive = require('hyperdrive')
const corestore = require('corestore')
const hyperbee = require('hyperbee')
const b4a = require('b4a')
/*****************************************************************************/
const fs = filesystem.promises
const pkg = require('./package.json')
const NAME = pkg.name//.toUpperCase()
const { version } = pkg
// TODO:02(soon): bump version + investigate why no data was persisted on VPS
// TODO:03(last): timestamp for boot in lockfile and on termination or deletion log it
// TODO:04(later): add proper hypercore based logger + reporter, merged with corestore
// TODO:05(future): allow "global installing" new cli sub commands to operate on .vm?
/*****************************************************************************/
const api = module.exports = { run, see, end }
if (require.main === module) cli().catch(onerror)
/******************************************************************************
  CLI
/*****************************************************************************/
async function cli () {
  console.log(`[${NAME}] (version)`, version)
  const { DATA } = (Object.keys(process.env).length === 1) && process.env
  const opts = JSON.parse(DATA || null)
  const { type, data } = opts ? {} : await parse_args(process.argv.slice(2))
  goodbye(async function onshutdown () {
    await global_cleanup(DATA ? { type: 'run', data: opts } : { type, data })
  })
  if (opts) return await init_daemon(opts)
  const cmd = api[type] || function help () { console.log(docs()) }
  const result = await cmd(data)
  console.log(`[${NAME}] ${type}`, process.pid, { data, result })
}
/******************************************************************************
  DOCS
/*****************************************************************************/
function docs (name = 'ds') {
  // TODO:07 fix unimplemented flags
  // TODO:08 brainstorm about additional flags to generate configs used to pipe to run
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

    # config must contain: { "idkey": "...", "secret": "..." }

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
async function parse_args (args) {
  if (!args.length) return { type: 'help', data: {} }
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
    const dir = path.resolve(pathname) // uses process.cwd() + normalizes too
    const parts = dir.split(path.sep)
    const invalid = parts.some(part => part.toLowerCase() === '.vm')
    if (invalid) return fail(`cant spawn inside a ".vm" folder like: "${dir}"`)
    try {
      const stat = await fs.stat(dir)
      if (!stat.isDirectory()) fail(`invalid directory path "${dir}"`)
      return dir
    } catch (error) {
      if (error.code === 'ENOENT') return dir
      fail(`${error}`, { cause: error })
    }
  }
}
/******************************************************************************
  GLOBAL_CLEANUP
/*****************************************************************************/
async function global_cleanup ({ type, data }) {
  if (type === 'help') return
  const { dirpath } = data
  const vmdir = path.join(dirpath, '.vm')
  console.log('TODO: IMPLEMENT proper shutdown:', vmdir, { type, data })

  // TODO:09 make `cwd: dir` not be the `...path/.vm` but just the `...path` folder
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
function onerror (error) { return EXIT({ exitCode: 1, error }) }
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
  EXIT
/*****************************************************************************/
async function EXIT (context) {
  var cleanup_error
  try {
    const { error, exitCode = error ? 1 : 0, reason, cleanup } = context
    try { await cleanup?.() }
    catch (error) { cleanup_error = error }
    process.exitCode = cleanup_error && !exitCode ? 1 : exitCode
    console.log(`[${NAME}] (daemon) shutdown:`, reason)
    if (error) console.error(error)
    if (cleanup_error) console.error(cleanup_error)
    // TODO:10 do some proper cleanup so it self exits, e.g
    // everything that needs cleanup should register cleanup handlers
    if (!goodbye.exiting) return await goodbye.exit()
  } catch (error) {
    console.error(error)
    // process.exitCode = 1 // work towards removing all explicity `.exit(..) calls
    // => so that process exits on its own
    process.exit(1)
  }
}
/******************************************************************************
  DAEMON
/*****************************************************************************/
async function init_daemon (data) {
  const { dirpath } = data
  const vmdir = path.join(dirpath, '.vm')
  console.log(`[${NAME}] (daemon)`, 'TODO: implement', vmdir, { type: 'd-run', data })
  // TODO:11(soon): when required as a module, make sure daemon management is done appropriately too ... maybe run or launch daemon without detach mode,
  // BUT: maybe this file is already the daemon and it was either run attached or detached
  // => ...or maybe not? ...confusion!!!
  // -------------------------------------------------------
  // LOAD & VALIDATE: LOCK + CONFIG
  // -------------------------------------------------------
  const lockpath = path.join(vmdir, 'lock.json')
  const confpath = path.join(vmdir, 'conf.json')
  const conf = await read_json(confpath)
  const config = await load_config(conf)
  const oldlock = await read_json(lockpath)
  const lock = await load_lock(oldlock, config.idkey)
  const other = await claim(lockpath, lock, { force: !!oldlock })
  if (other) return fail(`daemon runs with PID "${other.pid}" since ${other.time}`)
  // Losing daemon exits before opening servers, modifying state, or starting work.
  console.log('[DAEMON] running') // Daemon is in charge now!
  // => successfully CLAIMED LOCK
  if (!conf) {
    try {
      const json = JSON.stringify(config, null, 2) + '\n'
      await fs.writeFile(confpath, json, { flag: 'wx', mode: 0o600 })
    } catch (error) { fail(`${error}`, { cause: error }) }
  }
  const { idkey, secret } = config
  const { time, pid, id } = lock
  /*
  idkey     user-supplied globally unique daemon identity
  id        deterministic local identifier derived from idkey
  lock      prevents concurrent use of one local daemon directory
  socket    provides IPC to the daemon associated with that directory
  */

  // =>
  // either ERROR timeout, no config received
  // or ERROR config corrupt, not parent readable, not parent closable, etc..
  // or provide the json read from parent
  // or json read locally

  // TODO:12 + create a README file that allows anyone to learn about the `.vm/...` folder, unless it already exists
  const READMEmd = path.join(vmdir, 'README.md')


  console.log(`[${NAME}] (daemon)`, { confpath, READMEmd, pid, id, time })


  const signals = { shutdown: onshutdown_signal }
  await onsignal(vmdir, id, signals)

  // ...
  // TODO:13 maybe even initialize or load corestore before logging "ready" to console
  console.log('ready')
  return
  // -------------------------------------------------------
  async function onshutdown_signal () {
    // TODO:14
    // Triggers the cleanup logic (similar effect to receiving a process signal)
    // Let the daemon process close its own children via graceful-goodbye
    // TODO:15 notify parent about win?
    return EXIT({ exitCode: 0, reason: 'IPC shutdown signal received' })
  }
  // -------------------------------------------------------
  async function onsignal (dir, id, on) {
    const iswin = process.platform === 'win32'
    const endpoint = iswin ? `\\\\.\\pipe\\${id}` : path.join(dir, `.${id}.sock`)
    const { resolve, reject, promise: ready } = Promise.withResolvers()
    const server = net.createServer() // for signals to detached process
    server.once('error', onerror)
    server.once('listening', onlistening)
    server.on('connection', onconnection)
    if (!iswin) await fs.rm(endpoint, { force: true })
    server.listen(endpoint)
    await ready
    // return { server, endpoint } // not really needed, so not returned
    function onerror (error) {
      server.removeListener('listening', onlistening)
      reject(error)
    }
    function onlistening () {
      server.removeListener('error', onerror)
      server.on('error', onruntimeerror)
      resolve()
    }
    function onruntimeerror (error) {
      // TODO:16 maybe restart signal listening server, but why did this happen?
      // -> unclear state, better shut down the daemon
      // --> or even better maybe restart the daemon?
      // --> but thats maybe unnecessary downtime, so maybe just ignore?
      const reason = 'IPC signal listening error'
      EXIT({ exitCode: 1, error, reason })
    }
    function onconnection (socket) {
      // TODO:17 does the client send a `ready` signal to parent
      // => or will the parent already notice when the socket opens?
      // -> IMPORTANT if the socket can carry initial info, that might be enough!
      socket.on('error', error => {
        console.error(`[${NAME}] (daemon)`, `IPC socket error`, error)
      })
      socket.on('data', async data => {
        if (goodbye.exiting) return // Boolean if the exit code is running
        const signal = data.toString()
        const handler = on[signal]
        if (!handler) console.log(`[${NAME}] (daemon)`, `unknown signal "${signal}"`)
        else try { await handler() } catch (error) {
          const context = (signal === 'shutdown') ? {
            exitCode: 1,
            reason: 'graceful goodbye cleanup fail',
            error,
            cleanup,
          } : {
            exitCode: 1,
            reason: `${data} signal processing failure`,
            error,
            cleanup,
          }
          await EXIT(context)
        }
      })
      // TODO:18 any sent signal is technically a single message and then should close
      // and if NO signal is sent, it should immediately close
      // if custom data can be provided by the sender or initiator with the `socket`
      // -> then NO message is needed, because the `socket` property can contain
      // the value that identifies the signal
    }
    async function cleanup () {
      const { resolve, reject, promise } = Promise.withResolvers()
      server.close(err => err ? reject(err) : resolve())
      await promise
    }
  }
  // -------------------------------------------------------
  async function read_json (filepath) {
    try { return JSON.parse(await fs.readFile(filepath, 'utf8')) }
    catch (error) {
      if (error.code === 'ENOENT') return
      fail(`invalid json "${filepath}"`, { cause: error })
    }
  }
  // -------------------------------------------------------
  function isvalid_lock (lock) {
    const invalid = !lock || typeof lock !== 'object'
    if (invalid) fail(`corrupted - invalid lockfile`)
    const valid_pid = Number.isInteger(lock.pid) && lock.pid > 1
    const valid_id = typeof lock.id === 'string'
    // TODO:19 id should be hex or z32 of hypercore discoveryKey
    // => use hex if a core does not automatically provide a z32 string of it
    if (!valid_pid) fail(`corrupted - invalid lockfile pid`)
    if (!valid_id) fail(`corrupted - invalid lockfile id`)
    return true
  }
  // -------------------------------------------------------
  function isvalid_config (config) {
    // idkey globally identifies one daemon.
    // Reusing an idkey in another directory is invalid configuration.
    // idkey is expected to be globally unique.
    // The caller is responsible for never reusing it for another daemon identity.
    const { idkey, secret } = config
    // idkey is a user-managed globally unique identity.
    // This process only enforces local directory ownership and does not verify
    // uniqueness across directories, machines, copied configurations, or backups.
    // TODO:20 implement config validation
    // -> to avoid spawning something that persists an invalid config
    // -> secret should be a a hypercore encryption key encoded as string
    // -> idkey should be a hypercore feedkey encoded as string
    return true
  }
  // -------------------------------------------------------
  function receive_config ({ timeout = 5000, limit = 64 * 1024  } = {}, done) {
    const timer = setTimeout(stop, timeout, 'No config received')
    const { resolve, reject, promise } = Promise.withResolvers()
    filesystem.readFile(3, 'utf8', stop)
    return promise.then(cleanup)
    function stop (error, json) {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        if (error) return fail(`${error}`, { cause: error })
        if (Buffer.byteLength(json) > limit) return fail('Config is too large')
        try { resolve(JSON.parse(json)) }
        catch (error) { fail(`${error}`, { cause: error }) }
      } catch (error) { return reject(error) }
    }
    async function cleanup (config, validationError, closeError) {
      try { isvalid_config(config) } catch (error) { validationError = error }
      try {
        const { resolve, reject, promise } = Promise.withResolvers()
        filesystem.close(3, error => error ? reject(error) : resolve())
        await promise
      } catch (error) { closeError = error }

      if (validationError) {
        if (closeError) validationError.closeError = closeError
        throw validationError
      }
      if (closeError) throw closeError
      return config
    }
  }
  // -------------------------------------------------------
  async function load_config (conf) {
    const config = conf ? (isvalid_config(conf), conf) : await receive_config()
    return config
  }
  // -------------------------------------------------------
  async function load_lock (oldlock, idkey) {
    if (oldlock) {
      isvalid_lock(oldlock)
      const { pid, id, time } = oldlock
      // TODO:21(maybe): maybe use id based endpoint to check running?
      if (is_running(pid)) return fail(`daemon runs with PID "${pid}" since ${time}`)
    }
    const time = Date.now()
    const pid = process.pid
    const id = b4a.toString(crypto.data(b4a.from(idkey, 'utf8')), 'hex')
    const lock = { id, pid, time }
    return lock
    function is_running (pid) {
    /* TODO:22
    For absolute race-safety during stale-file replacement, the existing daemon should be checked through its id based endpoint and the state file should include a unique startup token. For this type of local CLI, the retry loop is generally adequate.

    // Prefer verifying the daemon through its IPC endpoint
    // rather than relying only on the PID, because PIDs can be reused.
    */
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        if (error.code === 'ESRCH') return false
        if (error.code === 'EPERM') return true
        fail(`${error}`, { cause: error })
      }
    }
  }
  // -------------------------------------------------------
  async function claim (lockpath, lock, opts) {
    const data = JSON.stringify(lock)
    const { force } = opts
    const { resolve, reject, promise } = Promise.withResolvers()
    try {
      await fs.writeFile(lockpath, data, { flag: force ? 'w' : 'wx', mode: 0o600 })
      resolve()
    } catch (error) {
      if (error.code === 'EEXIST') resolve(error)
      else try { fail(`${error}`, { cause: error }) } catch (err) { reject(err) }
    }
    const error = await promise
    if (force) await new Promise(ok => setTimeout(ok, 100)) // delay to avoid race
    // 1. only in case a stale lockfile exists
    // 2. and more than one new daemon at the exact same time
    // 3. and both find the stale lockfile at the exact same time too
    // 4. and one writes a new lock, waits for 100ms and reads it back
    // 5. but the other new daemon only writes their lock afer those 100ms delay
    // => this seems impossibly unlikely
    // only if nodejs had a native `flock` it could be improved further
    // XXX: if this problem is not addressed, 2 daemons could run, which risks
    // -> concurrent write to hypercores using the same keypair
    // -> which risks data corruption
    const other = await read_json(lockpath)
    isvalid_lock(other)
    if (!force && error) return other
    const success = lock.pid === other.pid && lock.id === other.id
    return success ? null : other
  }
}
/******************************************************************************
  API RUN
/*****************************************************************************/
async function run (data, detached = true, child, stdout, stderr) {
  const { dirpath } = data
  const vmdir = path.join(dirpath, '.vm')
  const confpath = path.join(vmdir, 'conf.json')
  const json = await get_config(confpath)
  await fs.mkdir(vmdir, { recursive: true, mode: 0o700 }) // always succeeds
  try {
     // can all still read when using `0o600` ?
    stdout = await fs.open(path.join(vmdir, 'stdout.log'), 'a', 0o600)
    stderr = await fs.open(path.join(vmdir, 'stderr.log'), 'a', 0o600)
    const DATA = JSON.stringify(data)
    const stdio = ['ignore', stdout.fd, stderr.fd]
    if (json) stdio.push('pipe')
    const opts = { env: { DATA }, cwd: dirpath, detached, stdio }

    child = spawn(process.execPath, [__filename], opts)
    const spawned = new Promise((resolve, reject) => {
      child.once('spawn', onspawn)
      child.once('error', onerror)
      function onspawn () {
        child.removeListener('error', onerror)
        resolve()
      }
      function onerror (error) {
        child.removeListener('spawn', onspawn)
        reject(error)
      }
    })
    if (json) child.stdio[3].end(json)
    await spawned
    child.unref()
    return child.pid
  } catch (error) {
    return fail('failed to spawn daemon', { cause: error })
  } finally {
    const all = await Promise.allSettled([stdout?.close(), stderr?.close()])
    const failure = all.find(p => p.status === 'rejected')
    if (failure) fail(`${failure.reason}`, { cause: failure.reason })
  }
  // --------------------------------------------------------------------------
  async function get_config (confpath, opts = {}, done) {
    const { timeout = 5000, limit = 64 * 1024  } = opts
    try { return void await fs.readFile(confpath, 'utf8') } // return undefined
    catch (error) {
      if (error.code !== 'ENOENT') fail('config corruption', { cause: error })
    }
    const { promise, resolve, reject } = Promise.withResolvers()
    let input = ''
    const timer = setTimeout(stop, timeout, 'No config received')
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', ondata)
    process.stdin.once('end', onend)
    process.stdin.once('error', stop)
    process.stdin.resume()
    console.log(`[${NAME}] waiting to receive initial config...`)
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
      if (done) return
      done = true
      clearTimeout(timer)
      process.stdin.pause()
      process.stdin.removeListener('data', ondata)
      process.stdin.removeListener('end', onend)
      process.stdin.removeListener('error', stop)
      if (error) {
        try { fail(`${error}`, { cause: error }) } catch (err) { reject(err) }
        return
      }
      console.log(`[${NAME}] config received`)
      resolve(value)
    }
  }
}
/******************************************************************************
  API SEE
/*****************************************************************************/
async function see (data) {
  const { dirpath } = data
  const vmdir = path.join(dirpath, '.vm')
  console.log('[SEE] TODO: implement', vmdir, { type: 'see', data })
  // TODO:23 fix see function
}
/******************************************************************************
  API END
/*****************************************************************************/
async function end (data) {
  const { dirpath } = data
  const vmdir = path.join(dirpath, '.vm')
  console.log('[END] TODO: implement', vmdir, { type: 'end', data })
  // TODO:24 implement proper daemon termination
  // TODO:25 including deleting `.vm` after propmting user if no `--yes` flag given
  // TODO:26 think about pros/cons of wiping storage, because it can always be done
  //  -> IMPORTANT: by using `rm -rf ./.vm` for example, so why bother?
  // -------------------------
  // CROSS SERVER IPC PID
  // -------------------------
//  const { socket } = JSON.parse(await fs.readFile('pid.json'))
//  const client = net.connect(socket, onopen)
  // TODO:27 fix this end function
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

