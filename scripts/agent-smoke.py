"""Headless agent smoke test: starts a run, auto-approves requests, prints the event trail."""
import json, sys, threading, time, urllib.request

BASE = "http://127.0.0.1:18190"
def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    return json.load(urllib.request.urlopen(req, timeout=30))

conv = post("/api/conversations", {"mode": "agent"})["conversation"]
task = sys.argv[1] if len(sys.argv) > 1 else "Create a file named hello.txt in the workspace containing exactly: Hello from GenieX Studio. Then read it back and tell me its size."
model = sys.argv[2] if len(sys.argv) > 2 else "unsloth/Qwen3-0.6B-GGUF:Q4_0"
req = urllib.request.Request(BASE + "/api/agent/runs", data=json.dumps({"conversationId": conv["id"], "userText": task, "model": model, "options": {"enable_think": False, "compute": "npu"}, "sampler": {"max_tokens": 600, "temperature": 0.2}}).encode(), headers={"Content-Type": "application/json"}, method="POST")
res = urllib.request.urlopen(req, timeout=600)
buf = b""
for raw in res:
    line = raw.decode("utf8", "replace").rstrip("\r\n")
    if not line.startswith("data:"): continue
    p = line[5:].strip()
    if p == "[DONE]": break
    ev = json.loads(p)
    t = ev["type"]
    if t == "delta": continue
    if t == "message":
        m = ev["message"]; c = m["content"] if isinstance(m["content"], str) else "<parts>"
        print(f"  [message] {m['role']} status={m['status']} tools={[tc['function']['name'] for tc in (m.get('toolCalls') or [])]} :: {c[:140]!r}")
    elif t == "approval-request":
        r = ev["request"]; print(f"  [approval-request] {r['tool']} :: {r['summary']}")
        post(f"/api/agent/approvals/{r['id']}", {"decision": "allow"}); print("  -> allowed")
    elif t in ("tool-call", "tool-result", "turn", "run-start", "run-done", "error", "done", "prompt", "run-update", "approval-decision"):
        e = {k: v for k, v in ev.items() if k not in ("content",)}
        if t == "tool-result": e["content"] = ev["content"][:160]
        print(f"  [{t}] {json.dumps(e)[:300]}")
print("conversation:", conv["id"])
