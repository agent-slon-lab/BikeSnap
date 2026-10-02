#!/usr/bin/env python3
"""Double-fork daemon: запускает bun run dev как ребёнка PID 1,
чтобы пережить смерть shell'а между вызовами Bash-инструмента."""
import os
import sys

DEVLOG = "/home/z/my-project/dev.log"


def daemonize() -> None:
    pid = os.fork()
    if pid > 0:
        os._exit(0)  # родитель уходит — ребёнок переподчиняется
    os.setsid()
    pid = os.fork()
    if pid > 0:
        os._exit(0)  # второй форк — окончательная потеря controlling terminal
    sys.stdout.flush()
    sys.stderr.flush()
    with open(os.devnull, "rb") as devnull:
        os.dup2(devnull.fileno(), 0)
    with open(DEVLOG, "ab") as log:
        os.dup2(log.fileno(), 1)
        os.dup2(log.fileno(), 2)


daemonize()
os.chdir("/home/z/my-project")
os.execvp("bash", ["bash", "-lc", "exec bun run dev"])
