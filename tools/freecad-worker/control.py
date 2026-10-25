"""The control try: what a script in the worker must not be able to do. Each line says what happened."""
import os
import socket


def attempt(name, fn):
    try:
        fn()
        print(f"{name}: ALLOWED")
    except Exception as e:
        print(f"{name}: refused: {type(e).__name__}: {e}")


def connect(host, port):
    socket.create_connection((host, port), timeout=5).close()


attempt("socket to 1.1.1.1:443", lambda: connect("1.1.1.1", 443))
attempt("dns api.anthropic.com", lambda: socket.getaddrinfo("api.anthropic.com", 443))
attempt("write /etc/worker-test", lambda: open("/etc/worker-test", "w").write("x"))
attempt("write /opt/worker-test", lambda: open("/opt/worker-test", "w").write("x"))
attempt("write /work/ok.txt", lambda: open("/work/ok.txt", "w").write("x"))
print("ANTHROPIC_API_KEY in env:", "yes" if "ANTHROPIC_API_KEY" in os.environ else "no")
print("files at /:", sorted(os.listdir("/")))
