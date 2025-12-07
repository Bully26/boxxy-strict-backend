// executor_hardened.js
// Hardened Executor (Node.js) — uses nsjail when available, falls back to bubblewrap.
// Protects: CPU, RAM, wall time, output size, filesystem isolation, no network, seccomp (nsjail),
//           dropped capabilities, cgroups (if available), no shell interpolation.
// Requires: nsjail (recommended) OR bubblewrap (bwrap).
//
// NOTE: This file focuses on practical, layered isolation. For cryptographic/forensic assurance
// use hardware virtualization (Firecracker, QEMU/KVM) or dedicated sandboxing infra.

import fs from "fs/promises";
import { spawn } from "child_process";
import os from "os";
import path from "path";

async function toolExists(cmd) {
  return new Promise((resolve) => {
    const p = spawn("which", [cmd]);
    p.on("close", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });
}

export async function executeCppHardened(code, options = {}) {
  // Limits & defaults
  const MEMORY_BYTES = options.memory_bytes ?? 256 * 1024 * 1024; // 256 MB
  const CPU_SECONDS  = options.cpu_seconds  ?? 1;                 // 1s CPU
  const WALL_MS      = options.wall_ms      ?? 2000;              // 2s real time
  const MAX_OUTPUT   = options.max_output   ?? 1 * 1024 * 1024;   // 1 MB stdout cap
  const USER_UID     = options.uid ?? 65534;                     // nobody fallback
  const USER_GID     = options.gid ?? 65534;

  // Create ephemeral sandbox
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "job-"));
  const sourceFile = path.join(workDir, "main.cpp");
  const execName = "exec";
  const execPath = path.join(workDir, execName);

  // write source
  await fs.writeFile(sourceFile, code, { mode: 0o644 });

  // compile
  const compile = await new Promise((resolve) => {
    const gpp = spawn("g++", ["main.cpp", "-O2", "-std=gnu++17", "-o", execName], { cwd: workDir });
    let stderr = "";
    gpp.stderr.on("data", (b) => stderr += b.toString());
    gpp.on("close", (code) => resolve({ code, stderr }));
    gpp.on("error", (err) => resolve({ code: 127, stderr: err.message }));
  });

  if (compile.code !== 0) {
    await cleanup(workDir);
    return { status: "compile_error", stdout: "", stderr: compile.stderr, runtime_ms: 0 };
  }

  // Check available sandboxing tools
  const hasNsJail = await toolExists("nsjail");
  const hasBwrap  = await toolExists("bwrap");

  // Build launcher arguments (nsjail preferred)
  let child;
  let killedByTimeout = false;
  let killedByOutputLimit = false;
  const start = Date.now();

  const stdoutChunks = [];
  const stderrChunks = [];
  let stdoutBytes = 0;

  if (hasNsJail) {
    // nsjail invocation: seccomp, cgroup, no network, user namespace, mount tmpfs for /tmp, read-only /etc
    // Key flags:
    //  --quiet             : reduce noise
    //  --chroot [dir]      : chroot to sandbox dir
    //  --user/--group      : map to unprivileged uid/gid
    //  --disable_proc      : optional; keep /proc minimal
    //  --rlimit_as / --rlimit_cpu : final safety
    //  --cgroup_mem_max    : requires nsjail built with cgroup support and cgroup v1/v2 configured
    //  --seccomp_string    : use builtin seccomp policy ("c_cpp" is common)
    //
    // We run nsjail from the job dir and map a minimal filesystem. We also mount the compiled binary into the jail.
    const nsjailArgs = [
      "--quiet",
      "--chroot", "/",                // we'll bind-mount workDir as /sandbox below
      "--user", String(USER_UID),
      "--group", String(USER_GID),
      "--use_cgroup",                  // requires correct nsjail + system config
      "--cgroup_mem_max", String(MEMORY_BYTES),
      "--rlimit_cpu", String(CPU_SECONDS),
      "--time_limit", String(Math.ceil(WALL_MS / 1000)),
      "--disable_proc",                // avoid exposing host /proc
      "--disable_daemonize",
      "--cap_drop", "ALL",             // drop capabilities
      "--mount_tmp", "true",           // small tmpfs inside
      "--max_cpus", "1",
      "--seccomp_string", "c_cpp",     // builtin seccomp for C/C++
      // Bind our workdir into the jail as /sandbox:ro for source, rw for exec and tmp
      "--bindmount", `${workDir}:/sandbox:rw`,
      "--cwd", "/sandbox",
      "--",                             // end nsjail options -> command
      "./exec"
    ];

    // spawn nsjail
    child = spawn("nsjail", nsjailArgs, { cwd: workDir });

  } else if (hasBwrap) {
    // Bubblewrap fallback: create a minimal namespace: no network, fresh /tmp, drop mount points
    // Bubblewrap cannot apply seccomp policies itself (unless built with helpers). We combine with prlimit for rlimits.
    const bwrapArgs = [
      "--unshare-all",
      "--die-with-parent",
      "--ro-bind", "/usr/lib", "/usr/lib", // minimal binds to let binary run (may vary by distro)
      "--ro-bind", "/lib", "/lib",
      "--ro-bind", "/bin", "/bin",
      "--bind", workDir, "/sandbox",
      "--chdir", "/sandbox",
      "--tmpfs", "/tmp",
      "--proc", "/proc",
      "--dev", "/dev",
      "--ro-bind", "/etc", "/etc",
      "--unshare-net", // ensure no network (depends on bwrap build)
      "--",
      "/usr/bin/prlimit",
      `--as=${MEMORY_BYTES}`,
      `--cpu=${CPU_SECONDS}`,
      "--",
      "/sandbox/exec"
    ];
    child = spawn("bwrap", bwrapArgs, { cwd: workDir });
  } else {
    // Minimal fallback: use prlimit only (less secure!)
    const args = [
      `--as=${MEMORY_BYTES}`,
      `--cpu=${CPU_SECONDS}`,
      "--",
      "./exec"
    ];
    child = spawn("prlimit", args, { cwd: workDir });
  }

  // Common output handling (streamed, limited)
  const wallTimer = setTimeout(() => {
    killedByTimeout = true;
    try { child.kill("SIGKILL"); } catch {}
  }, WALL_MS);

  child.stdout.on("data", (chunk) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes <= MAX_OUTPUT) {
      stdoutChunks.push(chunk);
    } else {
      // Partial capture: keep up to MAX_OUTPUT bytes, then kill
      const allowed = MAX_OUTPUT - (stdoutBytes - chunk.length);
      if (allowed > 0) {
        stdoutChunks.push(chunk.slice(0, allowed));
      }
      killedByOutputLimit = true;
      try { child.kill("SIGKILL"); } catch {}
    }
  });

  child.stderr.on("data", (chunk) => {
    stderrChunks.push(chunk);
  });

  const exitResult = await new Promise((resolve) => {
    child.on("close", (code, signal) => {
      clearTimeout(wallTimer);
      const runtime_ms = Date.now() - start;
      resolve({ code, signal, runtime_ms });
    });
    child.on("error", (err) => {
      clearTimeout(wallTimer);
      resolve({ code: 127, signal: null, runtime_ms: Date.now() - start, error: err.message });
    });
  });

  // join output
  const stdoutBuf = Buffer.concat(stdoutChunks);
  const stderrBuf = Buffer.concat(stderrChunks);

  // derive final status
  let status = "success";
  if (killedByOutputLimit) status = "output_limit_exceeded";
  else if (killedByTimeout) status = "timeout";
  else if (exitResult.code !== 0) status = "runtime_error";

  // cleanup
  await cleanup(workDir);

  return {
    status,
    stdout: stdoutBuf.toString(),
    stderr: stderrBuf.toString(),
    runtime_ms: exitResult.runtime_ms,
    exit_code: exitResult.code,
    signal: exitResult.signal,
    killedByTimeout,
    killedByOutputLimit
  };
}

async function cleanup(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (_) {}
}



export default executeCppHardened;