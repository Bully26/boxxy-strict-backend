// executor_firejail.js
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

export async function executeCppFirejail(code, opt = {}) {
  code = (code ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/\t/g, " ");

  const MEM = opt.memory_bytes ?? 256 * 1024 * 1024; // bytes
  const CPU = opt.cpu_seconds ?? 5;
  const WALL = opt.wall_ms ?? 5000;
  const OUTL = opt.max_output ?? 1 * 1024 * 1024;

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "job-"));
  const src = path.join(workDir, "main.cpp");
  const bin = path.join(workDir, "exec");

  await fs.writeFile(src, code, { encoding: "utf8" });

  // -------- COMPILE --------
  const compile = await new Promise((resolve) => {
    let stderr = "";
    const p = spawn("g++", [src, "-O2", "-std=gnu++17", "-o", bin], { cwd: workDir });
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (c) => resolve({ c, stderr }));
    p.on("error", (err) => resolve({ c: 127, stderr: String(err) }));
  });

  if (compile.c !== 0) {
    await fs.rm(workDir, { recursive: true, force: true });
    return { status: "compile_error", stdout: "", stderr: compile.stderr };
  }

  const haveFirejail = await toolExists("firejail");
  const havePrlimit = await toolExists("prlimit");

  let cmd, args;

  if (haveFirejail) {
    cmd = "firejail";
    args = [
      "--quiet",
      "--private=" + workDir,
      "--private-tmp",
      "--nogroups",
      "--nonewprivs",
      "--seccomp",
      "--noroot",
      "--nosound",
      "--net=none",
      "--",
      ...(havePrlimit
        ? ["/usr/bin/prlimit", `--as=${MEM}`, `--cpu=${CPU}`, "--", "./exec"]
        : ["./exec"])
    ];

  } else if (havePrlimit) {
    cmd = "prlimit";
    args = [`--as=${MEM}`, `--cpu=${CPU}`, "--", bin];
  } else {
    cmd = bin;
    args = [];
  }

  const child = spawn(cmd, args, { cwd: workDir });

  let out = [], err = [];
  let used = 0;
  let killedByOutput = false;
  let killedByTime = false;
  const start = Date.now();

  const timer = setTimeout(() => {
    killedByTime = true;
    try { child.kill("SIGKILL"); } catch { }
  }, WALL);

  child.stdout.on("data", (c) => {
    used += c.length;
    if (used <= OUTL) out.push(c);
    else {
      const keep = OUTL - (used - c.length);
      if (keep > 0) out.push(c.slice(0, keep));
      killedByOutput = true;
      try { child.kill("SIGKILL"); } catch { }
    }
  });

  child.stderr.on("data", (c) => err.push(c));

  const ex = await new Promise((resolve) =>
    child.on("close", (code, sig) => {
      clearTimeout(timer);
      resolve({ code, sig, runtime_ms: Date.now() - start });
    })
  );

  await fs.rm(workDir, { recursive: true, force: true });

  const stdout = Buffer.concat(out).toString();
  const stderr = Buffer.concat(err).toString();

  return {
    status:
      killedByOutput ? "output_limit_exceeded" :
        killedByTime ? "timeout" :
          ex.code !== 0 ? "runtime_error" :
            "success",
    stdout,
    stderr,
    exit_code: ex.code,
    signal: ex.sig,
    runtime_ms: ex.runtime_ms,
    used_firejail: haveFirejail
  };
}

export default executeCppFirejail;
