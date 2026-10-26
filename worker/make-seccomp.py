"""worker/seccomp.json from Docker's default profile (moby v27.3.1 profiles/seccomp/default.json): the same, and
the six calls bubblewrap makes to build a job's namespaces allowed without CAP_SYS_ADMIN: unshare, clone with
namespace flags, setns, mount, umount2, pivot_root. Everything else Docker refuses stays refused (clone3 too: glibc
falls back to clone).
  python3 -I worker/make-seccomp.py default.json > worker/seccomp.json
"""
import json
import sys

d = json.load(open(sys.argv[1]))
CALLS = ["unshare", "clone", "setns", "mount", "umount2", "pivot_root"]
d["syscalls"].append({"names": CALLS, "action": "SCMP_ACT_ALLOW", "comment": "sykehus-worker: bubblewrap's namespaces for each job (U3531)"})
json.dump(d, sys.stdout, indent=1)
print()
